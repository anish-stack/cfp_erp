import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit, hasPerm } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, paged, parsePaging, escapeRegex } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, time, ymd, paging } from '../../utils/zod.js';
import { Appointment } from '../../models/Appointment.js';
import { Patient } from '../../models/Patient.js';
import * as svc from './appointments.service.js';
import * as notify from '../../services/notify.js';
import { streamDocument } from '../../services/documents.js';

const doctorOrAny = z.union([objectId, z.literal('any')]);

const listQuery = paging.extend({
  date: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  status: z.string().optional(), // comma list
  doctor: objectId.optional(),
  type: z.string().optional(),
  patient: objectId.optional(),
  view: z.enum(['list', 'calendar']).optional(),
});

const bookBody = z.object({
  patient: objectId,
  branch: objectId,
  doctor: doctorOrAny.default('any'),
  date: ymd,
  start: time,
  type: z.enum(['online', 'phone', 'walkin', 'followup', 'crm']).default('phone'),
  visitType: z.enum(['new', 'followup', 'procedure']).default('new'),
  complaint: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  lead: objectId.optional(),
});

const walkinBody = z.object({
  patient: objectId,
  branch: objectId,
  doctor: doctorOrAny,
  start: time.optional(),
  complaint: z.string().max(500).optional(),
  visitType: z.enum(['new', 'followup', 'procedure']).default('new'),
});

const idParam = z.object({ id: objectId });

/** Doctor-role users without assign permission only see their own appointments */
const doctorScope = (req) => (req.user.doctor && !hasPerm(req, 'appointments.assign') ? { doctor: req.user.doctor } : {});

async function loadScoped(req) {
  const a = await Appointment.findOne({ _id: req.params.id, ...doctorScope(req) });
  if (!a) throw ApiError.notFound('Appointment not found');
  req.assertBranch(a.branch);
  return a;
}

const r = Router();
r.use(auth, branchScope);

r.get('/', permit('appointments.view'), validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const q = req.query;
  const f = { ...req.branchFilter('branch'), ...doctorScope(req) };
  if (q.date) f.date = q.date;
  else if (q.from || q.to) f.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.status) f.status = { $in: q.status.split(',') };
  if (q.type) f.type = { $in: q.type.split(',') };
  if (q.doctor && !f.doctor) f.doctor = q.doctor;
  if (q.patient) f.patient = q.patient;
  if (q.q) {
    if (/^[A-Z]{2,5}-\d{6}-\d{4}$/i.test(q.q)) f.bookingId = q.q.toUpperCase();
    else {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      const pats = await Patient.find({ $or: [{ name: rx }, { mobile: rx }, { patientId: rx }] }).select('_id').limit(200).lean();
      f.patient = { $in: pats.map((p) => p._id) };
    }
  }
  const populate = [
    { path: 'patient', select: 'name patientId mobile gender dob ageYears' },
    { path: 'doctor', select: 'name' },
    { path: 'branch', select: 'name code' },
  ];
  if (q.view === 'calendar') {
    const items = await Appointment.find(f).populate(populate).sort({ date: 1, start: 1 }).limit(2000).lean();
    return ok(res, items);
  }
  const { page, limit, skip } = parsePaging(q);
  const [items, total] = await Promise.all([
    Appointment.find(f).populate(populate).sort({ date: -1, start: 1 }).skip(skip).limit(limit).lean(),
    Appointment.countDocuments(f),
  ]);
  paged(res, { items, total, page, limit });
}));

