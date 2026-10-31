import { notificationsQueue } from '../jobs/queues.js';
import { logger } from '../config/logger.js';
import { istToDate } from '../utils/time.js';

const safe = (p) => p.catch((e) => logger.error({ err: e.message }, 'enqueue failed'));
/** seed scripts set CPF_SILENT=1 → nothing is queued (no WhatsApp/reminders for demo data) */
const silent = () => process.env.CPF_SILENT === '1';

/** Appointment lifecycle → SMS + WhatsApp + webhook jobs (worker resolves full doc by id). */
export function appointmentEvent(event, appt) {
  if (silent()) return;
  const id = String(appt._id);
  safe(notificationsQueue.add('appointment.event', { event, appointmentId: id }, { jobId: `appt:${event}:${id}:${Date.now()}` }));
}

/** Delayed reminders at T-24h and T-2h. Returns job ids for later removal. */
export async function scheduleReminders(appt) {
  if (silent()) return [];
  const at = istToDate(appt.date, appt.start).getTime();
  const ids = [];
  for (const [label, offset] of [['24h', 24 * 3600_000], ['2h', 2 * 3600_000]]) {
    const delay = at - offset - Date.now();
    if (delay <= 60_000) continue;
    const jobId = `reminder:${appt._id}:${label}`;
    try {
      await notificationsQueue.add('appointment.reminder', { appointmentId: String(appt._id), label }, { delay, jobId });
      ids.push(jobId);
    } catch (e) {
      logger.error({ err: e.message }, 'reminder enqueue failed');
    }
  }
  return ids;
}

export async function cancelReminders(appt) {
  if (silent()) return;
  for (const id of appt.reminderJobIds || []) {
    try {
      const job = await notificationsQueue.getJob(id);
      if (job) await job.remove();
    } catch (e) {
      logger.warn({ err: e.message, id }, 'reminder remove failed');
    }
  }
}

export const emitWebhook = (event, payload) =>
  silent() ? Promise.resolve() : safe(notificationsQueue.add('webhook.dispatch', { event, payload }));

export const enqueue = (name, data, opts) => silent() ? Promise.resolve() : safe(notificationsQueue.add(name, data, opts));

/** for user-initiated sends: surface queue errors to the caller */
export const enqueueStrict = (name, data, opts) => notificationsQueue.add(name, data, opts);
