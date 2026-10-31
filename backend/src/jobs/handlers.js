import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { notificationsQueue } from './queues.js';
import { sendWapp, normalizeMobile } from '../services/wapp.js';
import { sendSmsFlow, sendEmail, deliverWebhook } from '../services/channels.js';
import { M } from '../services/messages.js';
import { sendWappWithDoc } from '../services/wappDoc.js';
import { getSettings } from '../models/Settings.js';
import { Appointment } from '../models/Appointment.js';
import { Patient } from '../models/Patient.js';
import { Invoice, Payment, CreditNote } from '../models/Billing.js';
import { FollowUp, Prescription } from '../models/Clinical.js';
import { Branch } from '../models/Branch.js';
import { User } from '../models/User.js';
import { Lead } from '../models/Crm.js';
import { Webhook } from '../models/Misc.js';
import { stockSummary, expiringBatches } from '../modules/inventory/stock.service.js';
import { todayIST } from '../utils/time.js';
import { cfg } from '../services/runtimeConfig.js';

/** missing keys (older settings docs) default ON */
const on = (s, key) => s.notifications?.whatsapp !== false && s.notifications?.[key] !== false;
const ctxOf = (s) => ({ clinic: s.clinic, bookingUrl: env.BOOKING_URL?.replace(/\/$/, '') });

const BRANCH_FIELDS = 'name phone whatsapp address';

async function loadAppt(id) {
  return Appointment.findById(id)
    .populate('patient', 'name mobile patientId')
    .populate('doctor', 'name')
    .populate('branch', BRANCH_FIELDS)
    .lean();
}

const fmtDate = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });

/** run channels independently; fail the job only if every channel failed */
async function fanout(tasks) {
  if (!tasks.length) return;
  const res = await Promise.allSettled(tasks);
  const failed = res.filter((r) => r.status === 'rejected');
  if (failed.length === res.length) throw failed[0].reason;
}

const APPT_MSG = { booked: M.booked, rescheduled: M.rescheduled, cancelled: M.cancelled, no_show: M.noShow, checked_in: M.checkedIn };
const APPT_TOGGLE = { booked: 'appointmentUpdates', rescheduled: 'appointmentUpdates', cancelled: 'appointmentUpdates', no_show: 'noShow', checked_in: 'checkinToken' };

