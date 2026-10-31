import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { audit } from '../../utils/audit.js';
import { objectId } from '../../utils/zod.js';
import * as svc from './roles.service.js';

const body = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9_]+$/, 'lowercase, digits, underscore'),
  description: z.string().max(300).optional(),
  scope: z.enum(['global', 'branch']).default('branch'),
  permissions: z.array(z.string()).default([]),
});
const idParam = z.object({ id: objectId });

const r = Router();
r.use(auth);

r.get('/catalog', permit('roles.view'), (_req, res) => ok(res, svc.catalog()));
r.get('/', permit('roles.view'), asyncHandler(async (_req, res) => ok(res, await svc.list())));
r.get('/:id', permit('roles.view'), validate({ params: idParam }), asyncHandler(async (req, res) => ok(res, await svc.get(req.params.id))));

r.post(
  '/',
  permit('roles.create'),
  validate({ body }),
  asyncHandler(async (req, res) => {
    const role = await svc.create(req.body, req.perms);
    audit(req, { action: 'roles.create', entity: 'Role', entityId: role._id, after: role });
    ok(res, role, 201);
  })
);

r.patch(
  '/:id',
  permit('roles.edit'),
  validate({ params: idParam, body: body.partial() }),
  asyncHandler(async (req, res) => {
    const { before, after } = await svc.update(req.params.id, req.body, req.perms);
    audit(req, { action: 'roles.edit', entity: 'Role', entityId: after._id, before, after });
    ok(res, after);
  })
);

r.delete(
  '/:id',
  permit('roles.delete'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const role = await svc.remove(req.params.id);
    audit(req, { action: 'roles.delete', entity: 'Role', entityId: role._id, before: role });
    ok(res, { deleted: true });
  })
);

export default r;
