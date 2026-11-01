import { Broadcast } from '../../models/Marketing.js';
import { Patient } from '../../models/Patient.js';
import { Appointment } from '../../models/Appointment.js';
import { Lead } from '../../models/Crm.js';
import { Branch } from '../../models/Branch.js';
import { getSettings } from '../../models/Settings.js';
import { normalizeMobile, sendWapp } from '../../services/wapp.js';
import { notificationsQueue } from '../../jobs/queues.js';
import { logger } from '../../config/logger.js';

export const MAX_RECIPIENTS = 5000;
const OPT_OUT_LINE = '\n\nReply STOP to stop receiving offers.';

const ageOf = (p) => (p.dob ? Math.floor((Date.now() - new Date(p.dob)) / 31_557_600_000) : p.ageYears);

/** resolve audience → [{ to, name, branch }] (one per mobile, opt-outs and demo numbers removed) */
export async function resolveAudience(aud = {}) {
  const out = new Map();
  const add = (mobile, name, branch) => {
    const to = normalizeMobile(mobile);
    if (to && !out.has(to)) out.set(to, { to, name: name || '', branch });
  };
  const branchIds = (aud.branches || []).map(String);
  if (aud.patients) {
    const f = { isActive: true, marketingOptOut: { $ne: true } };
    if (branchIds.length) f.$or = [{ registeredBranch: { $in: branchIds } }, { branchesVisited: { $in: branchIds } }];
    if (aud.gender) f.gender = aud.gender;
    if (aud.visitedFrom || aud.visitedTo) {
      const d = {};
      if (aud.visitedFrom) d.$gte = aud.visitedFrom;
      if (aud.visitedTo) d.$lte = aud.visitedTo;
      f._id = { $in: await Appointment.distinct('patient', { date: d, status: { $in: ['completed', 'checked_in', 'in_consultation'] }, ...(branchIds.length ? { branch: { $in: branchIds } } : {}) }) };
    }
    const rows = await Patient.find(f).select('name mobile relation dob ageYears registeredBranch').sort({ relation: 1 }).limit(MAX_RECIPIENTS * 2).lean();
    for (const p of rows) {
      const age = ageOf(p);
      if (aud.ageMin != null && (age == null || age < aud.ageMin)) continue;
      if (aud.ageMax != null && (age == null || age > aud.ageMax)) continue;
      // family members share a mobile — the "self" profile sorts first, so the account holder is greeted
      add(p.mobile, p.name, p.registeredBranch);
    }
  }
  if (aud.leads) {
    const f = { isActive: true, marketingOptOut: { $ne: true }, convertedPatient: { $exists: false } };
    if (aud.leadStages?.length) f.stage = { $in: aud.leadStages };
    if (aud.leadSources?.length) f.source = { $in: aud.leadSources };
    if (branchIds.length) f.branch = { $in: branchIds };
    if (aud.condition) f.condition = new RegExp(String(aud.condition).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const l of await Lead.find(f).select('name phone branch').limit(MAX_RECIPIENTS * 2).lean()) add(l.phone, l.name, l.branch);
  }
  for (const n of aud.extraNumbers || []) add(n, '');
  // global opt-outs: a number that opted out on any patient / lead record is never messaged
  const nums = [...out.keys()];
  const [optP, optL] = await Promise.all([
    Patient.find({ mobile: { $in: nums }, marketingOptOut: true }).distinct('mobile'),
    Lead.find({ phone: { $in: nums }, marketingOptOut: true }).distinct('phone'),
  ]);
  for (const n of [...optP, ...optL]) out.delete(normalizeMobile(n));
  return [...out.values()].slice(0, MAX_RECIPIENTS);
}

export async function render(message, r) {
  const s = await getSettings();
  const branch = r.branch ? await Branch.findById(r.branch).select('name phone').lean() : null;
  const first = (r.name || '').trim().split(/\s+/)[0] || 'there';
  return `${message
    .replaceAll('{name}', r.name || 'there')
    .replaceAll('{first}', first)
    .replaceAll('{clinic}', s.clinic?.name || 'our clinic')
    .replaceAll('{branch}', branch?.name || '')
    .replaceAll('{phone}', branch?.phone || s.clinic?.phone || '')}${OPT_OUT_LINE}`;
}

/** queue one job per recipient, spaced by gapSeconds (keeps the WhatsApp number healthy) */
export async function startBroadcast(id) {
  const b = await Broadcast.findById(id);
  if (!b || !['scheduled', 'draft'].includes(b.status)) return;
  const list = await resolveAudience(b.audience);
  b.status = 'sending';
  b.startedAt = new Date();
  b.stats = { total: list.length, sent: 0, failed: 0, skipped: 0 };
  await b.save();
  if (!list.length) {
    b.status = 'done';
    b.finishedAt = new Date();
    await b.save();
    return;
  }
  const gap = (b.gapSeconds || 4) * 1000;
  await notificationsQueue.addBulk(list.map((r, i) => ({
    name: 'broadcast.send',
    data: { id: String(b._id), to: r.to, name: r.name, branch: r.branch ? String(r.branch) : null },
    opts: { delay: i * gap, jobId: `bc-${b._id}-${r.to}`, attempts: 2, backoff: { type: 'fixed', delay: 60_000 }, removeOnComplete: true, removeOnFail: 500 },
  })));
}

export async function sendOne({ id, to, name, branch }) {
  const b = await Broadcast.findById(id).lean();
  if (!b) return;
  let field = 'sent';
  if (b.status !== 'sending') field = 'skipped';
  else {
    try {
      const msg = await render(b.message, { name, branch });
      const media = b.mediaUrl && /^https:\/\//.test(b.mediaUrl) ? (b.mediaType === 'pdf' ? { pdf: b.mediaUrl } : { img1: b.mediaUrl }) : {};
      const r = await sendWapp({ to, msg, ...media, event: 'marketing.broadcast', refType: 'Broadcast', refId: b._id });
      if (r?.skipped) field = 'skipped';
    } catch (e) {
      field = 'failed';
      await Broadcast.updateOne({ _id: id }, { $set: { lastError: e.message?.slice(0, 200) } });
      logger.warn({ broadcast: id, err: e.message }, 'broadcast send failed');
    }
  }
  const after = await Broadcast.findByIdAndUpdate(id, { $inc: { [`stats.${field}`]: 1 } }, { new: true }).lean();
  const st = after.stats;
  if (after.status === 'sending' && st.sent + st.failed + st.skipped >= st.total) await Broadcast.updateOne({ _id: id, status: 'sending' }, { $set: { status: 'done', finishedAt: new Date() } });
}