export const handlers = {
  // legacy job name (pre-WAPP builds) — OTP is now sent synchronously
  'sms.otp': async () => {},

  /** booked | rescheduled | cancelled | no_show | checked_in */
  'appointment.event': async ({ event, appointmentId }) => {
    const a = await loadAppt(appointmentId);
    if (!a) return;
    const s = await getSettings();
    if (event !== 'checked_in') {
      notificationsQueue.add('webhook.dispatch', { event: `appointment.${event}`, payload: { id: String(a._id), bookingId: a.bookingId, status: a.status, date: a.date, start: a.start, branch: a.branch?.name, doctor: a.doctor?.name, patientId: a.patient?.patientId } });
    }
    const build = APPT_MSG[event];
    if (!build) return;
    const ref = { event: `appointment.${event}`, refType: 'Appointment', refId: a._id };
    const tasks = [];
    if (on(s, APPT_TOGGLE[event])) tasks.push(sendWapp({ to: a.patient.mobile, msg: build({ a }, ctxOf(s)), ...ref }));
    if (s.notifications?.sms && env.MSG91_FLOW_APPT && ['booked', 'rescheduled', 'cancelled'].includes(event)) {
      tasks.push(sendSmsFlow({ to: a.patient.mobile, flowId: env.MSG91_FLOW_APPT, vars: { name: a.patient.name, booking: a.bookingId, date: fmtDate(a.date), time: a.start, branch: a.branch?.name, status: event }, ref }));
    }
    await fanout(tasks);
  },

  'appointment.reminder': async ({ appointmentId, label }) => {
    const s = await getSettings();
    if (!on(s, 'reminders')) return;
    const a = await loadAppt(appointmentId);
    if (!a || !['booked', 'confirmed'].includes(a.status)) return;
    const ref = { event: `appointment.reminder_${label}`, refType: 'Appointment', refId: a._id };
    const tasks = [sendWapp({ to: a.patient.mobile, msg: M.reminder({ a, label }, ctxOf(s)), ...ref })];
    if (s.notifications?.sms && env.MSG91_FLOW_REMINDER) tasks.push(sendSmsFlow({ to: a.patient.mobile, flowId: env.MSG91_FLOW_REMINDER, vars: { name: a.patient.name, date: fmtDate(a.date), time: a.start, branch: a.branch?.name }, ref }));
    await fanout(tasks);
  },

  'patient.welcome': async ({ patientId }) => {
    const s = await getSettings();
    if (!on(s, 'welcome')) return;
    const p = await Patient.findById(patientId).select('name patientId mobile relation').lean();
    if (!p) return;
    await sendWapp({ to: p.mobile, msg: M.welcome({ patient: p }, ctxOf(s)), event: 'patient.welcome', refType: 'Patient', refId: p._id });
  },

  /** force=true → manual "Send on WhatsApp" from console (ignores toggle) */
  'prescription.send': async ({ rxId, force }) => {
    const s = await getSettings();
    if (!force && !on(s, 'prescription')) return;
    const rx = await Prescription.findById(rxId).populate('patient', 'name mobile').populate('doctor', 'name').lean();
    if (!rx) return;
    await sendWappWithDoc({ to: rx.patient.mobile, msg: M.prescription({ rx }, ctxOf(s)), docType: 'rx', docId: rx._id, docName: `Prescription-${rx.rxNo}`, event: 'prescription.send', refType: 'Prescription', refId: rx._id });
  },

  'invoice.send': async ({ invoiceId, force }) => {
    const s = await getSettings();
    if (!force && !on(s, 'invoice')) return;
    const inv = await Invoice.findById(invoiceId).populate('patient', 'name mobile').populate('branch', 'name').lean();
    if (!inv || inv.status === 'cancelled') return;
    const to = inv.patient?.mobile || normalizeMobile(inv.customer?.phone);
    if (!to) return;
    await sendWappWithDoc({ to, msg: M.invoice({ inv }, ctxOf(s)), docType: 'invoice', docId: inv._id, docName: `Invoice-${inv.invoiceNo}`, event: 'invoice.send', refType: 'Invoice', refId: inv._id });
  },

  /** invoice created → webhook + invoice PDF to customer */
  'invoice.created': async ({ invoiceId }) => {
    const inv = await Invoice.findById(invoiceId).select('invoiceNo grandTotal paid branch').lean();
    if (!inv) return;
    notificationsQueue.add('webhook.dispatch', { event: 'invoice.created', payload: { id: String(inv._id), invoiceNo: inv.invoiceNo, grandTotal: inv.grandTotal, paid: inv.paid, branch: String(inv.branch) } });
    await handlers['invoice.send']({ invoiceId });
  },

  /** additional payment against an existing invoice */
  'payment.received': async ({ invoiceId, paymentId }) => {
    const [inv, payment] = await Promise.all([
      Invoice.findById(invoiceId).populate('patient', 'name mobile').populate('branch', 'name').lean(),
      paymentId ? Payment.findById(paymentId).lean() : null,
    ]);
    if (!inv) return;
    notificationsQueue.add('webhook.dispatch', { event: 'payment.received', payload: { invoiceNo: inv.invoiceNo, amount: payment?.amount, paid: inv.paid, balance: inv.balance, branch: inv.branch?.name } });
    const s = await getSettings();
    const to = inv.patient?.mobile || normalizeMobile(inv.customer?.phone);
    if (!payment || !to || !on(s, 'paymentReceipt')) return;
    await sendWappWithDoc({ to, msg: M.payment({ inv, payment }, ctxOf(s)), docType: 'receipt', docId: payment._id, docName: `Receipt-${payment.receiptNo}`, event: 'payment.received', refType: 'Payment', refId: payment._id });
  },

  'invoice.refund': async ({ invoiceId, creditNoteId, refunded }) => {
    const s = await getSettings();
    if (!on(s, 'refunds')) return;
    const [inv, cn] = await Promise.all([Invoice.findById(invoiceId).populate('patient', 'name mobile').lean(), CreditNote.findById(creditNoteId).lean()]);
    if (!inv || !cn) return;
    const to = inv.patient?.mobile || normalizeMobile(inv.customer?.phone);
    if (!to) return;
    await sendWapp({ to, msg: M.refund({ inv, cn, refunded }, ctxOf(s)), event: 'invoice.refund', refType: 'CreditNote', refId: cn._id });
  },

  'advance.event': async ({ paymentId, balance }) => {
    const s = await getSettings();
    if (!on(s, 'paymentReceipt')) return;
    const p = await Payment.findById(paymentId).populate('patient', 'name mobile').lean();
    if (!p?.patient) return;
    await sendWapp({ to: p.patient.mobile, msg: M.advance({ p, balance }, ctxOf(s)), event: `advance.${p.kind}`, refType: 'Payment', refId: p._id });
  },

  'lead.autoreply': async ({ leadId }) => {
    const s = await getSettings();
    if (!on(s, 'leadAutoReply')) return;
    const lead = await Lead.findById(leadId).select('name phone').lean();
    if (!lead) return;
    await sendWapp({ to: lead.phone, msg: M.leadAutoReply({ lead }, ctxOf(s)), event: 'lead.autoreply', refType: 'Lead', refId: lead._id });
  },

  'lead.assigned': async ({ leadId, userId }) => {
    const s = await getSettings();
    const [lead, user] = await Promise.all([Lead.findById(leadId).select('name phone source condition city').lean(), User.findById(userId).select('name email phone').lean()]);
    if (!lead || !user) return;
    const tasks = [];
    if (on(s, 'staffLeadAlert') && user.phone) tasks.push(sendWapp({ to: user.phone, msg: M.leadAssigned({ lead, user }), event: 'lead.assigned', refType: 'Lead', refId: lead._id }));
    if (s.notifications?.email !== false && user.email) {
      tasks.push(sendEmail({ to: user.email, subject: `New lead assigned: ${lead.name}`, html: `<p>Hi ${user.name},</p><p>New lead <b>${lead.name}</b> (${lead.phone}) from <b>${lead.source}</b>${lead.condition ? ` — ${lead.condition}` : ''} is assigned to you.</p>`, ref: { event: 'lead.assigned', refType: 'Lead', refId: lead._id } }));
    }
    await fanout(tasks);
  },

  'webhook.dispatch': async ({ event, payload }) => {
    const hooks = await Webhook.find({ isActive: true, events: event }).select('_id').lean();
    for (const h of hooks) {
      await notificationsQueue.add('webhook.deliver', { webhookId: String(h._id), event, payload }, { attempts: 6, backoff: { type: 'exponential', delay: 30_000 } });
    }
  },

  'webhook.deliver': async ({ webhookId, event, payload }) => {
    const hook = await Webhook.findById(webhookId).select('+secret');
    if (!hook?.isActive) return;
    let status;
    try {
      status = await deliverWebhook(hook, event, payload);
    } catch (e) {
      await Webhook.updateOne({ _id: hook._id }, { lastError: e.message, $inc: { failures: 1 } });
      throw e;
    }
    await Webhook.updateOne({ _id: hook._id }, { lastStatus: status, lastDeliveredAt: new Date(), ...(status >= 300 ? { $inc: { failures: 1 } } : { failures: 0 }) });
    if (status >= 300) throw new Error(`Webhook HTTP ${status}`);
  },

  // ---------- daily jobs ----------
  'daily.followups': async () => {
    const s = await getSettings();
    if (!on(s, 'followupReminders')) return;
    const due = await FollowUp.find({ dueDate: todayIST(), status: 'pending' }).populate('patient', 'name mobile').populate('branch', BRANCH_FIELDS).populate('doctor', 'name').limit(3000).lean();
    let sent = 0;
    for (const f of due) {
      if (!f.patient?.mobile) continue;
      try {
        await sendWapp({ to: f.patient.mobile, msg: M.followup({ f }, ctxOf(s)), event: 'followup.reminder', refType: 'FollowUp', refId: f._id });
        sent++;
      } catch (e) {
        logger.warn({ err: e.message }, 'follow-up reminder failed');
        if (e.permanent) break; // bad key / no balance — stop hammering
      }
    }
    logger.info({ due: due.length, sent }, 'daily follow-up reminders');
  },

  'daily.stock_alerts': async () => {
    const s = await getSettings();
    if (s.notifications?.dailyStockAlerts === false) return;
    const branches = await Branch.find({ isActive: true }).lean();
    const global = cfg.ALERT_EMAILS.split(',').map((x) => x.trim()).filter(Boolean);
    for (const b of branches) {
      const [low, exp] = await Promise.all([stockSummary({ branch: b._id }, { lowOnly: true }), expiringBatches({ branch: b._id }, s.inventory?.expiryAlertDays || 90)]);
      if (!low.length && !exp.length) continue;
      if (on(s, 'dailyStockAlerts') && b.whatsapp) {
        await sendWapp({ to: b.whatsapp, msg: M.stockAlert({ branch: b, low, expiring: exp }), event: 'stock.alert', refType: 'Branch', refId: b._id }).catch((e) => logger.warn({ err: e.message }, 'stock alert WA failed'));
      }
      if (s.notifications?.email !== false) {
        const rows = (arr, fn) => arr.slice(0, 100).map(fn).join('');
        const html = `<h3>${b.name}: stock alerts (${todayIST()})</h3>
          ${low.length ? `<h4>Low stock (${low.length})</h4><table border="1" cellpadding="4" cellspacing="0"><tr><th>Product</th><th>Qty</th><th>Reorder</th></tr>${rows(low, (x) => `<tr><td>${x.product.name}</td><td>${x.qty}</td><td>${x.product.reorderLevel}</td></tr>`)}</table>` : ''}
          ${exp.length ? `<h4>Expiring / expired (${exp.length})</h4><table border="1" cellpadding="4" cellspacing="0"><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th></tr>${rows(exp, (x) => `<tr><td>${x.product?.name}</td><td>${x.batchNo}</td><td>${x.expiry}</td><td>${x.qty}</td></tr>`)}</table>` : ''}`;
        await sendEmail({ to: [...global, b.email].filter(Boolean), subject: `[${b.code}] Stock alerts: ${low.length} low, ${exp.length} expiring`, html, ref: { event: 'stock.alert', refType: 'Branch', refId: b._id } }).catch((e) => logger.warn({ err: e.message }, 'stock alert email failed'));
      }
    }
  },

  /** End of day: unattended booked/confirmed → no_show (+ rebook nudge), stale check-ins → completed */
  'daily.no_show': async () => {
    const today = todayIST();
    const missed = await Appointment.find({ date: { $lte: today }, status: { $in: ['booked', 'confirmed'] } }).select('_id').lean();
    const r = await Appointment.updateMany({ _id: { $in: missed.map((m) => m._id) }, status: { $in: ['booked', 'confirmed'] } }, { $set: { status: 'no_show' }, $unset: { slotKey: 1 } });
    const c = await Appointment.updateMany({ date: { $lt: today }, status: { $in: ['checked_in', 'in_consultation'] } }, { $set: { status: 'completed', completedAt: new Date() }, $unset: { slotKey: 1 } });
    // nudge only today's no-shows (older ones were already handled on their day)
    const todays = await Appointment.find({ _id: { $in: missed.map((m) => m._id) }, date: today, status: 'no_show' }).select('_id').lean();
    for (const a of todays) await notificationsQueue.add('appointment.event', { event: 'no_show', appointmentId: String(a._id) });
    logger.info({ noShow: r.modifiedCount, autoCompleted: c.modifiedCount, nudged: todays.length }, 'daily appointment close');
  },
};

/** Repeatable schedules (cron in IST) */
export async function registerRepeatables() {
  const tz = 'Asia/Kolkata';
  await notificationsQueue.upsertJobScheduler('daily-followups', { pattern: '0 9 * * *', tz }, { name: 'daily.followups' });
  await notificationsQueue.upsertJobScheduler('daily-stock-alerts', { pattern: '0 8 * * *', tz }, { name: 'daily.stock_alerts' });
  await notificationsQueue.upsertJobScheduler('daily-no-show', { pattern: '45 20 * * *', tz }, { name: 'daily.no_show' });
}
