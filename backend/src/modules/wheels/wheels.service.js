import crypto from 'node:crypto';
import { SpinWheel, SpinEntry } from '../../models/Spin.js';
import { EnquiryForm } from '../../models/Crm.js';
import { getSettings } from '../../models/Settings.js';
import { createLead } from '../crm/crm.service.js';
import { sendWapp } from '../../services/wapp.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../config/logger.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const randCode = (n = 6) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');

/** keep `remaining` in sync whenever stock is edited */
export function normalizeSegments(segments = [], old = []) {
  return segments.map((s) => {
    const prev = old.find((o) => String(o._id) === String(s._id));
    const won = prev?.won || 0;
    const stock = s.stock === '' || s.stock === undefined || s.stock === null ? null : Number(s.stock);
    return { ...s, won, stock, remaining: stock === null ? null : Math.max(0, stock - won) };
  });
}

export const isLive = (w) => w?.isActive && (!w.startsAt || new Date(w.startsAt) <= new Date()) && (!w.endsAt || new Date(w.endsAt) >= new Date());

export function parseUa(ua = '') {
  const type = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop';
  const os = /android/i.test(ua) ? 'Android' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'Other';
  const browser = /edg\//i.test(ua) ? 'Edge' : /samsungbrowser/i.test(ua) ? 'Samsung' : /fbav|fban|instagram/i.test(ua) ? 'In-app (FB/IG)' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Other';
  return { type, os, browser };
}

/** city/region come from Cloudflare (or any proxy) geo headers when present */
export function geoFrom(req) {
  const h = (k) => (req.headers[k] ? decodeURIComponent(String(req.headers[k])).slice(0, 80) : undefined);
  return { ip: req.ip, city: h('cf-ipcity') || h('x-city'), region: h('cf-region') || h('x-region'), country: h('cf-ipcountry') || h('x-country') };
}

/** weighted random among segments that still have stock */
function pick(segments, exclude = new Set()) {
  const pool = segments.filter((s) => !exclude.has(String(s._id)) && s.weight > 0 && (s.remaining === null || s.remaining === undefined || s.remaining > 0));
  const total = pool.reduce((a, s) => a + s.weight, 0);
  if (!total) return null;
  let x = crypto.randomInt(0, 1_000_000) / 1_000_000 * total;
  for (const s of pool) { x -= s.weight; if (x < 0) return s; }
  return pool[pool.length - 1];
}

async function claim(wheelId, seg) {
  if (seg.remaining === null || seg.remaining === undefined) {
    await SpinWheel.updateOne({ _id: wheelId, 'segments._id': seg._id }, { $inc: { 'segments.$.won': 1 } });
    return true;
  }
  const r = await SpinWheel.updateOne({ _id: wheelId, segments: { $elemMatch: { _id: seg._id, remaining: { $gt: 0 } } } }, { $inc: { 'segments.$.remaining': -1, 'segments.$.won': 1 } });
  return r.modifiedCount === 1;
}

const view = (e, w) => ({
  segmentIndex: Math.max(0, w.segments.findIndex((s) => String(s._id) === String(e.segment))),
  prize: e.prize, isWin: e.isWin, code: e.code, expiresAt: e.expiresAt, status: e.status,
  description: w.segments.find((s) => String(s._id) === String(e.segment))?.description,
});

export async function spin(wheelId, { name, phone, formSlug, utm, pageUrl, referrer, language }, req) {
  const w = await SpinWheel.findById(wheelId).lean();
  if (!isLive(w)) throw ApiError.badRequest('This offer has ended');
  // one spin per mobile number per wheel — a repeat returns the same result
  const prev = await SpinEntry.findOne({ wheel: w._id, phone }).lean();
  if (prev) return { ...view(prev, w), repeat: true };

  let seg = null;
  const tried = new Set();
  for (let i = 0; i < 6 && !seg; i++) {
    const s = pick(w.segments, tried);
    if (!s) break;
    if (await claim(w._id, s)) seg = s;
    else tried.add(String(s._id));
  }
  if (!seg) seg = w.segments.find((s) => s.kind === 'none') || w.segments[0];
  if (!seg) throw ApiError.badRequest('Wheel not configured');

  const isWin = seg.kind === 'prize';
  const form = formSlug ? await EnquiryForm.findOne({ slug: formSlug }).select('_id campaign branch defaultSource assignTo name').lean() : null;
  const doc = {
    wheel: w._id, form: form?._id, name, phone, segment: seg._id, prize: seg.label, isWin,
    status: isWin ? 'won' : 'lost', expiresAt: isWin ? new Date(Date.now() + (w.validDays || 30) * 864e5) : undefined,
    utm, pageUrl, referrer, language, device: parseUa(req.headers['user-agent']), ...geoFrom(req),
  };
  let entry;
  for (let i = 0; i < 5; i++) {
    try {
      entry = await SpinEntry.create({ ...doc, code: isWin ? `${w.codePrefix || 'CPF'}-${randCode()}` : undefined });
      break;
    } catch (e) {
      if (e.code !== 11000) throw e;
      const again = await SpinEntry.findOne({ wheel: w._id, phone }).lean(); // double-click race
      if (again) return { ...view(again, w), repeat: true };
    }
  }

  // lead + WhatsApp in the background — the visitor sees the result immediately
  (async () => {
    try {
      if (w.createLead) {
        const { lead } = await createLead({
          name: name || 'Spin & Win visitor', phone, branch: form?.branch, campaign: form?.campaign, form: form?._id, utm,
          source: utm?.source ? undefined : form?.defaultSource || 'landing_page', assignedTo: form?.assignTo,
          formData: { 'Spin wheel': w.name, Prize: seg.label, Code: entry.code || '—' },
        }, { allowDuplicate: true });
        await SpinEntry.updateOne({ _id: entry._id }, { $set: { lead: lead._id } });
      }
      if (isWin && w.sendWhatsapp) {
        const s = await getSettings();
        const msg = (w.winMessage || '')
          .replaceAll('{name}', (name || '').split(/\s+/)[0] || 'there').replaceAll('{prize}', seg.label).replaceAll('{code}', entry.code)
          .replaceAll('{expiry}', entry.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }))
          .replaceAll('{clinic}', s.clinic?.name || 'our clinic').replaceAll('{phone}', s.clinic?.phone || '');
        const out = await sendWapp({ to: phone, msg, event: 'spin.win', refType: 'SpinEntry', refId: entry._id });
        await SpinEntry.updateOne({ _id: entry._id }, { $set: { whatsapp: { status: out?.skipped ? 'skipped' : 'sent' } } });
      }
    } catch (e) {
      logger.warn({ err: e.message, entry: String(entry._id) }, 'spin follow-up failed');
      await SpinEntry.updateOne({ _id: entry._id }, { $set: { whatsapp: { status: 'failed', error: e.message?.slice(0, 200) } } }).catch(() => {});
    }
  })();

  return view(entry, w);
}
