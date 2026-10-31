import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, escapeRegex } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, time } from '../../utils/zod.js';
import { Doctor } from '../../models/Doctor.js';
import { DoctorSchedule } from '../../models/DoctorSchedule.js';
import { User } from '../../models/User.js';
import fs from 'node:fs';
import { privateUpload, safeJoin } from '../../middleware/upload.js';
import { hasPerm } from '../../middleware/permit.js';

const sigUpload = privateUpload('signatures');

const body = z.object({
  name: z.string().trim().min(2).max(80),
  user: objectId.nullable().optional(),
  qualification: z.string().max(120).optional(),
  specialization: z.string().max(80).optional(),
  regNo: z.string().max(40).optional(),
  experienceYears: z.number().int().min(0).max(70).optional(),
  photo: z.string().url().optional().or(z.literal('')),
  bio: z.string().max(1000).optional(),
  phone: z.string().max(15).optional(),
  email: z.string().email().optional().or(z.literal('')),
  branches: z.array(objectId).min(1),
  consultationFee: z.number().min(0).optional(),
  followUpFee: z.number().min(0).optional(),
  acceptsOnlineBooking: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const session = z.object({ start: time, end: time }).refine((s) => s.start < s.end, 'start must be before end');
const weekBody = z.object({
  branch: objectId,
  days: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        sessions: z.array(session).max(4),
        slotMinutes: z.number().int().min(5).max(240).optional().nullable(),
        gapMinutes: z.number().int().min(0).max(120).optional().nullable(),
        capacityPerSlot: z.number().int().min(1).max(20).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .max(7),
});
const idParam = z.object({ id: objectId });

const r = Router();

// public: doctors by branch (booking portal)
r.get('/public', validate({ query: z.object({ branch: objectId }) }), asyncHandler(async (req, res) => {
  ok(res, await Doctor.find({ branches: req.query.branch, isActive: true, acceptsOnlineBooking: true })
    .select('name qualification specialization photo experienceYears consultationFee bio').sort({ name: 1 }).lean());
}));

r.use(auth, branchScope);

r.get('/', permit('doctors.view'), asyncHandler(async (req, res) => {
  const f = {};
  if (req.allowedBranches || req.activeBranch) Object.assign(f, req.branchFilter('branches'));
  if (req.query.q) f.name = new RegExp(escapeRegex(String(req.query.q)), 'i');
  if (req.query.active !== undefined) f.isActive = req.query.active === 'true';
  ok(res, await Doctor.find(f).populate('branches', 'name code').populate('user', 'name email').sort({ name: 1 }).lean());
}));

r.get('/:id', permit('doctors.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const d = await Doctor.findById(req.params.id).populate('branches', 'name code').populate('user', 'name email');
  if (!d) throw ApiError.notFound('Doctor not found');
  if (!d.branches.some((b) => req.canAccessBranch(b._id))) throw ApiError.forbidden();
  ok(res, d);
}));

const linkUser = async (doctorId, userId) => {
  await User.updateMany({ doctor: doctorId, _id: { $ne: userId } }, { $unset: { doctor: 1 } });
  if (userId) await User.updateOne({ _id: userId }, { doctor: doctorId });
};

r.post('/', permit('doctors.create'), validate({ body }), asyncHandler(async (req, res) => {
  req.body.branches.forEach((b) => req.assertBranch(b));
  const d = await Doctor.create(req.body);
  if (req.body.user) await linkUser(d._id, req.body.user);
  // single-branch doctor → bookable immediately with the branch's opening hours (edit later)
  if (d.branches.length === 1) {
    const { Branch } = await import('../../models/Branch.js');
    const b = await Branch.findById(d.branches[0]).lean();
    const off = b?.settings?.weeklyOff || [];
    const ops = [0, 1, 2, 3, 4, 5, 6].filter((w) => !off.includes(w)).map((weekday) => ({
      updateOne: { filter: { doctor: d._id, branch: b._id, weekday }, update: { $set: { sessions: [{ start: b.settings?.openTime || '10:00', end: b.settings?.closeTime || '19:00' }], capacityPerSlot: 1, isActive: true } }, upsert: true },
    }));
    if (ops.length) await DoctorSchedule.bulkWrite(ops);
  }
  audit(req, { action: 'doctors.create', entity: 'Doctor', entityId: d._id, after: d });
  ok(res, d, 201);
}));

r.patch('/:id', permit('doctors.edit'), validate({ params: idParam, body: body.partial() }), asyncHandler(async (req, res) => {
  const d = await Doctor.findById(req.params.id);
  if (!d) throw ApiError.notFound('Doctor not found');
  if (!d.branches.some((b) => req.canAccessBranch(b))) throw ApiError.forbidden();
  req.body.branches?.forEach((b) => req.assertBranch(b));
  const before = d.toObject();
  Object.assign(d, req.body);
  await d.save();
  if (req.body.user !== undefined) await linkUser(d._id, req.body.user);
  audit(req, { action: 'doctors.edit', entity: 'Doctor', entityId: d._id, before, after: d });
  ok(res, d);
}));

// ---------- signature (printed on prescriptions) — admins with doctors.edit, or the doctor themself
const canEditSig = (req, id) => hasPerm(req, 'doctors.edit') || String(req.user.doctor || '') === String(id);
r.get('/:id/signature', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const d = await Doctor.findById(req.params.id).select('signature branches').lean();
  if (!d?.signature?.storedName) throw ApiError.notFound('No signature');
  const p = safeJoin('signatures', d.signature.storedName);
  if (!fs.existsSync(p)) throw ApiError.notFound('No signature');
  res.setHeader('Content-Type', d.signature.mime || 'image/png');
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(p).pipe(res);
}));
r.post('/:id/signature', validate({ params: idParam }), (req, res, next) => (canEditSig(req, req.params.id) ? next() : next(ApiError.forbidden())), sigUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Upload a PNG or JPG image');
  if (!/^image\/(png|jpeg)$/.test(req.file.mimetype)) { fs.unlink(req.file.path, () => {}); throw ApiError.badRequest('Signature must be PNG or JPG'); }
  const d = await Doctor.findById(req.params.id);
  if (!d) { fs.unlink(req.file.path, () => {}); throw ApiError.notFound('Doctor not found'); }
  const old = d.signature?.storedName;
  d.signature = { storedName: req.file.filename, mime: req.file.mimetype, updatedAt: new Date() };
  await d.save();
  if (old) fs.unlink(safeJoin('signatures', old), () => {});
  audit(req, { action: 'doctors.signature_upload', entity: 'Doctor', entityId: d._id });
  ok(res, { signature: d.signature });
}));
r.delete('/:id/signature', validate({ params: idParam }), asyncHandler(async (req, res) => {
  if (!canEditSig(req, req.params.id)) throw ApiError.forbidden();
  const d = await Doctor.findById(req.params.id);
  if (!d) throw ApiError.notFound('Doctor not found');
  if (d.signature?.storedName) fs.unlink(safeJoin('signatures', d.signature.storedName), () => {});
  d.signature = undefined;
  await d.save();
  audit(req, { action: 'doctors.signature_remove', entity: 'Doctor', entityId: d._id });
  ok(res, { removed: true });
}));

