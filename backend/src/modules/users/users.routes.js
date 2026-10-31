import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, paged, parsePaging } from '../../utils/asyncHandler.js';
import { audit } from '../../utils/audit.js';
import { objectId, paging, indianMobile } from '../../utils/zod.js';
import * as svc from './users.service.js';

const password = z.string().min(8).regex(/[A-Z]/, 'uppercase').regex(/[a-z]/, 'lowercase').regex(/\d/, 'number');

const base = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: indianMobile.optional(),
  role: objectId,
  branches: z.array(objectId).default([]),
  allBranches: z.boolean().default(false),
  designation: z.string().max(60).optional(),
  isActive: z.boolean().optional(),
});

const createBody = base
  .extend({ password })
  .refine((d) => d.email || d.phone, 'Email or phone required')
  .refine((d) => d.allBranches || d.branches.length > 0, 'Assign at least one branch or all branches');

const updateBody = base.partial().extend({ password: password.optional() });

const listQuery = paging.extend({ role: objectId.optional(), isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });
const idParam = z.object({ id: objectId });

const r = Router();
r.use(auth, branchScope);

r.get('/', permit('staff.view'), validate({ query: listQuery }), asyncHandler(async (req, res) => {
  paged(res, await svc.list(req, { ...parsePaging(req.query), ...req.query }));
}));

r.get('/:id', permit('staff.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  ok(res, await svc.getScoped(req, req.params.id));
}));

r.post('/', permit('staff.create'), validate({ body: createBody }), asyncHandler(async (req, res) => {
  const u = await svc.create(req, req.body);
  audit(req, { action: 'staff.create', entity: 'User', entityId: u._id, after: u });
  ok(res, u, 201);
}));

r.patch('/:id', permit('staff.edit'), validate({ params: idParam, body: updateBody }), asyncHandler(async (req, res) => {
  const { before, after } = await svc.update(req, req.params.id, req.body);
  audit(req, { action: 'staff.edit', entity: 'User', entityId: after._id, before, after });
  ok(res, after);
}));

export default r;
