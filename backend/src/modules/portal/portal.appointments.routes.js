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
import { Patient } from '../../models/Patient.js';
import { Doctor } from '../../models/Doctor.js';
import { OnlinePayment } from '../../models/OnlinePayment.js';
import { getSettings } from '../../models/Settings.js';
import * as rzp from '../../services/razorpay.js';
import { addAdvance, refundAdvance } from '../billing/billing.service.js';
import { logger } from '../../config/logger.js';

/** booking-portal payment rules (Settings → Payments → Appointment) */
export async function bookingPayment(doctorId) {
  const s = await getSettings();
  const a = s.payments?.appointment || {};
  if (!a.required || !s.payments?.onlineEnabled || !rzp.razorpayConfigured()) return null;
  let amount = a.amount || 0;
  if (a.amountMode === 'doctor_fee' && doctorId && doctorId !== 'any') {
    const d = await Doctor.findById(doctorId).select('consultationFee').lean();
    if (d?.consultationFee > 0) amount = d.consultationFee;
  }
  return { amount, note: a.note, keyId: rzp.publicKey(), clinic: s.clinic?.name || 'Clinic' };
}

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

/** step 1 when payment is required: create a Razorpay order for this slot */
r.post('/pay-order', validate({ body: z.object({ patient: objectId, branch: objectId, doctor: z.union([objectId, z.literal('any')]).default('any'), date: ymd, start: time }) }), asyncHandler(async (req, res) => {
  const pay = await bookingPayment(req.body.doctor);
  if (!pay) throw ApiError.badRequest('Online payment is not required');
  const patient = await Patient.findOne({ _id: req.body.patient, account: req.patientAccount._id }).select('name mobile').lean();
  if (!patient) throw ApiError.notFound('Profile not found');
  // lock one seat for this patient while they pay (others see the slot as full)
  const hold = await svc.createHold({ accountId: req.patientAccount._id, patientId: patient._id, branchId: req.body.branch, doctorId: req.body.doctor, date: req.body.date, start: req.body.start });
  const amount = req.body.doctor === 'any' ? (await bookingPayment(String(hold.doctor)))?.amount || pay.amount : pay.amount;
  const op = await OnlinePayment.create({ kind: 'order', purpose: 'appointment', branch: req.body.branch, patient: patient._id, customer: { name: patient.name, phone: patient.mobile }, amount, description: `Appointment ${req.body.date} ${req.body.start}`, expiresAt: hold.expiresAt, booking: { ...req.body, holdId: String(hold._id), doctor: String(hold.doctor) } });
  let order;
  try {
    order = await rzp.createOrder({ amount, receipt: String(op._id), notes: { op: String(op._id), purpose: 'appointment', date: req.body.date, start: req.body.start } });
  } catch (e) {
    await svc.releaseHold(hold._id, req.patientAccount._id);
    throw e;
  }
  op.providerId = order.id;
  await op.save();
  ok(res, { opId: op._id, holdId: hold._id, holdExpiresAt: hold.expiresAt, orderId: order.id, amount, keyId: pay.keyId, name: pay.clinic, description: op.description, prefill: { name: patient.name, contact: patient.mobile ? `+91${patient.mobile}` : undefined } }, 201);
}));

const payment = z.union([
  z.object({ opId: objectId, orderId: z.string().max(60), paymentId: z.string().max(60), signature: z.string().max(200) }),
  z.object({ opId: objectId, reuse: z.literal(true) }), // earlier payment whose slot was lost
]).optional();

/** paid booking payments of this account that are not attached to an appointment yet */
const unusedPaid = (accountId) => Patient.find({ account: accountId }).distinct('_id')
  .then((ids) => OnlinePayment.find({ purpose: 'appointment', status: 'paid', appointment: { $exists: false }, patient: { $in: ids } }).sort({ createdAt: -1 }));

r.get('/payments/pending', asyncHandler(async (req, res) => {
  const list = await unusedPaid(req.patientAccount._id);
  ok(res, list.map((o) => ({ opId: o._id, amount: o.paidAmount || o.amount, paidAt: o.paidAt, patient: o.patient })));
}));

