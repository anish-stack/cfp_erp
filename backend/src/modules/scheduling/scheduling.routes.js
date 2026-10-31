import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit, hasPerm } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, time, ymd } from '../../utils/zod.js';
import { ScheduleException } from '../../models/ScheduleException.js';
import { availability, mergeAny } from './scheduling.service.js';

const availQuery = z.object({ branch: objectId, date: ymd, doctor: z.union([objectId, z.literal('any')]).optional() });

const exBody = z
  .object({
    type: z.enum(['holiday', 'leave', 'special_day', 'block']),
    branch: objectId.nullable().optional(),
    doctor: objectId.nullable().optional(),
    date: ymd,
    dateTo: ymd.optional(), // creates one per day for ranges (holidays/leave)
    sessions: z.array(z.object({ start: time, end: time }).refine((s) => s.start < s.end, 'start<end')).max(6).default([]),
    reason: z.string().max(200).optional(),
  })
  .refine((d) => d.type !== 'leave' || d.doctor, 'Leave needs a doctor')
  .refine((d) => !['special_day', 'block'].includes(d.type) || d.sessions.length, 'Sessions required');

const r = Router();

/** public availability (booking portal) */
export const publicAvailability = asyncHandler(async (req, res) => {
  const per = await availability({ branchId: req.query.branch, date: req.query.date, doctorId: req.query.doctor === 'any' ? null : req.query.doctor, onlineOnly: true });
  ok(res, { doctors: per, any: mergeAny(per) });
});
r.get('/public/availability', validate({ query: availQuery }), publicAvailability);

r.use(auth, branchScope);

r.get('/availability', permit('appointments.view'), validate({ query: availQuery }), asyncHandler(async (req, res) => {
  req.assertBranch(req.query.branch);
  const per = await availability({ branchId: req.query.branch, date: req.query.date, doctorId: req.query.doctor === 'any' ? null : req.query.doctor, staff: true });
  ok(res, { doctors: per, any: mergeAny(per) });
}));

r.get('/exceptions', permit('slots.view'), validate({ query: z.object({ from: ymd, to: ymd, doctor: objectId.optional(), type: z.string().optional() }) }), asyncHandler(async (req, res) => {
  const f = { date: { $gte: req.query.from, $lte: req.query.to } };
  if (req.query.doctor) f.doctor = req.query.doctor;
  if (req.query.type) f.type = req.query.type;
  if (req.activeBranch) f.branch = { $in: [req.activeBranch, null] };
  else if (req.allowedBranches) f.branch = { $in: [...req.allowedBranches, null] };
  ok(res, await ScheduleException.find(f).populate('branch', 'name code').populate('doctor', 'name').sort({ date: 1 }).lean());
}));

r.post('/exceptions', permit('slots.create'), validate({ body: exBody }), asyncHandler(async (req, res) => {
  const { dateTo, ...d } = req.body;
  if (d.branch) req.assertBranch(d.branch);
  else if (!req.isSuperAdmin && !req.user.allBranches) throw ApiError.forbidden('Only global admins can create all-branch exceptions');
  if (dateTo && dateTo < d.date) throw ApiError.badRequest('dateTo before date');

  const dates = [];
  for (let cur = new Date(`${d.date}T00:00:00Z`); ; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const s = cur.toISOString().slice(0, 10);
    if (s > (dateTo || d.date)) break;
    dates.push(s);
    if (dates.length > 60) throw ApiError.badRequest('Range max 60 days');
  }
  // leave raised without approve permission → pending
  const status = d.type === 'leave' && !hasPerm(req, 'slots.approve') ? 'pending' : 'approved';
  const docs = await ScheduleException.insertMany(dates.map((date) => ({ ...d, date, status, createdBy: req.user._id })));
  audit(req, { action: 'slots.create', entity: 'ScheduleException', branch: d.branch, after: { ...d, dates, status } });
  ok(res, docs, 201);
}));

r.patch('/exceptions/:id/approve', permit('slots.approve'), validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(['approved', 'rejected']) }) }), asyncHandler(async (req, res) => {
  const ex = await ScheduleException.findById(req.params.id);
  if (!ex) throw ApiError.notFound();
  if (ex.branch) req.assertBranch(ex.branch);
  ex.status = req.body.status;
  ex.approvedBy = req.user._id;
  await ex.save();
  audit(req, { action: 'slots.approve', entity: 'ScheduleException', entityId: ex._id, branch: ex.branch, after: ex });
  ok(res, ex);
}));

r.delete('/exceptions/:id', permit('slots.delete'), validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
  const ex = await ScheduleException.findById(req.params.id);
  if (!ex) throw ApiError.notFound();
  if (ex.branch) req.assertBranch(ex.branch);
  else if (!req.isSuperAdmin && !req.user.allBranches) throw ApiError.forbidden();
  await ex.deleteOne();
  audit(req, { action: 'slots.delete', entity: 'ScheduleException', entityId: ex._id, branch: ex.branch, before: ex });
  ok(res, { deleted: true });
}));

export default r;
