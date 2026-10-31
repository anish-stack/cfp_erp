import { Router } from 'express';
import { z } from 'zod';
import { patientAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, time, ymd } from '../../utils/zod.js';
import { Appointment } from '../../models/Appointment.js';
import { Branch } from '../../models/Branch.js';
import { nowIST, toMin } from '../../utils/time.js';
import * as svc from '../appointments/appointments.service.js';

const r = Router();
r.use(patientAuth);

const POP = [
  { path: 'patient', select: 'name patientId relation' },
  { path: 'doctor', select: 'name qualification photo' },
  { path: 'branch', select: 'name address phone whatsapp' },
];

const utm = z.object({ source: z.string().max(60).optional(), medium: z.string().max(60).optional(), campaign: z.string().max(100).optional() }).optional();

r.get('/', validate({ query: z.object({ scope: z.enum(['upcoming', 'past', 'all']).default('upcoming') }) }), asyncHandler(async (req, res) => {
  const today = nowIST().date;
  const f = { account: req.patientAccount._id };
  if (req.query.scope === 'upcoming') Object.assign(f, { date: { $gte: today }, status: { $in: ['booked', 'confirmed', 'checked_in'] } });
  if (req.query.scope === 'past') f.$or = [{ date: { $lt: today } }, { status: { $in: ['completed', 'cancelled', 'no_show', 'rescheduled'] } }];
  ok(res, await Appointment.find(f).populate(POP).select('-slotKey -reminderJobIds -createdBy -notes').sort({ date: req.query.scope === 'past' ? -1 : 1, start: 1 }).limit(100).lean());
}));

r.post('/', validate({ body: z.object({ patient: objectId, branch: objectId, doctor: z.union([objectId, z.literal('any')]).default('any'), date: ymd, start: time, complaint: z.string().max(500).optional(), utm }) }), asyncHandler(async (req, res) => {
  const a = await svc.book({
    staff: false,
    patientId: req.body.patient,
    accountId: req.patientAccount._id,
    branchId: req.body.branch,
    doctorId: req.body.doctor,
    date: req.body.date,
    start: req.body.start,
    complaint: req.body.complaint,
    type: 'online',
    utm: req.body.utm,
  });
  await a.populate(POP);
  audit(req, { action: 'portal.appointment_book', entity: 'Appointment', entityId: a._id, branch: a.branch._id });
  ok(res, a, 201);
}));

/** patient may cancel/reschedule until 2h before start */
async function ownChangeable(req) {
  const a = await Appointment.findOne({ _id: req.params.id, account: req.patientAccount._id });
  if (!a) throw ApiError.notFound('Appointment not found');
  const n = nowIST();
  if (a.date < n.date || (a.date === n.date && toMin(a.start) - n.minutes < 120)) {
    const b = await Branch.findById(a.branch).select('phone').lean();
    throw ApiError.badRequest(`Changes allowed up to 2 hours before. Please call ${b?.phone || 'the clinic'}`);
  }
  return a;
}

r.post('/:id/cancel', validate({ params: z.object({ id: objectId }), body: z.object({ reason: z.string().max(300).default('Cancelled by patient') }) }), asyncHandler(async (req, res) => {
  const a = await ownChangeable(req);
  const out = await svc.cancel(a, { reason: req.body.reason, by: 'patient' });
  audit(req, { action: 'portal.appointment_cancel', entity: 'Appointment', entityId: a._id, branch: a.branch });
  ok(res, out);
}));

r.post('/:id/reschedule', validate({ params: z.object({ id: objectId }), body: z.object({ date: ymd, start: time, doctor: z.union([objectId, z.literal('any')]).optional() }) }), asyncHandler(async (req, res) => {
  const a = await ownChangeable(req);
  const fresh = await svc.reschedule(a, { date: req.body.date, start: req.body.start, doctorId: req.body.doctor, staff: false });
  await fresh.populate(POP);
  audit(req, { action: 'portal.appointment_reschedule', entity: 'Appointment', entityId: a._id, branch: a.branch });
  ok(res, fresh, 201);
}));

export default r;