/** patient chose "refund" for an unused booking payment */
r.post('/payments/:opId/refund', validate({ params: z.object({ opId: objectId }) }), asyncHandler(async (req, res) => {
  const op = (await unusedPaid(req.patientAccount._id)).find((o) => String(o._id) === req.params.opId);
  if (!op) throw ApiError.notFound('No unused payment found');
  const claimed = await OnlinePayment.findOneAndUpdate({ _id: op._id, status: 'paid', appointment: { $exists: false }, 'booking.claimed': { $ne: true } }, { $set: { 'booking.claimed': true } }, { new: true });
  if (!claimed) throw ApiError.conflict('This payment is already being used');
  try {
    const rf = await rzp.refundPayment(op.paymentId, op.paidAmount || op.amount, { reason: 'patient asked for refund (slot unavailable)' });
    claimed.status = 'refunded';
    claimed.refund = { id: rf.id, amount: op.paidAmount || op.amount, at: new Date(), reason: 'patient asked (slot unavailable)' };
    await claimed.save();
    audit(req, { action: 'portal.payment_refund', entity: 'OnlinePayment', entityId: op._id });
    ok(res, { refunded: true, amount: claimed.refund.amount });
  } catch (e) {
    await OnlinePayment.updateOne({ _id: op._id }, { $set: { 'booking.claimed': false, recordError: `Refund failed: ${e.message}` } });
    throw ApiError.badRequest('Refund could not be started right now — please call the clinic, your payment is safe');
  }
}));

/** release the seat lock (patient closed the payment window) */
r.post('/hold/:id/release', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
  await svc.releaseHold(req.params.id, req.patientAccount._id);
  ok(res, { released: true });
}));

