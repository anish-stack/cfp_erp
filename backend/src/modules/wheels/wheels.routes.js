import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import mongoose from 'mongoose';
import { permit } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, paged, parsePaging, escapeRegex } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, ymd } from '../../utils/zod.js';
import { istDayRange } from '../../utils/time.js';
import { toCsv } from '../../utils/csv.js';
import { SpinWheel, SpinEntry } from '../../models/Spin.js';
import * as svc from './wheels.service.js';

const idParam = z.object({ id: objectId });
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const segment = z.object({
  _id: objectId.optional(), label: z.string().trim().min(1).max(40), kind: z.enum(['prize', 'none']).default('prize'), description: z.string().max(200).optional(),
  weight: z.number().min(0).max(10000).default(10), stock: z.number().int().min(0).nullable().optional(), color: hex.default('#e21f26'), textColor: hex.default('#ffffff'),
});
const body = z.object({
  name: z.string().trim().min(2).max(80), title: z.string().max(80).optional(), subtitle: z.string().max(200).optional(), buttonText: z.string().max(30).optional(),
  segments: z.array(segment).min(2).max(12), validDays: z.number().int().min(1).max(365).default(30), codePrefix: z.string().regex(/^[A-Za-z0-9]{0,8}$/).optional(),
  terms: z.string().max(600).optional(), sendWhatsapp: z.boolean().optional(), winMessage: z.string().max(1000).optional(), createLead: z.boolean().optional(),
  startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional(), isActive: z.boolean().optional(),
});
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/* ------------------------------------------------------------------ admin (mounted at /crm/wheels with auth) */
export const adminRoutes = Router();
const a = adminRoutes;

a.get('/', permit('cms.view'), asyncHandler(async (_req, res) => {
  const wheels = await SpinWheel.find().sort({ createdAt: -1 }).lean();
  const stats = await SpinEntry.aggregate([{ $group: { _id: '$wheel', spins: { $sum: 1 }, wins: { $sum: { $cond: ['$isWin', 1, 0] } }, redeemed: { $sum: { $cond: [{ $eq: ['$status', 'redeemed'] }, 1, 0] } }, last: { $max: '$createdAt' } } }]);
  const by = Object.fromEntries(stats.map((s) => [String(s._id), s]));
  ok(res, wheels.map((w) => ({ ...w, live: svc.isLive(w), stats: by[String(w._id)] || { spins: 0, wins: 0, redeemed: 0 } })));
}));
a.get('/entries', permit('cms.view'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const f = entryFilter(req.query);
  const [items, total] = await Promise.all([
    SpinEntry.find(f).populate('wheel', 'name').populate('form', 'name slug').populate('redeemedBy', 'name').populate('redeemedBranch', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    SpinEntry.countDocuments(f),
  ]);
  paged(res, { items, total, page, limit });
}));
a.get('/entries.csv', permit('cms.view'), asyncHandler(async (req, res) => {
  const rows = await SpinEntry.find(entryFilter(req.query)).populate('wheel', 'name').populate('form', 'name').populate('redeemedBy', 'name').sort({ createdAt: -1 }).limit(20000).lean();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="spin-entries.csv"');
  res.send(toCsv(rows, [
    ['Date', (r) => new Date(r.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })], ['Wheel', 'wheel.name'], ['Name', 'name'], ['Mobile', 'phone'], ['Prize', 'prize'], ['Code', 'code'], ['Status', 'status'],
    ['Landing page', 'form.name'], ['Source', (r) => r.utm?.source || 'direct'], ['Medium', 'utm.medium'], ['Campaign', 'utm.campaign'], ['Page URL', 'pageUrl'], ['Referrer', 'referrer'],
    ['Device', 'device.type'], ['OS', 'device.os'], ['Browser', 'device.browser'], ['City', 'city'], ['Region', 'region'], ['IP', 'ip'],
    ['WhatsApp', 'whatsapp.status'], ['Redeemed at', (r) => (r.redeemedAt ? new Date(r.redeemedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '')], ['Redeemed by', 'redeemedBy.name'],
  ]));
}));
a.get('/code/:code', permit('cms.view'), asyncHandler(async (req, res) => {
  const e = await SpinEntry.findOne({ code: String(req.params.code).trim().toUpperCase() }).populate('wheel', 'name').populate('redeemedBy', 'name').lean();
  if (!e) throw ApiError.notFound('Code not found');
  ok(res, { ...e, expired: e.status === 'won' && e.expiresAt && new Date(e.expiresAt) < new Date() });
}));
a.post('/entries/:id/redeem', permit('cms.edit'), validate({ params: idParam, body: z.object({ branch: objectId.optional(), note: z.string().max(300).optional() }) }), asyncHandler(async (req, res) => {
  const e = await SpinEntry.findById(req.params.id);
  if (!e) throw ApiError.notFound('Entry not found');
  if (e.status !== 'won') throw ApiError.badRequest(e.status === 'redeemed' ? 'Already redeemed' : 'Nothing to redeem');
  if (e.expiresAt && e.expiresAt < new Date()) throw ApiError.badRequest('Code has expired');
  Object.assign(e, { status: 'redeemed', redeemedAt: new Date(), redeemedBy: req.user._id, redeemedBranch: req.body.branch, redeemNote: req.body.note });
  await e.save();
  audit(req, { action: 'wheel.redeem', entity: 'SpinEntry', entityId: e._id, after: { code: e.code, prize: e.prize } });
  ok(res, e);
}));
a.post('/entries/:id/cancel', permit('cms.edit'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const e = await SpinEntry.findOneAndUpdate({ _id: req.params.id, status: 'won' }, { $set: { status: 'cancelled' } }, { new: true });
  if (!e) throw ApiError.badRequest('Only unredeemed wins can be cancelled');
  audit(req, { action: 'wheel.cancel', entity: 'SpinEntry', entityId: e._id });
  ok(res, e);
}));

