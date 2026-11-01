import { OnlinePayment } from '../../models/OnlinePayment.js';
import { Invoice } from '../../models/Billing.js';
import { Patient } from '../../models/Patient.js';
import { getSettings } from '../../models/Settings.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../config/logger.js';
import * as rzp from '../../services/razorpay.js';
import * as billing from '../billing/billing.service.js';
import { sendWapp } from '../../services/wapp.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const digits = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

export async function assertOnline() {
  const s = await getSettings();
  if (!s.payments?.onlineEnabled) throw ApiError.badRequest('Online payments are switched off — Settings → Payments');
  if (!rzp.razorpayConfigured()) throw ApiError.badRequest('Razorpay keys missing — Settings → Integrations → Razorpay');
  return s;
}

/**
 * Create a payment link or UPI QR.
 * purpose 'invoice' → amount defaults to the bill balance; 'advance' → patient wallet (OPD or IPD deposit)
 */
export async function create({ kind, purpose, invoice: invoiceId, patient: patientId, branch, admission, amount, phone, description }, user) {
  const s = await assertOnline();
  let inv = null;
  let patient = null;
  if (purpose === 'invoice') {
    inv = await Invoice.findById(invoiceId).populate('patient', 'name mobile').lean();
    if (!inv) throw ApiError.notFound('Invoice not found');
    if (['cancelled', 'refunded', 'paid'].includes(inv.status)) throw ApiError.badRequest(`Bill is ${inv.status}`);
    amount = r2(Math.min(amount || inv.balance, inv.balance));
    patient = inv.patient;
    branch = inv.branch;
  } else {
    patient = await Patient.findById(patientId).select('name mobile').lean();
    if (!patient) throw ApiError.badRequest('Patient not found');
    if (!branch) throw ApiError.badRequest('Branch required');
  }
  if (!(amount >= 1)) throw ApiError.badRequest('Amount must be at least ₹1');
  const clinic = s.clinic?.name || 'Clinic';
  const desc = (description || (inv ? `${clinic} · Bill ${inv.invoiceNo}` : `${clinic} · ${admission ? 'IPD deposit' : 'Advance'} for ${patient.name}`)).slice(0, 200);
  const customer = { name: patient?.name || inv?.customer?.name, phone: digits(phone || patient?.mobile || inv?.customer?.phone) };
  const hours = Math.max(1, s.payments?.linkExpiryHours || 48);
  const expiresAt = new Date(Date.now() + hours * 36e5);

  const op = await OnlinePayment.create({ kind, purpose, branch, invoice: inv?._id, patient: patient?._id, admission, customer, amount, description: desc, expiresAt, createdBy: user._id });
  const notes = { op: String(op._id), purpose, invoice: inv?.invoiceNo || '' };
  try {
    if (kind === 'link') {
      const l = await rzp.createLink({ amount, description: desc, customer, referenceId: String(op._id), expireBy: expiresAt, notes });
      Object.assign(op, { providerId: l.id, shortUrl: l.short_url });
    } else {
      const q = await rzp.createQr({ amount, name: clinic, description: desc, closeBy: expiresAt, notes });
      Object.assign(op, { providerId: q.id, imageUrl: q.image_url });
    }
    await op.save();
  } catch (e) {
    op.status = 'failed';
    op.recordError = e.message;
    await op.save();
    throw e;
  }
  return op;
}

export async function sendLink(op, phone) {
  const to = digits(phone || op.customer?.phone);
  if (!to) throw ApiError.badRequest('No mobile number to send to');
  if (op.kind !== 'link' || !op.shortUrl) throw ApiError.badRequest('Only payment links can be sent');
  const s = await getSettings();
  const till = op.expiresAt?.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const msg = `Hello ${(op.customer?.name || '').split(/\s+/)[0] || 'there'},\n\nPlease pay *₹${op.amount.toLocaleString('en-IN')}* to ${s.clinic?.name || 'the clinic'} for ${op.description}.\n\n💳 Pay securely (UPI / card / net banking):\n${op.shortUrl}\n\n${till ? `Link valid till ${till}.` : ''}`;
  await sendWapp({ to, msg, event: 'payment.link', refType: 'OnlinePayment', refId: op._id });
  await OnlinePayment.updateOne({ _id: op._id }, { $push: { sentTo: { to, at: new Date(), channel: 'whatsapp' } } });
  return { sent: true, to };
}

