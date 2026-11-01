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
import { Prescription } from '../../models/Clinical.js';
import { Invoice } from '../../models/Billing.js';
import { Appointment } from '../../models/Appointment.js';
import { Admission } from '../../models/Ipd.js';
import { loadDocument, streamDocument } from '../../services/documents.js';

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

/** remove a family member from this login (records are kept for the clinic) */
r.delete('/profiles/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const p = await own(req, req.params.id);
  if (p.relation === 'self') throw ApiError.badRequest('The main profile cannot be removed');
  const upcoming = await Appointment.exists({ patient: p._id, status: { $in: ['booked', 'confirmed'] } });
  if (upcoming) throw ApiError.badRequest('Cancel upcoming appointments for this member first');
  p.isActive = false;
  await p.save();
  audit(req, { action: 'portal.profile_remove', entity: 'Patient', entityId: p._id });
  ok(res, { removed: true });
}));

const profileIds = async (req) => Patient.find({ account: req.patientAccount._id }).distinct('_id');

r.get('/prescriptions', asyncHandler(async (req, res) => {
  const ids = await profileIds(req);
  ok(res, await Prescription.find({ patient: { $in: ids } }).select('rxNo patient doctor branch diagnosis items followUpDate mode createdAt').populate('patient', 'name').populate('doctor', 'name').populate('branch', 'name').sort({ createdAt: -1 }).limit(100).lean());
}));

r.get('/invoices', asyncHandler(async (req, res) => {
  const ids = await profileIds(req);
  ok(res, await Invoice.find({ patient: { $in: ids }, status: { $ne: 'cancelled' } }).select('invoiceNo patient branch type grandTotal paid balance status createdAt').populate('patient', 'name').populate('branch', 'name').sort({ createdAt: -1 }).limit(100).lean());
}));

r.get('/admissions', asyncHandler(async (req, res) => {
  const ids = await profileIds(req);
  ok(res, await Admission.find({ patient: { $in: ids }, status: { $in: ['admitted', 'discharge_initiated', 'discharged'] } }).select('admissionNo patient doctor branch status admittedAt dischargedAt plannedProcedure discharge.followUpDate invoice').populate('patient', 'name').populate('doctor', 'name').populate('branch', 'name').populate('invoice', 'invoiceNo grandTotal balance').sort({ admittedAt: -1 }).limit(50).lean());
}));

/** own PDFs: rx | invoice | slip | discharge */
r.get('/documents/:type/:id', validate({ params: z.object({ type: z.enum(['rx', 'invoice', 'slip', 'discharge']), id: objectId }) }), asyncHandler(async (req, res) => {
  const loaded = await loadDocument(req.params.type, req.params.id);
  const ids = (await profileIds(req)).map(String);
  if (!loaded.patient || !ids.includes(String(loaded.patient))) throw ApiError.notFound('Document not found');
  audit(req, { action: `portal.download_${req.params.type}`, entity: 'Patient', entityId: loaded.patient });
  return streamDocument(res, req.params.type, loaded, { download: req.query.download === '1' });
}));

r.post('/logout-all', asyncHandler(async (req, res) => {
  await PatientAccount.updateOne({ _id: req.patientAccount._id }, { $inc: { tokenVersion: 1 } });
  ok(res, { loggedOut: true });
}));

export default r;
