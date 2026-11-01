import { Router } from 'express';
import { z } from 'zod';
import { permit } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, paged, parsePaging } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, ymd } from '../../utils/zod.js';
import { Broadcast } from '../../models/Marketing.js';
import { Patient } from '../../models/Patient.js';
import { Lead, LEAD_SOURCES } from '../../models/Crm.js';
import { Product } from '../../models/Inventory.js';
import { getSettings } from '../../models/Settings.js';
import { notificationsQueue } from '../../jobs/queues.js';
import { sendWapp } from '../../services/wapp.js';
import * as svc from './marketing.service.js';

/** Marketing → bulk WhatsApp broadcasts (packages, lab offers, health info, camps) */
const r = Router();
const idParam = z.object({ id: objectId });

const audience = z.object({
  patients: z.boolean().default(true), leads: z.boolean().default(false), branches: z.array(objectId).max(20).default([]),
  visitedFrom: ymd.optional().or(z.literal('')), visitedTo: ymd.optional().or(z.literal('')), gender: z.enum(['male', 'female']).nullable().optional(),
  ageMin: z.number().int().min(0).max(120).nullable().optional(), ageMax: z.number().int().min(0).max(120).nullable().optional(),
  leadStages: z.array(objectId).max(20).default([]), leadSources: z.array(z.enum(LEAD_SOURCES)).max(20).default([]), condition: z.string().max(60).optional(),
  extraNumbers: z.array(z.string().max(20)).max(2000).default([]),
});
const body = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(['package', 'lab_offer', 'health_info', 'camp', 'festival', 'reminder', 'other']).default('other'),
  message: z.string().trim().min(5).max(3000),
  mediaUrl: z.string().url().startsWith('https://').optional().or(z.literal('')),
  mediaType: z.enum(['image', 'pdf']).nullable().optional(),
  audience,
  gapSeconds: z.number().int().min(1).max(120).default(4),
});

r.get('/broadcasts', permit('marketing.view'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const f = req.query.status ? { status: req.query.status } : {};
  const [items, total] = await Promise.all([Broadcast.find(f).populate('createdBy', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Broadcast.countDocuments(f)]);
  paged(res, { items, total, page, limit });
}));
r.get('/broadcasts/:id', permit('marketing.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const b = await Broadcast.findById(req.params.id).populate('createdBy', 'name').lean();
  if (!b) throw ApiError.notFound('Campaign not found');
  ok(res, b);
}));
r.post('/broadcasts', permit('marketing.create'), validate({ body }), asyncHandler(async (req, res) => {
  const b = await Broadcast.create({ ...req.body, mediaUrl: req.body.mediaUrl || undefined, createdBy: req.user._id });
  audit(req, { action: 'marketing.create', entity: 'Broadcast', entityId: b._id, after: { name: b.name } });
  ok(res, b, 201);
}));
r.patch('/broadcasts/:id', permit('marketing.edit'), validate({ params: idParam, body: body.partial() }), asyncHandler(async (req, res) => {
  const b = await Broadcast.findById(req.params.id);
  if (!b) throw ApiError.notFound('Campaign not found');
  if (!['draft', 'scheduled'].includes(b.status)) throw ApiError.badRequest('Already sent');
  Object.assign(b, req.body);
  await b.save();
  ok(res, b);
}));
r.delete('/broadcasts/:id', permit('marketing.delete'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const b = await Broadcast.findOneAndDelete({ _id: req.params.id, status: { $in: ['draft', 'cancelled'] } });
  if (!b) throw ApiError.badRequest('Only drafts or cancelled campaigns can be deleted');
  ok(res, { deleted: true });
}));

/** audience size + sample (also for unsaved forms) */
r.post('/audience', permit('marketing.view'), validate({ body: z.object({ audience }) }), asyncHandler(async (req, res) => {
  const list = await svc.resolveAudience(req.body.audience);
  ok(res, { count: list.length, capped: list.length >= svc.MAX_RECIPIENTS, sample: list.slice(0, 8).map((x) => ({ name: x.name, to: `${x.to.slice(0, 2)}XXXXXX${x.to.slice(-2)}` })) });
}));

r.post('/broadcasts/:id/test', permit('marketing.create'), validate({ params: idParam, body: z.object({ to: z.string().min(10).max(15) }) }), asyncHandler(async (req, res) => {
  const b = await Broadcast.findById(req.params.id).lean();
  if (!b) throw ApiError.notFound('Campaign not found');
  const msg = await svc.render(b.message, { name: req.user.name });
  const media = b.mediaUrl ? (b.mediaType === 'pdf' ? { pdf: b.mediaUrl } : { img1: b.mediaUrl }) : {};
  const out = await sendWapp({ to: req.body.to, msg: `[TEST] ${msg}`, ...media, event: 'marketing.test', refType: 'Broadcast', refId: b._id });
  ok(res, { sent: !out?.skipped, skipped: out?.skipped ? out.reason || 'not sent (demo / not configured)' : undefined });
}));