/** record a captured Razorpay payment exactly once */
export async function markPaid(opId, { id, amount, method }) {
  const op = await OnlinePayment.findOneAndUpdate(
    { _id: opId, status: { $ne: 'paid' }, paymentId: { $exists: false } },
    { $set: { status: 'paid', paymentId: id, method, paidAmount: amount, paidAt: new Date() } },
    { new: true }
  );
  if (!op) return null; // already handled (webhook + poll race)
  if (op.purpose === 'appointment') return op; // booking portal confirms the slot + records the advance
  const user = { _id: op.createdBy };
  const mode = rzp.modeOf(method);
  const reference = `Razorpay ${id}`;
  try {
    let receipt;
    if (op.purpose === 'invoice') {
      const inv = await Invoice.findById(op.invoice).select('balance status patient branch').lean();
      const onBill = r2(Math.min(amount, inv?.balance || 0));
      if (onBill > 0 && !['cancelled', 'refunded'].includes(inv.status)) receipt = (await billing.addPayment(op.invoice, { mode, amount: onBill, reference, notes: 'Online payment' }, user)).payment;
      const extra = r2(amount - onBill);
      if (extra > 0.009 && inv?.patient) {
        await billing.addAdvance({ branch: inv.branch, patient: inv.patient, mode, amount: extra, reference, notes: 'Excess online payment kept as advance' }, user);
      } else if (extra > 0.009) op.recordError = `₹${extra} paid more than the bill balance (walk-in) — refund from Razorpay if needed`;
    } else {
      receipt = await billing.addAdvance({ branch: op.branch, patient: op.patient, mode, amount, reference, notes: op.admission ? 'IPD deposit (online)' : 'Advance (online)' }, user);
    }
    op.receipt = receipt?._id;
    await op.save();
  } catch (e) {
    logger.error({ err: e.message, op: String(op._id) }, 'online payment could not be recorded');
    op.recordError = e.message;
    await op.save();
  }
  return op;
}

/** ask Razorpay for the latest state (works without webhooks, e.g. on localhost) */
export async function sync(op) {
  if (!op.providerId || op.status === 'paid') return op;
  if (op.kind === 'link') {
    const l = await rzp.fetchLink(op.providerId);
    const p = (l.payments || []).find((x) => x.status === 'captured');
    if (p || l.status === 'paid') {
      const pid = p?.payment_id || p?.id;
      const full = pid ? await rzp.fetchPayment(pid).catch(() => null) : null;
      return (await markPaid(op._id, { id: pid, amount: rzp.rupees(full?.amount ?? p?.amount ?? l.amount_paid), method: full?.method || p?.method })) || OnlinePayment.findById(op._id);
    }
    if (['expired', 'cancelled'].includes(l.status)) return OnlinePayment.findByIdAndUpdate(op._id, { status: l.status }, { new: true });
  } else if (op.kind === 'qr') {
    const r = await rzp.fetchQrPayments(op.providerId);
    const p = (r.items || []).find((x) => x.status === 'captured');
    if (p) return (await markPaid(op._id, { id: p.id, amount: rzp.rupees(p.amount), method: p.method })) || OnlinePayment.findById(op._id);
    const q = await rzp.fetchQr(op.providerId);
    if (q.status === 'closed') return OnlinePayment.findByIdAndUpdate(op._id, { status: 'expired' }, { new: true });
  } else if (op.kind === 'order') {
    const r = await rzp.fetchOrderPayments(op.providerId);
    const p = (r.items || []).find((x) => x.status === 'captured');
    if (p) return (await markPaid(op._id, { id: p.id, amount: rzp.rupees(p.amount), method: p.method })) || OnlinePayment.findById(op._id);
  }
  return op;
}

export async function cancel(op) {
  if (op.status !== 'created') throw ApiError.badRequest(`Already ${op.status}`);
  if (op.kind === 'link') await rzp.cancelLink(op.providerId).catch(() => {});
  if (op.kind === 'qr') await rzp.closeQr(op.providerId).catch(() => {});
  op.status = 'cancelled';
  await op.save();
  return op;
}

/** webhook events → record payments */
export async function onWebhook(event, payload) {
  const pay = payload?.payment?.entity;
  const find = (q) => OnlinePayment.findOne(q);
  let op = null;
  if (event === 'payment_link.paid') op = await find({ providerId: payload?.payment_link?.entity?.id });
  else if (event === 'qr_code.credited') op = await find({ providerId: payload?.qr_code?.entity?.id });
  else if (event === 'payment.captured' || event === 'order.paid') op = pay?.order_id ? await find({ providerId: pay.order_id }) : null;
  else if (event === 'payment_link.expired' || event === 'payment_link.cancelled') {
    await OnlinePayment.updateOne({ providerId: payload?.payment_link?.entity?.id, status: 'created' }, { status: event.endsWith('expired') ? 'expired' : 'cancelled' });
    return { ok: true };
  }
  if (!op || !pay) return { ok: true, ignored: true };
  if (pay.status && pay.status !== 'captured') return { ok: true, ignored: 'not captured' };
  await markPaid(op._id, { id: pay.id, amount: rzp.rupees(pay.amount), method: pay.method });
  return { ok: true };
}

/** reuse an open payment link for this bill balance, or make one (thermal receipt QR) */
export async function linkForInvoice(inv, user) {
  const open = await OnlinePayment.findOne({ invoice: inv._id, kind: 'link', status: 'created', amount: inv.balance, expiresAt: { $gt: new Date(Date.now() + 10 * 60_000) } }).lean();
  if (open) return open;
  return create({ kind: 'link', purpose: 'invoice', invoice: inv._id }, user);
}