// weekly schedule
r.get('/:id/schedules', permit('slots.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const f = { doctor: req.params.id, ...(req.allowedBranches || req.activeBranch ? req.branchFilter('branch') : {}) };
  ok(res, await DoctorSchedule.find(f).populate('branch', 'name code').sort({ branch: 1, weekday: 1 }).lean());
}));

r.put('/:id/schedules', permit('slots.edit'), validate({ params: idParam, body: weekBody }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.branch);
  const d = await Doctor.findById(req.params.id);
  if (!d) throw ApiError.notFound('Doctor not found');
  if (!d.branches.some((b) => String(b) === req.body.branch)) throw ApiError.badRequest('Doctor not assigned to this branch');
  const before = await DoctorSchedule.find({ doctor: d._id, branch: req.body.branch }).lean();
  const ops = req.body.days.map((day) => {
    const $set = { sessions: day.sessions, capacityPerSlot: day.capacityPerSlot ?? 1, isActive: day.isActive ?? true };
    const $unset = {};
    // null/absent → fall back to branch settings
    for (const k of ['slotMinutes', 'gapMinutes']) {
      if (day[k] != null) $set[k] = day[k];
      else $unset[k] = 1;
    }
    return {
      updateOne: {
        filter: { doctor: d._id, branch: req.body.branch, weekday: day.weekday },
        update: { $set, ...(Object.keys($unset).length ? { $unset } : {}) },
        upsert: true,
      },
    };
  });
  if (ops.length) await DoctorSchedule.bulkWrite(ops);
  const after = await DoctorSchedule.find({ doctor: d._id, branch: req.body.branch }).sort({ weekday: 1 }).lean();
  audit(req, { action: 'slots.edit', entity: 'DoctorSchedule', entityId: d._id, branch: req.body.branch, before, after });
  ok(res, after);
}));

export default r;