r.post('/broadcasts/:id/send', permit('marketing.approve'), validate({ params: idParam, body: z.object({ scheduledAt: z.coerce.date().optional() }) }), asyncHandler(async (req, res) => {
  const b = await Broadcast.findById(req.params.id);
  if (!b) throw ApiError.notFound('Campaign not found');
  if (b.status !== 'draft') throw ApiError.badRequest(`Campaign is ${b.status}`);
  const n = (await svc.resolveAudience(b.audience)).length;
  if (!n) throw ApiError.badRequest('No recipients match this audience');
  const delay = req.body.scheduledAt ? Math.max(0, new Date(req.body.scheduledAt) - Date.now()) : 0;
  b.status = 'scheduled';
  b.scheduledAt = req.body.scheduledAt || new Date();
  b.stats.total = n;
  await b.save();
  await notificationsQueue.add('broadcast.run', { id: String(b._id) }, { delay, jobId: `bc-run-${b._id}`, removeOnComplete: true });
  audit(req, { action: 'marketing.send', entity: 'Broadcast', entityId: b._id, meta: { recipients: n, scheduledAt: b.scheduledAt } });
  ok(res, b);
}));
r.post('/broadcasts/:id/cancel', permit('marketing.approve'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const b = await Broadcast.findOneAndUpdate({ _id: req.params.id, status: { $in: ['scheduled', 'sending'] } }, { $set: { status: 'cancelled', finishedAt: new Date() } }, { new: true });
  if (!b) throw ApiError.badRequest('Nothing to cancel');
  audit(req, { action: 'marketing.cancel', entity: 'Broadcast', entityId: b._id });
  ok(res, b);
}));

/** ready-made message templates built from live prices */
r.get('/templates', permit('marketing.view'), asyncHandler(async (_req, res) => {
  const s = await getSettings();
  const { IpdPackage } = await import('../../models/Ipd.js');
  const [pkgs, svcs] = await Promise.all([IpdPackage.find({ isActive: true }).select('name price includedDays').sort({ price: 1 }).limit(8).lean(), Product.find({ type: 'service', isActive: true, sellPrice: { $gt: 0 } }).select('name sellPrice').sort({ sellPrice: 1 }).limit(10).lean()]);
  const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const clinic = s.clinic?.name || 'our clinic';
  const t = [];
  if (pkgs.length) t.push({ category: 'package', name: 'Treatment packages', message: `Hello {first} 🙏\n\n*${clinic}* — all-inclusive treatment packages:\n${pkgs.map((p) => `• ${p.name.replace(/ — .*$/, '')}: *${inr(p.price)}*${p.includedDays ? ` (incl. ${p.includedDays} day stay)` : ''}`).join('\n')}\n\nFree consultation · Insurance & cashless available.\n📞 Call {phone} to book.` });
  t.push({ category: 'lab_offer', name: 'Lab test prices', message: `Hello {first},\n\nPre-procedure health check at *${clinic}*:\n• CBC — ₹350\n• Blood sugar (F/PP) — ₹250\n• HbA1c — ₹500\n• Viral markers (HIV, HBsAg, HCV) — ₹1,200\n\nReports the same day. Visit any branch or call {phone}.` });
  if (svcs.length) t.push({ category: 'package', name: 'Procedure price list', message: `Hello {first},\n\n*${clinic}* procedure charges:\n${svcs.map((p) => `• ${p.name}: ${inr(p.sellPrice)}`).join('\n')}\n\nFirst consultation free. Call {phone}.` });
  t.push({ category: 'health_info', name: 'Health tip — piles prevention', message: `Hello {first} 👋\n\nSimple habits that help prevent piles & fissure:\n1. 3–4 litres of water a day\n2. Fibre: fruits, salad, whole grains, isabgol at bedtime\n3. Don't sit on the toilet for long or strain\n4. Walk 30 minutes daily\n5. Avoid very spicy, oily food\n\nBleeding or pain? Get a free check-up at *${clinic}* — call {phone}.` });
  t.push({ category: 'camp', name: 'Free check-up camp', message: `Hello {first},\n\n🩺 *Free Piles & Fistula check-up camp* at ${clinic}, {branch} branch.\n📅 Date: __ / __\n⏰ 10 AM – 5 PM\n\nConsultation by our senior surgeons, free of cost. Reply YES or call {phone} to reserve your slot.` });
  t.push({ category: 'reminder', name: 'Follow-up reminder', message: `Hello {first},\n\nIt has been a while since your last visit to *${clinic}*. A quick review helps make sure you are healing well.\n\nBook a free follow-up: call {phone}.` });
  ok(res, t);
}));

/** marketing opt-out for a patient (all family profiles on the mobile) or a lead */
r.post('/optout', permit('marketing.edit'), validate({ body: z.object({ type: z.enum(['patient', 'lead']), id: objectId, optOut: z.boolean() }) }), asyncHandler(async (req, res) => {
  if (req.body.type === 'patient') {
    const p = await Patient.findById(req.body.id).select('mobile').lean();
    if (!p) throw ApiError.notFound('Patient not found');
    await Patient.updateMany({ mobile: p.mobile }, { $set: { marketingOptOut: req.body.optOut } });
  } else await Lead.updateOne({ _id: req.body.id }, { $set: { marketingOptOut: req.body.optOut } });
  audit(req, { action: 'marketing.optout', entity: req.body.type === 'patient' ? 'Patient' : 'Lead', entityId: req.body.id, after: req.body });
  ok(res, { ok: true });
}));

export default r;