/** analytics: totals, by prize / source / page / device / city / day */
a.get('/:id/report', permit('cms.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const m = entryFilter({ ...req.query, wheel: req.params.id });
  const g = (key, extra = {}) => SpinEntry.aggregate([{ $match: m }, { $group: { _id: key, n: { $sum: 1 }, ...extra } }, { $sort: { n: -1 } }, { $limit: 15 }]);
  const [tot] = await SpinEntry.aggregate([{ $match: m }, { $group: { _id: null, spins: { $sum: 1 }, wins: { $sum: { $cond: ['$isWin', 1, 0] } }, redeemed: { $sum: { $cond: [{ $eq: ['$status', 'redeemed'] }, 1, 0] } }, leads: { $sum: { $cond: [{ $ifNull: ['$lead', false] }, 1, 0] } } } }]);
  const [byPrize, bySource, byPage, byDevice, byCity, byDay, wheel] = await Promise.all([
    g('$prize', { redeemed: { $sum: { $cond: [{ $eq: ['$status', 'redeemed'] }, 1, 0] } } }),
    g({ $ifNull: ['$utm.source', 'direct'] }),
    SpinEntry.aggregate([{ $match: m }, { $group: { _id: '$form', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 15 }, { $lookup: { from: 'enquiryforms', localField: '_id', foreignField: '_id', as: 'f' } }, { $project: { n: 1, name: { $ifNull: [{ $first: '$f.name' }, 'Direct / unknown'] } } }]),
    g({ $concat: [{ $ifNull: ['$device.type', 'unknown'] }, ' · ', { $ifNull: ['$device.os', ''] }] }),
    g({ $ifNull: ['$city', 'Unknown'] }),
    SpinEntry.aggregate([{ $match: m }, { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } }, spins: { $sum: 1 }, wins: { $sum: { $cond: ['$isWin', 1, 0] } } } }, { $sort: { _id: 1 } }, { $limit: 120 }]),
    SpinWheel.findById(req.params.id).lean(),
  ]);
  ok(res, { totals: tot || { spins: 0, wins: 0, redeemed: 0, leads: 0 }, byPrize, bySource, byPage, byDevice, byCity, byDay, stock: wheel?.segments.map((s) => ({ label: s.label, kind: s.kind, stock: s.stock, remaining: s.remaining, won: s.won })) });
}));
a.get('/:id', permit('cms.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const w = await SpinWheel.findById(req.params.id).lean();
  if (!w) throw ApiError.notFound('Wheel not found');
  ok(res, w);
}));
a.post('/', permit('cms.create'), validate({ body }), asyncHandler(async (req, res) => {
  const w = await SpinWheel.create({ ...req.body, segments: svc.normalizeSegments(req.body.segments), createdBy: req.user._id });
  audit(req, { action: 'wheel.create', entity: 'SpinWheel', entityId: w._id, after: { name: w.name } });
  ok(res, w, 201);
}));
a.patch('/:id', permit('cms.edit'), validate({ params: idParam, body: body.partial() }), asyncHandler(async (req, res) => {
  const w = await SpinWheel.findById(req.params.id);
  if (!w) throw ApiError.notFound('Wheel not found');
  const before = w.toObject();
  if (req.body.segments) req.body.segments = svc.normalizeSegments(req.body.segments, before.segments);
  w.set(req.body);
  await w.save();
  audit(req, { action: 'wheel.update', entity: 'SpinWheel', entityId: w._id });
  ok(res, w);
}));
a.delete('/:id', permit('cms.delete'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  if (await SpinEntry.exists({ wheel: req.params.id })) {
    await SpinWheel.updateOne({ _id: req.params.id }, { $set: { isActive: false } });
    return ok(res, { deactivated: true, message: 'Wheel has spins, so it was switched off instead of deleted' });
  }
  await SpinWheel.deleteOne({ _id: req.params.id });
  ok(res, { deleted: true });
}));

