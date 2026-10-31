import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, paged, parsePaging } from '../../utils/asyncHandler.js';
import { audit } from '../../utils/audit.js';
import { objectId, paging, indianMobile } from '../../utils/zod.js';
import * as svc from './patients.service.js';
import * as v from './patients.validation.js';

const idParam = z.object({ id: objectId });
const r = Router();
r.use(auth, branchScope);

r.get('/', permit('patients.view'), validate({ query: paging }), asyncHandler(async (req, res) => {
  paged(res, await svc.listForStaff(req, { ...parsePaging(req.query), q: req.query.q }));
}));

r.get('/lookup', permit('patients.view'), validate({ query: z.object({ mobile: indianMobile }) }), asyncHandler(async (req, res) => {
  ok(res, await svc.lookupByMobile(req.query.mobile));
}));

r.get('/:id', permit('patients.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const p = await svc.getForStaff(req, req.params.id);
  audit(req, { action: 'patients.view', entity: 'Patient', entityId: p._id });
  ok(res, p);
}));

r.post('/', permit('patients.create'), validate({ body: v.staffCreate }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.registeredBranch);
  const p = await svc.createPatient({ ...req.body, source: 'reception', createdBy: req.user._id });
  audit(req, { action: 'patients.create', entity: 'Patient', entityId: p._id, branch: p.registeredBranch, after: p });
  ok(res, p, 201);
}));

r.patch('/:id', permit('patients.edit'), validate({ params: idParam, body: v.profileUpdate }), asyncHandler(async (req, res) => {
  const p = await svc.getForStaff(req, req.params.id);
  const before = p.toObject();
  Object.assign(p, req.body);
  await p.save();
  audit(req, { action: 'patients.edit', entity: 'Patient', entityId: p._id, before, after: p });
  ok(res, p);
}));

export default r;
