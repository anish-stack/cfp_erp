import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { objectId } from '../../utils/zod.js';
import { EnquiryForm, LEAD_SOURCES } from '../../models/Crm.js';
import { Branch } from '../../models/Branch.js';
import { getSettings } from '../../models/Settings.js';
import { createLead } from '../crm/crm.service.js';
import { verifyDocLink } from '../../utils/signedLink.js';
import { streamDocument } from '../../services/documents.js';
import { logoPath } from '../../services/branding.js';
import { cfg } from '../../services/runtimeConfig.js';

/** Website / landing-page facing endpoints (no login). Rate limited. */
const r = Router();

const submitLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many submissions, try later' } });

const utm = z.object({ source: z.string().max(100), medium: z.string().max(100), campaign: z.string().max(150), term: z.string().max(150), content: z.string().max(150), gclid: z.string().max(200), fbclid: z.string().max(200), landingUrl: z.string().max(500) }).partial();

r.get('/clinic', asyncHandler(async (_req, res) => {
  const s = await getSettings();
  const logo = s.clinic?.logoFile ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/public/logo?v=${new Date(s.clinic.logoUpdatedAt || 0).getTime()}` : null;
  ok(res, { appName: cfg.APP_NAME, clinic: { name: s.clinic?.name, tagline: s.clinic?.tagline, phone: s.clinic?.phone, whatsapp: s.clinic?.whatsapp, email: s.clinic?.email, website: s.clinic?.website, logo }, theme: { console: s.theme?.console || {}, booking: s.theme?.booking || {} } });
}));

/** uploaded clinic logo (public: shown on booking portal, login screen) */
r.get('/logo', asyncHandler(async (_req, res) => {
  const s = await getSettings();
  const p = logoPath(s.clinic?.logoFile);
  if (!p) throw ApiError.notFound('No logo');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(p);
}));

r.get('/forms/:slug', validate({ params: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) }) }), asyncHandler(async (req, res) => {
  const f = await EnquiryForm.findOne({ slug: req.params.slug, isActive: true }).select('name slug kind page fields successMessage redirectUrl branch blocks design').lean();
  if (!f) throw ApiError.notFound('Form not found');
  const branches = f.fields.some((x) => x.mapTo === 'branch') ? await Branch.find({ isActive: true }).select('name').sort({ name: 1 }).lean() : [];
  ok(res, { ...f, branches });
}));

r.post('/forms/:slug/submit', submitLimiter, validate({ params: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) }), body: z.object({ data: z.record(z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.string().max(200)).max(20)])), utm: utm.optional(), website: z.string().max(0).optional() /* honeypot */ }) }), asyncHandler(async (req, res) => {
  const form = await EnquiryForm.findOne({ slug: req.params.slug, isActive: true });
  if (!form) throw ApiError.notFound('Form not found');

  const errors = [];
  const mapped = {};
  for (const f of form.fields) {
    const v = req.body.data[f.key];
    const empty = v === undefined || v === '' || (Array.isArray(v) && !v.length);
    if (f.required && empty) errors.push({ path: f.key, message: `${f.label} is required` });
    if (!empty && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) errors.push({ path: f.key, message: 'Invalid email' });
    if (!empty && ['select', 'radio'].includes(f.type) && f.options?.length && !f.options.includes(String(v))) errors.push({ path: f.key, message: 'Invalid option' });
    if (f.mapTo && !empty) mapped[f.mapTo] = String(v).trim();
  }
  if (!mapped.phone) errors.push({ path: 'phone', message: 'Mobile number required' });
  if (errors.length) throw ApiError.badRequest('Validation failed', errors);

  let branch = form.branch;
  if (mapped.branch && /^[a-f0-9]{24}$/.test(mapped.branch)) branch = mapped.branch;
  const formData = Object.fromEntries(form.fields.map((f) => [f.label, req.body.data[f.key]]).filter(([, v]) => v !== undefined));

  await createLead(
    { name: mapped.name || 'Website enquiry', phone: mapped.phone, email: mapped.email, city: mapped.city, condition: mapped.condition, branch, campaign: form.campaign, form: form._id, formData, utm: req.body.utm, source: req.body.utm?.source ? undefined : form.defaultSource, assignedTo: form.assignTo },
    { allowDuplicate: true, autoReply: true }
  );
  await EnquiryForm.updateOne({ _id: form._id }, { $inc: { submissions: 1 } });
  ok(res, { message: form.successMessage, redirectUrl: form.redirectUrl || null }, 201);
}));

/**
 * Signed, expiring PDF links (sent on WhatsApp; the provider downloads them).
 * /public/docs/invoice/<id>.pdf?e=<unix>&s=<hmac>
 */
const docLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
async function serveDoc(req, res, type, id, e, s) {
  if (!/^[a-f0-9]{24}$/.test(id) || !verifyDocLink(type, id, e, s)) throw ApiError.notFound('Link invalid or expired');
  return renderPublicDoc(res, type, id);
}
// current format: /docs/<type>/<id>/<exp>/<sig>/<name>.pdf
r.get('/docs/:type/:id/:e/:s/:name', docLimiter, asyncHandler((req, res) => serveDoc(req, res, req.params.type, req.params.id, req.params.e, req.params.s)));
// legacy format: /docs/<type>/<id>.pdf?e=&s=
r.get('/docs/:type/:file', docLimiter, asyncHandler((req, res) => serveDoc(req, res, req.params.type, String(req.params.file).replace(/\.pdf$/, ''), req.query.e, req.query.s)));

async function renderPublicDoc(res, type, id) {
  res.setHeader('X-Robots-Tag', 'noindex');
  return streamDocument(res, type, id);
}

/** Server-to-server lead push from main website / ad platforms. Header: x-api-key */
const keyOk = (k) => {
  if (!env.WEBSITE_API_KEY || !k) return false;
  const a = Buffer.from(String(k));
  const b = Buffer.from(env.WEBSITE_API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

r.post('/leads', submitLimiter, validate({ body: z.object({ name: z.string().max(80).default('Website enquiry'), phone: z.string().min(10).max(15), email: z.string().email().optional(), city: z.string().max(60).optional(), condition: z.string().max(80).optional(), message: z.string().max(2000).optional(), branch: objectId.optional(), source: z.enum(LEAD_SOURCES).optional(), utm: utm.optional() }) }), asyncHandler(async (req, res) => {
  if (!keyOk(req.get('x-api-key'))) throw ApiError.unauthorized('Invalid API key');
  const { message, ...data } = req.body;
  const { lead } = await createLead({ ...data, formData: message ? { Message: message } : undefined, source: data.source || (data.utm?.source ? undefined : 'website') }, { allowDuplicate: true, autoReply: true });
  ok(res, { id: lead._id }, 201);
}));

export default r;