function entryFilter(q) {
  const f = {};
  if (q.wheel && mongoose.isValidObjectId(q.wheel)) f.wheel = oid(q.wheel);
  if (q.form && mongoose.isValidObjectId(q.form)) f.form = oid(q.form);
  if (q.status) f.status = String(q.status);
  if (q.source) f['utm.source'] = q.source === 'direct' ? { $exists: false } : String(q.source);
  if (q.win === 'true') f.isWin = true;
  if (ymd.safeParse(q.from).success || ymd.safeParse(q.to).success) {
    f.createdAt = {};
    if (ymd.safeParse(q.from).success) f.createdAt.$gte = istDayRange(q.from).$gte;
    if (ymd.safeParse(q.to).success) f.createdAt.$lt = istDayRange(q.to).$lt;
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(String(q.q).trim().slice(0, 40)), 'i');
    f.$or = [{ name: rx }, { phone: rx }, { code: rx }, { city: rx }];
  }
  return f;
}

/* ------------------------------------------------------------------ public (mounted at /public/wheels) */
export const publicRoutes = Router();
const spinLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many attempts, try later' } });
const short = (n) => z.string().max(n).optional();

publicRoutes.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const w = await SpinWheel.findById(req.params.id).lean();
  if (!w || !svc.isLive(w)) throw ApiError.notFound('Offer not available');
  // weights and stock stay on the server
  ok(res, { _id: w._id, title: w.title, subtitle: w.subtitle, buttonText: w.buttonText, terms: w.terms, validDays: w.validDays, segments: w.segments.map((s) => ({ label: s.label, color: s.color, textColor: s.textColor, kind: s.kind })) });
}));
publicRoutes.post('/:id/spin', spinLimiter, validate({
  params: idParam,
  body: z.object({
    name: z.string().trim().min(2).max(80), phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile'), formSlug: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
    utm: z.object({ source: short(100), medium: short(100), campaign: short(150), term: short(150), content: short(150), gclid: short(200), fbclid: short(200) }).partial().optional(),
    pageUrl: short(500), referrer: short(500), language: short(20), website: z.string().max(0).optional(), // honeypot
  }),
}), asyncHandler(async (req, res) => {
  ok(res, await svc.spin(req.params.id, req.body, req));
}));