r.get('/summary', permit('appointments.view'), validate({ query: z.object({ date: ymd, branch: objectId.optional() }) }), asyncHandler(async (req, res) => {
  const f = { ...req.branchFilter('branch'), ...doctorScope(req), date: req.query.date };
  const rows = await Appointment.aggregate([{ $match: f }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  ok(res, Object.fromEntries(rows.map((r) => [r._id, r.n])));
}));

r.get('/:id', permit('appointments.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const a = await loadScoped(req);
  await a.populate([
    { path: 'patient', select: 'name patientId mobile gender dob ageYears allergies' },
    { path: 'doctor', select: 'name consultationFee followUpFee' },
    { path: 'branch', select: 'name code' },
    { path: 'createdBy', select: 'name' },
    { path: 'invoice', select: 'invoiceNo grandTotal status' },
  ]);
  ok(res, a);
}));

r.post('/', permit('appointments.create'), validate({ body: bookBody }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.branch);
  const a = await svc.book({ ...req.body, staff: true, patientId: req.body.patient, branchId: req.body.branch, doctorId: req.body.doctor, createdBy: req.user._id });
  audit(req, { action: 'appointments.create', entity: 'Appointment', entityId: a._id, branch: a.branch, after: a });
  ok(res, a, 201);
}));

r.post('/walkin', permit('walkins.create'), validate({ body: walkinBody }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.branch);
  const a = await svc.walkin({ patientId: req.body.patient, branchId: req.body.branch, doctorId: req.body.doctor, start: req.body.start, complaint: req.body.complaint, visitType: req.body.visitType, createdBy: req.user._id });
  audit(req, { action: 'walkins.create', entity: 'Appointment', entityId: a._id, branch: a.branch, after: a });
  ok(res, a, 201);
}));

r.patch('/:id/status', permit('appointments.edit'), validate({ params: idParam, body: z.object({ status: z.enum(['confirmed', 'checked_in', 'in_consultation', 'completed', 'no_show']) }) }), asyncHandler(async (req, res) => {
  const a = await loadScoped(req);
  const out = await svc.setStatus(a, req.body.status);
  audit(req, { action: `appointments.${req.body.status}`, entity: 'Appointment', entityId: a._id, branch: a.branch, before: { status: a.status }, after: { status: out.status } });
  ok(res, out);
}));

r.patch('/:id/notes', permit('appointments.edit'), validate({ params: idParam, body: z.object({ notes: z.string().max(2000) }) }), asyncHandler(async (req, res) => {
  const a = await loadScoped(req);
  a.notes = req.body.notes;
  await a.save();
  ok(res, a);
}));

r.get('/:id/slip', permit('appointments.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const a = await loadScoped(req);
  return streamDocument(res, 'slip', a._id);
}));

/** resend the WhatsApp matching the current status */
r.post('/:id/notify', permit('appointments.edit'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const a = await loadScoped(req);
  const event = { booked: 'booked', confirmed: 'booked', checked_in: 'checked_in', in_consultation: 'checked_in', cancelled: 'cancelled', no_show: 'no_show' }[a.status];
  if (!event) throw ApiError.badRequest(`Nothing to send for a ${a.status} appointment`);
  await notify.enqueueStrict('appointment.event', { event, appointmentId: String(a._id) });
  ok(res, { queued: true, event });
}));

r.post('/:id/cancel', permit('appointments.edit'), validate({ params: idParam, body: z.object({ reason: z.string().min(2).max(300) }) }), asyncHandler(async (req, res) => {
  const a = await loadScoped(req);
  const out = await svc.cancel(a, { reason: req.body.reason, by: 'staff' });
  audit(req, { action: 'appointments.cancel', entity: 'Appointment', entityId: a._id, branch: a.branch, after: { status: out.status, reason: req.body.reason } });
  ok(res, out);
}));

r.post('/:id/reschedule', permit('appointments.edit'), validate({ params: idParam, body: z.object({ date: ymd, start: time, doctor: doctorOrAny.optional() }) }), asyncHandler(async (req, res) => {
  const a = await loadScoped(req);
  const fresh = await svc.reschedule(a, { ...req.body, doctorId: req.body.doctor, staff: true, createdBy: req.user._id });
  audit(req, { action: 'appointments.reschedule', entity: 'Appointment', entityId: a._id, branch: a.branch, after: { newId: fresh._id, date: fresh.date, start: fresh.start } });
  ok(res, fresh, 201);
}));

export default r;