r.post('/', validate({ body: z.object({ patient: objectId, branch: objectId, doctor: z.union([objectId, z.literal('any')]).default('any'), date: ymd, start: time, complaint: z.string().max(500).optional(), utm, payment }) }), asyncHandler(async (req, res) => {
  const need = await bookingPayment(req.body.doctor);
  let op = null;
  if (need && req.body.payment?.reuse) {
    // book a new slot with an earlier payment whose slot was taken
    const prev = (await unusedPaid(req.patientAccount._id)).find((o) => String(o._id) === req.body.payment.opId);
    if (!prev) throw ApiError.badRequest('No unused payment found');
    if ((prev.paidAmount || prev.amount) + 0.01 < need.amount) throw ApiError.badRequest(`This slot needs ₹${need.amount}; your earlier payment was ₹${prev.paidAmount || prev.amount}. Choose a slot with the same doctor/fee, or take the refund.`);
    op = await OnlinePayment.findOneAndUpdate({ _id: prev._id, status: 'paid', appointment: { $exists: false }, 'booking.claimed': { $ne: true } }, { $set: { 'booking.claimed': true, 'booking.holdId': null } }, { new: true });
    if (!op) throw ApiError.conflict('This payment is already being used');
  } else if (need) {
    const p = req.body.payment;
    if (!p) throw ApiError.badRequest('Payment is required to book online', { paymentRequired: true });
    if (!rzp.verifyCheckout(p.orderId, p.paymentId, p.signature)) throw ApiError.badRequest('Payment could not be verified');
    // claim the paid order exactly once (double-click / webhook safe)
    op = await OnlinePayment.findOneAndUpdate(
      { _id: p.opId, providerId: p.orderId, purpose: 'appointment', patient: req.body.patient, 'booking.claimed': { $ne: true } },
      { $set: { 'booking.claimed': true } }, { new: true }
    );
    if (!op) {
      const done = await OnlinePayment.findOne({ _id: p.opId, providerId: p.orderId }).lean();
      if (done?.appointment) return ok(res, await Appointment.findById(done.appointment).populate(POP), 200);
      throw ApiError.badRequest('This payment was already used');
    }
    let pay = await rzp.fetchPayment(p.paymentId);
    if (pay.order_id !== p.orderId) throw ApiError.badRequest('Payment does not match the order');
    if (pay.status === 'authorized') pay = await rzp.capturePayment(p.paymentId, rzp.rupees(pay.amount));
    if (pay.status !== 'captured' || rzp.rupees(pay.amount) + 0.01 < op.amount) throw ApiError.badRequest('Payment not completed');
    Object.assign(op, { status: 'paid', paymentId: pay.id, method: pay.method, paidAmount: rzp.rupees(pay.amount), paidAt: new Date() });
    await op.save();
  }
  let a;
  try {
    a = await svc.book({
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
    holdId: op?.booking?.holdId || undefined,
  });
  } catch (e) {
    if (op) {
      // slot lost after paying (lock expired + taken): keep the payment, the patient chooses another slot or a refund
      await OnlinePayment.updateOne({ _id: op._id }, { $set: { 'booking.claimed': false, 'booking.holdId': null } });
      if (e.status === 409 || e.statusCode === 409) {
        throw ApiError.conflict(`${e.message.replace(/\.$/, '')}. Your payment of ₹${op.paidAmount || op.amount} is safe — choose another slot or take a refund.`, { code: 'SLOT_TAKEN_PAID', opId: String(op._id), amount: op.paidAmount || op.amount });
      }
    }
    throw e;
  }
  if (op) {
    try {
      const rc = await addAdvance({ branch: a.branch, patient: a.patient, mode: rzp.modeOf(op.method), amount: op.paidAmount || op.amount, reference: `Razorpay ${op.paymentId}`, notes: `Online booking ${a.bookingId}` }, { _id: undefined });
      a.prepaid = { amount: op.paidAmount || op.amount, provider: 'razorpay', paymentId: op.paymentId, receipt: rc._id, at: new Date() };
      await a.save();
      op.receipt = rc._id;
    } catch (e2) {
      op.recordError = `Paid but receipt not recorded: ${e2.message}`;
    }
    op.appointment = a._id;
    await op.save();
  }
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
  // prepaid online booking → refund to the original payment method (only if the advance is still unused)
  let refund = null;
  if (a.prepaid?.paymentId && !a.prepaid.refundedAt) {
    try {
      await refundAdvance({ branch: a.branch, patient: a.patient, mode: 'upi', amount: a.prepaid.amount, notes: `Refund — online booking ${a.bookingId} cancelled` }, { _id: undefined });
      const rf = await rzp.refundPayment(a.prepaid.paymentId, a.prepaid.amount, { reason: 'appointment cancelled' });
      await Appointment.updateOne({ _id: a._id }, { $set: { 'prepaid.refundedAt': new Date(), 'prepaid.refundId': rf.id } });
      await OnlinePayment.updateOne({ paymentId: a.prepaid.paymentId }, { $set: { status: 'refunded', refund: { id: rf.id, amount: a.prepaid.amount, at: new Date(), reason: 'appointment cancelled' } } });
      refund = { amount: a.prepaid.amount, status: 'initiated' };
    } catch (e) {
      logger.warn({ appt: String(a._id), err: e.message }, 'booking refund not done');
      refund = { amount: a.prepaid.amount, status: 'manual', message: 'The clinic will process your refund.' };
    }
  }
  ok(res, refund ? { ...(out?.toObject?.() || out), refund } : out);
}));

r.post('/:id/reschedule', validate({ params: z.object({ id: objectId }), body: z.object({ date: ymd, start: time, doctor: z.union([objectId, z.literal('any')]).optional() }) }), asyncHandler(async (req, res) => {
  const a = await ownChangeable(req);
  const fresh = await svc.reschedule(a, { date: req.body.date, start: req.body.start, doctorId: req.body.doctor, staff: false });
  await fresh.populate(POP);
  audit(req, { action: 'portal.appointment_reschedule', entity: 'Appointment', entityId: a._id, branch: a.branch });
  ok(res, fresh, 201);
}));

export default r;
