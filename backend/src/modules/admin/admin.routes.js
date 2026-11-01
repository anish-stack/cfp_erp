import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit, hasPerm } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, parsePaging } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { crudRouter } from '../../utils/crud.js';
import { objectId, ymd } from '../../utils/zod.js';
import { Settings, getSettings, clearSettingsCache } from '../../models/Settings.js';
import { Expense, EXPENSE_CATEGORIES, NotificationLog, Webhook, WEBHOOK_EVENTS } from '../../models/Misc.js';
import { notificationsQueue } from '../../jobs/queues.js';
import multer from 'multer';
import { saveLogo, removeLogoFile } from '../../services/branding.js';

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

const r = Router();
r.use(auth, branchScope);
const idParam = z.object({ id: objectId });

// ---------- settings ----------
r.get('/settings', permit('settings.view'), asyncHandler(async (_req, res) => ok(res, await getSettings())));

const settingsBody = z.object({
  clinic: z.object({ name: z.string().max(120), legalName: z.string().max(160), tagline: z.string().max(160), website: z.string().max(200), phone: z.string().max(20), whatsapp: z.string().max(20), email: z.string().max(120), gstin: z.string().max(15), address: z.string().max(400), logoUrl: z.string().max(500) }).partial(),
  billing: z.object({ gstEnabled: z.boolean(), taxInclusive: z.boolean(), consultationGst: z.number().min(0).max(28), invoiceFooter: z.string().max(300), allowNegativeStock: z.boolean(), showLogoOnPdf: z.boolean() }).partial(),
  inventory: z.object({ expiryAlertDays: z.number().int().min(7).max(365) }).partial(),
  loyalty: z.object({ enabled: z.boolean(), earnPer100: z.number().min(0).max(100), pointValue: z.number().min(0.01).max(100), minRedeem: z.number().int().min(0).max(100000), maxRedeemPct: z.number().min(0).max(100), expiryDays: z.number().int().min(0).max(3650), earnOnServices: z.boolean() }).partial(),
  payments: z.object({
    onlineEnabled: z.boolean(), linkExpiryHours: z.number().int().min(1).max(24 * 30), sendLinkOnWhatsapp: z.boolean(),
    upiId: z.string().trim().max(60).refine((v) => !v || /^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(v), 'UPI ID like clinic@okicici'), upiName: z.string().max(60),
    appointment: z.object({ required: z.boolean(), amountMode: z.enum(['doctor_fee', 'fixed']), amount: z.number().min(1).max(100000), note: z.string().max(200) }).partial(),
  }).partial(),
  print: z.object({ qrUrl: z.string().max(300).refine((v) => !v || /^https?:\/\//.test(v), 'Must start with http(s)://'), showQr: z.boolean(), thermalWidth: z.enum(['58', '80']), thermalQr: z.enum(['payment', 'website', 'none']), thermalFooter: z.string().max(200) }).partial(),
  features: z.object({ ipd: z.boolean(), exotel: z.boolean(), marketing: z.boolean() }).partial(),
  ipd: z.object({ doctorVisitRate: z.number().min(0).max(100000), autoChargeRounds: z.boolean(), otRooms: z.array(z.string().trim().min(1).max(30)).max(20), graceHours: z.number().min(0).max(12), visitingHours: z.string().max(120), passRules: z.string().max(300) }).partial(),
  notifications: z.object(Object.fromEntries(['sms', 'whatsapp', 'email', 'welcome', 'appointmentUpdates', 'checkinToken', 'noShow', 'reminders', 'prescription', 'ipd', 'invoice', 'paymentReceipt', 'refunds', 'followupReminders', 'leadAutoReply', 'staffLeadAlert', 'dailyStockAlerts'].map((k) => [k, z.boolean()]))).partial(),
  theme: z.object({
    console: z.object({ primary: z.string().regex(/^#[0-9a-f]{6}$/i), sidebar: z.string().regex(/^#[0-9a-f]{6}$/i), radius: z.number().min(0).max(20) }).partial(),
    booking: z.object({ primary: z.string().regex(/^#[0-9a-f]{6}$/i), background: z.string().regex(/^#[0-9a-f]{6}$/i) }).partial(),
    pdf: z.string().regex(/^(#[0-9a-f]{6})?$/i),
  }).partial(),
  pdf: z.object({ rxFooter: z.string().max(400), showSignature: z.boolean() }).partial(),
  crm: z.object({
    autoAssign: z.enum(['none', 'round_robin']),
    inboundRouting: z.enum(['lead_owner', 'branch', 'sales_pool']),
    ivrMenu: z.array(z.object({ digit: z.string().regex(/^[0-9*#]$/), label: z.string().min(1).max(40), branch: objectId.nullable().optional() })).max(10)
      .refine((m) => new Set(m.map((x) => x.digit)).size === m.length, 'Each IVR key once'),
  }).partial(),
}).partial();

r.patch('/settings', permit('settings.manage_settings'), validate({ body: settingsBody }), asyncHandler(async (req, res) => {
  if (req.body.features && !req.isSuperAdmin) throw ApiError.forbidden('Only the Super Admin can enable or disable modules');
  const before = await getSettings();
  const $set = {};
  // nested objects (theme.console.primary …) flattened to dot paths so partial updates don't wipe siblings
  const flat = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(k === 'ivrMenu')) flat(v, `${prefix}.${k}`);
      else $set[`${prefix}.${k}`] = v;
    }
  };
  for (const [section, vals] of Object.entries(req.body)) flat(vals, section);
  const s = await Settings.findByIdAndUpdate('global', { $set }, { upsert: true, new: true });
  clearSettingsCache();
  audit(req, { action: 'settings.manage_settings', entity: 'Settings', before, after: s });
  ok(res, s);
}));

// ---------- clinic logo (PDFs, booking portal, console) ----------
r.post('/settings/logo', permit('settings.manage_settings'), logoUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Choose a PNG or JPG file (max 2 MB)');
  const before = await getSettings();
  const file = saveLogo(req.file.buffer);
  const s = await Settings.findByIdAndUpdate('global', { $set: { 'clinic.logoFile': file, 'clinic.logoUpdatedAt': new Date() } }, { upsert: true, new: true });
  if (before.clinic?.logoFile && before.clinic.logoFile !== file) removeLogoFile(before.clinic.logoFile);
  clearSettingsCache();
  audit(req, { action: 'settings.logo_upload', entity: 'Settings', meta: { file } });
  ok(res, s);
}));

r.delete('/settings/logo', permit('settings.manage_settings'), asyncHandler(async (req, res) => {
  const before = await getSettings();
  const s = await Settings.findByIdAndUpdate('global', { $unset: { 'clinic.logoFile': 1 }, $set: { 'clinic.logoUpdatedAt': new Date() } }, { new: true });
  removeLogoFile(before.clinic?.logoFile);
  clearSettingsCache();
  audit(req, { action: 'settings.logo_remove', entity: 'Settings' });
  ok(res, s);
}));

// ---------- expenses ----------
r.get('/expenses/categories', permit('expenses.view'), (_req, res) => ok(res, EXPENSE_CATEGORIES));
r.use('/expenses', crudRouter({
  model: Expense, module: 'expenses', branchField: 'branch', search: ['paidTo', 'note', 'reference'], sort: { date: -1, createdAt: -1 },
  populate: [{ path: 'branch', select: 'name code' }, { path: 'createdBy', select: 'name' }],
  filters: (req) => {
    const f = { isActive: true };
    if (req.query.category) f.category = req.query.category;
    if (req.query.from || req.query.to) f.date = { ...(req.query.from ? { $gte: String(req.query.from) } : {}), ...(req.query.to ? { $lte: String(req.query.to) } : {}) };
    if (req.query.status) f.status = req.query.status;
    return f;
  },
  beforeCreate: async (req, data) => {
    data.createdBy = req.user._id;
    data.status = hasPerm(req, 'expenses.approve') ? 'approved' : 'pending';
  },
  schema: z.object({
    branch: objectId.optional(), category: z.enum(EXPENSE_CATEGORIES), amount: z.number().positive().max(10_000_000), date: ymd,
    paidTo: z.string().max(120).optional(), mode: z.enum(['cash', 'upi', 'card', 'bank']).optional(), reference: z.string().max(60).optional(), note: z.string().max(500).optional(),
  }),
}));
r.post('/expenses/:id/approve', permit('expenses.approve'), validate({ params: idParam, body: z.object({ status: z.enum(['approved', 'rejected']) }) }), asyncHandler(async (req, res) => {
  const e = await Expense.findById(req.params.id);
  if (!e) throw ApiError.notFound();
  req.assertBranch(e.branch);
  e.status = req.body.status;
  e.approvedBy = req.user._id;
  await e.save();
  audit(req, { action: 'expenses.approve', entity: 'Expense', entityId: e._id, branch: e.branch, after: { status: e.status } });
  ok(res, e);
}));

// ---------- notifications log ----------
r.get('/notifications', permit('notifications.view'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const f = {};
  if (req.query.channel) f.channel = req.query.channel;
  if (req.query.status) f.status = req.query.status;
  const [items, total, queue] = await Promise.all([
    NotificationLog.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    NotificationLog.countDocuments(f),
    notificationsQueue.getJobCounts('waiting', 'delayed', 'active', 'failed').catch(() => null),
  ]);
  res.json({ success: true, data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) || 1, queue } });
}));

// ---------- webhooks ----------
r.get('/webhooks/events', permit('settings.view'), (_req, res) => ok(res, WEBHOOK_EVENTS));
r.get('/webhooks', permit('settings.view'), asyncHandler(async (_req, res) => ok(res, await Webhook.find().sort({ createdAt: -1 }).lean())));
const whBody = z.object({ name: z.string().min(2).max(80), url: z.string().url().refine((u) => u.startsWith('https://'), 'HTTPS required'), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1), isActive: z.boolean().optional() });
r.post('/webhooks', permit('settings.manage_settings'), validate({ body: whBody }), asyncHandler(async (req, res) => {
  const secret = crypto.randomBytes(24).toString('hex');
  const w = await Webhook.create({ ...req.body, secret });
  audit(req, { action: 'settings.webhook_create', entity: 'Webhook', entityId: w._id, after: { ...req.body } });
  ok(res, { ...w.toObject(), secret }, 201); // secret shown once
}));
r.patch('/webhooks/:id', permit('settings.manage_settings'), validate({ params: idParam, body: whBody.partial() }), asyncHandler(async (req, res) => {
  const w = await Webhook.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!w) throw ApiError.notFound();
  ok(res, w);
}));
r.post('/webhooks/:id/rotate', permit('settings.manage_settings'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const secret = crypto.randomBytes(24).toString('hex');
  const w = await Webhook.findByIdAndUpdate(req.params.id, { secret }, { new: true });
  if (!w) throw ApiError.notFound();
  ok(res, { secret });
}));
r.delete('/webhooks/:id', permit('settings.manage_settings'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  await Webhook.deleteOne({ _id: req.params.id });
  ok(res, { deleted: true });
}));

export default r;
