import { Router } from 'express';
import { z } from 'zod';
import { patientAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId } from '../../utils/zod.js';
import { Patient } from '../../models/Patient.js';
import { Branch } from '../../models/Branch.js';
import { PatientAccount } from '../../models/PatientAccount.js';
import * as svc from '../patients/patients.service.js';
import * as v from '../patients/patients.validation.js';

/** Patient-facing API (appointment.* portal). Every query pinned to req.patientAccount. */
const r = Router();
r.use(patientAuth);

const idParam = z.object({ id: objectId });

const own = async (req, id) => {
  const p = await Patient.findOne({ _id: id, account: req.patientAccount._id, isActive: true });
  if (!p) throw ApiError.notFound('Profile not found');
  return p;
};

r.get('/me', asyncHandler(async (req, res) => {
  const profiles = await Patient.find({ account: req.patientAccount._id, isActive: true })
    .select('-createdBy -branchesVisited')
    .sort({ createdAt: 1 });
  ok(res, { mobile: req.patientAccount.mobile, profiles, maxProfiles: svc.MAX_FAMILY });
}));

r.post('/profiles', validate({ body: v.profileCreate }), asyncHandler(async (req, res) => {
  if (req.body.registeredBranch) {
    const b = await Branch.exists({ _id: req.body.registeredBranch, isActive: true });
    if (!b) throw ApiError.badRequest('Invalid branch');
  }
  const p = await svc.createPatient({ ...req.body, accountId: req.patientAccount._id, source: 'online' });
  audit(req, { action: 'portal.profile_create', entity: 'Patient', entityId: p._id, after: p });
  ok(res, p, 201);
}));

r.patch('/profiles/:id', validate({ params: idParam, body: v.profileUpdate }), asyncHandler(async (req, res) => {
  const p = await own(req, req.params.id);
  if (req.body.relation === 'self' && p.relation !== 'self') {
    const exists = await Patient.exists({ account: p.account, relation: 'self', isActive: true, _id: { $ne: p._id } });
    if (exists) throw ApiError.conflict('A "self" profile already exists');
  }
  const before = p.toObject();
  Object.assign(p, req.body);
  await p.save();
  audit(req, { action: 'portal.profile_edit', entity: 'Patient', entityId: p._id, before, after: p });
  ok(res, p);
}));

r.post('/logout-all', asyncHandler(async (req, res) => {
  await PatientAccount.updateOne({ _id: req.patientAccount._id }, { $inc: { tokenVersion: 1 } });
  ok(res, { loggedOut: true });
}));

export default r;
