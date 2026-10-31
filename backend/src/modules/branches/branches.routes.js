import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, time } from '../../utils/zod.js';
import { Branch } from '../../models/Branch.js';

const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const settings = z.object({
  slotMinutes: z.number().int().min(5).max(240),
  gapMinutes: z.number().int().min(0).max(120),
  openTime: time,
  closeTime: time,
  breaks: z.array(z.object({ label: z.string().max(40).optional(), start: time, end: time })).max(5),
  weeklyOff: z.array(z.number().int().min(0).max(6)).max(7),
  bookingWindowDays: z.number().int().min(1).max(180),
  minLeadMinutes: z.number().int().min(0).max(1440),
  invoicePrefix: z.string().max(10).optional(),
}).partial().refine((s) => !s.openTime || !s.closeTime || s.openTime < s.closeTime, 'openTime must be before closeTime');

const body = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, '2-5 letters'),
  address: z.object({
    line1: z.string().max(200).optional(), line2: z.string().max(200).optional(), city: z.string().max(60).optional(),
    state: z.string().max(60).optional(), pincode: z.string().regex(/^\d{6}$/).optional(), mapUrl: z.string().url().optional(),
  }).optional(),
  phone: z.string().max(15).optional(),
  whatsapp: z.string().max(15).optional(),
  email: z.string().email().optional(),
  gstin: z.string().regex(/^[0-9A-Z]{15}$/, 'Invalid GSTIN').optional(),
  isActive: z.boolean().optional(),
  acceptsOnlineBooking: z.boolean().optional(),
});
const idParam = z.object({ id: objectId });

const PUBLIC_FIELDS = 'name code slug address phone whatsapp settings.openTime settings.closeTime settings.weeklyOff';

const r = Router();

// public (booking portal + website)
r.get('/public', asyncHandler(async (_req, res) => {
  ok(res, await Branch.find({ isActive: true, acceptsOnlineBooking: true }).select(PUBLIC_FIELDS).sort({ name: 1 }).lean());
}));

r.use(auth, branchScope);

// minimal list of all active branches (transfer destinations, labels) — any staff
r.get('/names', asyncHandler(async (_req, res) => {
  ok(res, await Branch.find({ isActive: true }).select('name code').sort({ name: 1 }).lean());
}));

r.get('/', permit('branches.view'), asyncHandler(async (req, res) => {
  const filter = req.allowedBranches ? { _id: { $in: req.allowedBranches } } : {};
  ok(res, await Branch.find(filter).sort({ name: 1 }).lean());
}));

r.get('/:id', permit('branches.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  req.assertBranch(req.params.id);
  const b = await Branch.findById(req.params.id);
  if (!b) throw ApiError.notFound('Branch not found');
  ok(res, b);
}));

r.post('/', permit('branches.create'), validate({ body: body.extend({ settings: settings.optional() }) }), asyncHandler(async (req, res) => {
  const b = await Branch.create({ ...req.body, slug: slugify(req.body.name) });
  audit(req, { action: 'branches.create', entity: 'Branch', entityId: b._id, branch: b._id, after: b });
  ok(res, b, 201);
}));

r.patch('/:id', permit('branches.edit'), validate({ params: idParam, body: body.partial() }), asyncHandler(async (req, res) => {
  req.assertBranch(req.params.id);
  const b = await Branch.findById(req.params.id);
  if (!b) throw ApiError.notFound('Branch not found');
  const before = b.toObject();
  Object.assign(b, req.body);
  if (req.body.name) b.slug = slugify(req.body.name);
  await b.save();
  audit(req, { action: 'branches.edit', entity: 'Branch', entityId: b._id, branch: b._id, before, after: b });
  ok(res, b);
}));

r.patch('/:id/settings', permit('branches.manage_settings'), validate({ params: idParam, body: settings }), asyncHandler(async (req, res) => {
  req.assertBranch(req.params.id);
  const b = await Branch.findById(req.params.id);
  if (!b) throw ApiError.notFound('Branch not found');
  const before = b.settings.toObject();
  b.set('settings', { ...before, ...req.body });
  await b.save();
  audit(req, { action: 'branches.manage_settings', entity: 'Branch', entityId: b._id, branch: b._id, before, after: b.settings });
  ok(res, b);
}));

export default r;
