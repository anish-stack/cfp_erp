import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit, hasPerm } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, paged, parsePaging, escapeRegex } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { crudRouter } from '../../utils/crud.js';
import { objectId, ymd, paging } from '../../utils/zod.js';
import { istDayRange, todayIST } from '../../utils/time.js';
import { toCsv } from '../../utils/csv.js';
import { Lead, LeadStage, LeadActivity, Task, SalesTarget, Campaign, EnquiryForm, LEAD_SOURCES } from '../../models/Crm.js';
import { User } from '../../models/User.js';
import { Appointment } from '../../models/Appointment.js';
import { Patient } from '../../models/Patient.js';
import { createPatient } from '../patients/patients.service.js';
import { book } from '../appointments/appointments.service.js';
import * as svc from './crm.service.js';
import * as notify from '../../services/notify.js';

const r = Router();
r.use(auth, branchScope);
const idParam = z.object({ id: objectId });

/** Executives (no assign perm) see only their own leads (+ their branches' leads when branch-restricted) */
function leadScope(req) {
  if (hasPerm(req, 'leads.assign')) return req.allowedBranches ? { $or: [{ branch: { $in: req.allowedBranches } }, { branch: null }] } : {};
  const or = [{ assignedTo: req.user._id }];
  if (req.allowedBranches) or.push({ branch: { $in: req.allowedBranches } });
  return { $or: or };
}

async function loadLead(req) {
  const lead = await Lead.findOne({ _id: req.params.id, isActive: true, ...leadScope(req) });
  if (!lead) throw ApiError.notFound('Lead not found');
  return lead;
}

const utm = z.object({ source: z.string().max(100).optional(), medium: z.string().max(100).optional(), campaign: z.string().max(150).optional(), term: z.string().max(150).optional(), content: z.string().max(150).optional(), gclid: z.string().max(200).optional(), fbclid: z.string().max(200).optional(), landingUrl: z.string().max(500).optional() }).partial();

const leadBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(10).max(15),
  altPhone: z.string().max(15).optional(),
  email: z.string().trim().email().optional().or(z.literal('')).transform((v) => v || undefined),
  city: z.string().max(60).optional(),
  condition: z.string().max(80).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  sourceDetail: z.string().max(120).optional(),
  campaign: objectId.optional().nullable(),
  utm: utm.optional(),
  branch: objectId.optional().nullable(),
  stage: objectId.optional(),
  assignedTo: objectId.optional().nullable(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  value: z.number().min(0).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  nextFollowUpAt: z.coerce.date().optional().nullable(),
});

// ---------- assignable users (sales staff) ----------
r.get('/users', permit('leads.view'), asyncHandler(async (_req, res) => {
  const { Role } = await import('../../models/Role.js');
  const roles = await Role.find({ $or: [{ permissions: 'leads.create' }, { permissions: 'leads.edit' }, { permissions: '*' }] }).distinct('_id');
  ok(res, await User.find({ role: { $in: roles }, isActive: true }).select('name email role').populate('role', 'name').sort({ name: 1 }).lean());
}));

// ---------- stages ----------
r.get('/stages', permit('leads.view'), asyncHandler(async (_req, res) => ok(res, await LeadStage.find().sort({ order: 1 }).lean())));

const stageBody = z.object({ name: z.string().trim().min(2).max(40), key: z.string().trim().toLowerCase().regex(/^[a-z0-9_]+$/), order: z.number().int().min(0).max(100), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), isWon: z.boolean().optional(), isLost: z.boolean().optional(), isDefault: z.boolean().optional() });
r.post('/stages', permit('leads.manage_settings'), validate({ body: stageBody }), asyncHandler(async (req, res) => {
  if (req.body.isDefault) await LeadStage.updateMany({}, { isDefault: false });
  const s = await LeadStage.create(req.body);
  audit(req, { action: 'leads.manage_settings', entity: 'LeadStage', entityId: s._id, after: s });
  ok(res, s, 201);
}));
r.patch('/stages/:id', permit('leads.manage_settings'), validate({ params: idParam, body: stageBody.partial().omit({ key: true }) }), asyncHandler(async (req, res) => {
  if (req.body.isDefault) await LeadStage.updateMany({ _id: { $ne: req.params.id } }, { isDefault: false });
  const s = await LeadStage.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!s) throw ApiError.notFound();
  ok(res, s);
}));
r.delete('/stages/:id', permit('leads.manage_settings'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const s = await LeadStage.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  if (s.isSystem) throw ApiError.forbidden('System stage');
  if (await Lead.exists({ stage: s._id })) throw ApiError.conflict('Stage has leads. Move them first');
  await s.deleteOne();
  ok(res, { deleted: true });
}));

// ---------- leads ----------
const listQuery = paging.extend({
  stage: z.string().optional(), source: z.string().optional(), assignedTo: z.string().optional(), campaign: objectId.optional(),
  from: ymd.optional(), to: ymd.optional(), followup: z.enum(['today', 'overdue', 'upcoming', 'none']).optional(), priority: z.string().optional(),
  view: z.enum(['list', 'board']).optional(),
});

function buildLeadFilter(req) {
  const q = req.query;
  const f = { isActive: true, ...leadScope(req) };
  const and = [];
  if (q.stage) f.stage = { $in: q.stage.split(',') };
  if (q.source) f.source = { $in: q.source.split(',') };
  if (q.priority) f.priority = { $in: q.priority.split(',') };
  if (q.campaign) f.campaign = q.campaign;
  if (q.assignedTo === 'me') f.assignedTo = req.user._id;
  else if (q.assignedTo === 'none') f.assignedTo = null;
  else if (q.assignedTo) f.assignedTo = q.assignedTo;
  if (q.from || q.to) f.createdAt = { ...(q.from ? { $gte: istDayRange(q.from).$gte } : {}), ...(q.to ? { $lt: istDayRange(q.to).$lt } : {}) };
  if (q.followup) {
    const day = istDayRange(todayIST());
    if (q.followup === 'today') f.nextFollowUpAt = day;
    if (q.followup === 'overdue') f.nextFollowUpAt = { $lt: day.$gte };
    if (q.followup === 'upcoming') f.nextFollowUpAt = { $gte: day.$lt };
    if (q.followup === 'none') f.nextFollowUpAt = null;
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    and.push({ $or: [{ name: rx }, { phone: rx }, { email: rx }, { city: rx }] });
  }
  if (and.length) f.$and = and;
  return f;
}

const LEAD_POP = [
  { path: 'stage', select: 'name key color isWon isLost' },
  { path: 'assignedTo', select: 'name' },
  { path: 'campaign', select: 'name' },
  { path: 'branch', select: 'name code' },
];

r.get('/leads', permit('leads.view'), validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const f = buildLeadFilter(req);
  if (req.query.view === 'board') {
    return ok(res, await Lead.find(f).populate(LEAD_POP).sort({ updatedAt: -1 }).limit(1000).lean());
  }
  const { page, limit, skip } = parsePaging(req.query);
  const [items, total] = await Promise.all([Lead.find(f).populate(LEAD_POP).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Lead.countDocuments(f)]);
  paged(res, { items, total, page, limit });
}));

r.get('/leads/export', permit('leads.export'), validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const rows = await Lead.find(buildLeadFilter(req)).populate(LEAD_POP).sort({ createdAt: -1 }).limit(20000).lean();
  audit(req, { action: 'leads.export', entity: 'Lead', meta: { count: rows.length } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads-${todayIST()}.csv"`);
  res.send(toCsv(rows, [
    ['Name', 'name'], ['Phone', 'phone'], ['Email', 'email'], ['City', 'city'], ['Condition', 'condition'], ['Source', 'source'],
    ['Stage', (l) => l.stage?.name], ['Assigned To', (l) => l.assignedTo?.name], ['Campaign', (l) => l.campaign?.name],
    ['UTM Source', (l) => l.utm?.source], ['UTM Medium', (l) => l.utm?.medium], ['UTM Campaign', (l) => l.utm?.campaign],
    ['Branch', (l) => l.branch?.name], ['Lost Reason', 'lostReason'], ['Next Follow-up', (l) => l.nextFollowUpAt?.toISOString?.()],
    ['Created', (l) => l.createdAt?.toISOString?.()],
  ]));
}));

r.get('/leads/check-duplicate', permit('leads.view'), validate({ query: z.object({ phone: z.string().min(10).max(15) }) }), asyncHandler(async (req, res) => {
  ok(res, await svc.findDuplicate(req.query.phone));
}));

r.post('/leads', permit('leads.create'), validate({ body: leadBody.extend({ force: z.boolean().optional() }) }), asyncHandler(async (req, res) => {
  const { force, ...data } = req.body;
  if (data.assignedTo && !hasPerm(req, 'leads.assign')) data.assignedTo = req.user._id;
  if (!data.assignedTo && !hasPerm(req, 'leads.assign')) data.assignedTo = req.user._id;
  if (data.branch) req.assertBranch(data.branch);
  const { lead, duplicate } = await svc.createLead(data, { by: req.user._id, force });
  audit(req, { action: 'leads.create', entity: 'Lead', entityId: lead._id, after: lead });
  ok(res, { lead, duplicate }, 201);
}));

r.post('/leads/import', permit('leads.import'), validate({ body: z.object({ rows: z.array(z.record(z.any())).min(1).max(5000), defaults: z.object({ source: z.enum(LEAD_SOURCES).default('import'), campaign: objectId.optional(), assignedTo: objectId.optional(), branch: objectId.optional() }).default({}), skipDuplicates: z.boolean().default(true) }) }), asyncHandler(async (req, res) => {
  const { rows, defaults, skipDuplicates } = req.body;
  const pick = (row, ...keys) => {
    for (const k of Object.keys(row)) if (keys.includes(k.toLowerCase().replace(/[\s_-]/g, ''))) return String(row[k] ?? '').trim();
    return '';
  };
  const result = { created: 0, duplicates: 0, invalid: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const data = {
      name: pick(row, 'name', 'fullname', 'patientname') || 'Unknown',
      phone: pick(row, 'phone', 'mobile', 'phonenumber', 'mobileno', 'contact'),
      email: pick(row, 'email', 'emailaddress') || undefined,
      city: pick(row, 'city', 'location') || undefined,
      condition: pick(row, 'condition', 'problem', 'disease', 'treatment') || undefined,
      ...defaults,
    };
    try {
      await svc.createLead(data, { by: req.user._id, force: !skipDuplicates });
      result.created++;
    } catch (e) {
      if (e.status === 409) result.duplicates++;
      else {
        result.invalid++;
        if (result.errors.length < 50) result.errors.push({ row: i + 2, message: e.message });
      }
    }
  }
  audit(req, { action: 'leads.import', entity: 'Lead', meta: result });
  ok(res, result);
}));

r.post('/leads/bulk-assign', permit('leads.assign'), validate({ body: z.object({ ids: z.array(objectId).min(1).max(1000), assignedTo: objectId }) }), asyncHandler(async (req, res) => {
  const u = await User.findOne({ _id: req.body.assignedTo, isActive: true }).select('name').lean();
  if (!u) throw ApiError.badRequest('User not found');
  const r2 = await Lead.updateMany({ _id: { $in: req.body.ids }, ...leadScope(req) }, { assignedTo: u._id, assignedAt: new Date() });
  await LeadActivity.insertMany(req.body.ids.map((id) => ({ lead: id, type: 'assign', text: `Assigned to ${u.name}`, by: req.user._id })));
  // one alert per lead for small batches; a single summary is noise-free for big ones
  if (req.body.ids.length <= 10) req.body.ids.forEach((id) => notify.enqueue('lead.assigned', { leadId: id, userId: String(u._id) }));
  audit(req, { action: 'leads.assign', entity: 'Lead', meta: { count: r2.modifiedCount, to: u._id } });
  ok(res, { updated: r2.modifiedCount });
}));

r.post('/leads/bulk-stage', permit('leads.edit'), validate({ body: z.object({ ids: z.array(objectId).min(1).max(1000), stage: objectId, lostReason: z.string().max(200).optional() }) }), asyncHandler(async (req, res) => {
  let n = 0;
  for (const id of req.body.ids) {
    const lead = await Lead.findOne({ _id: id, ...leadScope(req) });
    if (!lead) continue;
    await svc.changeStage(lead, req.body.stage, { by: req.user._id, lostReason: req.body.lostReason });
    n++;
  }
  ok(res, { updated: n });
}));

r.get('/leads/:id', permit('leads.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const lead = await loadLead(req);
  await lead.populate([...LEAD_POP, { path: 'convertedPatient', select: 'name patientId' }, { path: 'appointment', select: 'bookingId date start status' }, { path: 'createdBy', select: 'name' }, { path: 'form', select: 'name' }]);
  const [activities, tasks, duplicate] = await Promise.all([
    LeadActivity.find({ lead: lead._id }).populate('by', 'name').sort({ createdAt: -1 }).limit(200).lean().then((acts) => acts.map((a) => (a.meta?.recordingUrl ? { ...a, meta: { ...a.meta, recordingUrl: undefined, hasRecording: true } } : a))),
    Task.find({ lead: lead._id }).populate('assignedTo', 'name').sort({ dueAt: 1 }).lean(),
    lead.duplicateOf ? Lead.findById(lead.duplicateOf).select('name phone createdAt').lean() : null,
  ]);
  ok(res, { lead, activities, tasks, duplicate });
}));

r.patch('/leads/:id', permit('leads.edit'), validate({ params: idParam, body: leadBody.partial().extend({ lostReason: z.string().max(200).optional() }) }), asyncHandler(async (req, res) => {
  const lead = await loadLead(req);
  const before = lead.toObject();
  const { stage, assignedTo, ...rest } = req.body;
  if (rest.phone) {
    rest.phone = svc.normPhone(rest.phone);
    if (!/^[6-9]\d{9}$/.test(rest.phone)) throw ApiError.badRequest('Invalid mobile number');
  }
  Object.assign(lead, rest);
  if (assignedTo !== undefined) {
    if (!hasPerm(req, 'leads.assign')) throw ApiError.forbidden('Cannot reassign');
    lead.assignedTo = assignedTo;
    lead.assignedAt = new Date();
    const u = assignedTo ? await User.findById(assignedTo).select('name').lean() : null;
    await LeadActivity.create({ lead: lead._id, type: 'assign', text: u ? `Assigned to ${u.name}` : 'Unassigned', by: req.user._id });
    if (u && String(u._id) !== String(req.user._id)) notify.enqueue('lead.assigned', { leadId: String(lead._id), userId: String(u._id) });
  }
  await lead.save();
  if (stage && String(stage) !== String(before.stage)) await svc.changeStage(lead, stage, { by: req.user._id, lostReason: rest.lostReason });
  if (rest.nextFollowUpAt) await LeadActivity.create({ lead: lead._id, type: 'followup', text: `Follow-up set for ${new Date(rest.nextFollowUpAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, by: req.user._id });
  audit(req, { action: 'leads.edit', entity: 'Lead', entityId: lead._id, before, after: lead });
  ok(res, lead);
}));

r.delete('/leads/:id', permit('leads.delete'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const lead = await loadLead(req);
  lead.isActive = false;
  await lead.save();
  audit(req, { action: 'leads.delete', entity: 'Lead', entityId: lead._id, before: lead });
  ok(res, { deleted: true });
}));

r.post('/leads/:id/activities', permit('leads.edit'), validate({ params: idParam, body: z.object({
  type: z.enum(['note', 'call', 'whatsapp', 'sms', 'email']),
  text: z.string().max(2000).optional(),
  call: z.object({ direction: z.enum(['outbound', 'inbound']).default('outbound'), outcome: z.enum(['connected', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback']), durationSec: z.number().int().min(0).max(36000).optional() }).optional(),
  nextFollowUpAt: z.coerce.date().optional(),
}) }), asyncHandler(async (req, res) => {
  const lead = await loadLead(req);
  if (req.body.type === 'call' && !req.body.call) throw ApiError.badRequest('Call outcome required');
  const act = await LeadActivity.create({ lead: lead._id, type: req.body.type, text: req.body.text, call: req.body.call, by: req.user._id });
  const upd = { lastContactAt: new Date() };
  if (req.body.type === 'call') upd.$inc = { callCount: 1 };
  if (req.body.nextFollowUpAt) upd.nextFollowUpAt = req.body.nextFollowUpAt;
  const { $inc, ...set } = upd;
  await Lead.updateOne({ _id: lead._id }, { $set: set, ...($inc ? { $inc } : {}) });
  // auto-advance New → Contacted on first contact
  const stage = await LeadStage.findById(lead.stage).lean();
  if (stage?.key === 'new' && ['call', 'whatsapp', 'sms', 'email'].includes(req.body.type)) {
    const contacted = await svc.stageByKey('contacted');
    if (contacted) await svc.changeStage(lead, contacted._id, { by: req.user._id });
  }
  ok(res, await act.populate('by', 'name'), 201);
}));

/** Convert: create/link patient (+ optional appointment) and mark won/appointment stage */
r.post('/leads/:id/convert', permit('leads.edit'), validate({ params: idParam, body: z.object({
  patient: objectId.optional(),
  newPatient: z.object({ name: z.string().min(2).max(80), gender: z.enum(['male', 'female', 'other']), ageYears: z.number().int().min(0).max(120).optional(), dob: z.coerce.date().optional(), registeredBranch: objectId }).optional(),
  appointment: z.object({ branch: objectId, doctor: z.union([objectId, z.literal('any')]).default('any'), date: ymd, start: z.string().regex(/^\d{2}:\d{2}$/) }).optional(),
}).refine((d) => d.patient || d.newPatient, 'Select or create patient') }), asyncHandler(async (req, res) => {
  const lead = await loadLead(req);
  let patient;
  if (req.body.patient) patient = await Patient.findById(req.body.patient);
  else {
    const mobile = svc.normPhone(lead.phone);
    patient = await createPatient({ ...req.body.newPatient, mobile, relation: (await Patient.exists({ mobile, relation: 'self' })) ? 'other' : 'self', source: 'crm', createdBy: req.user._id });
  }
  if (!patient) throw ApiError.notFound('Patient not found');
  let appt = null;
  if (req.body.appointment) {
    if (!hasPerm(req, 'appointments.create')) throw ApiError.forbidden('No permission to book appointments');
    appt = await book({ staff: true, patientId: patient._id, branchId: req.body.appointment.branch, doctorId: req.body.appointment.doctor, date: req.body.appointment.date, start: req.body.appointment.start, type: 'crm', createdBy: req.user._id, lead: lead._id, utm: lead.utm?.source ? { source: lead.utm.source, medium: lead.utm.medium, campaign: lead.utm.campaign } : undefined });
  }
  lead.convertedPatient = patient._id;
  if (appt) lead.appointment = appt._id;
  await lead.save();
  const target = await svc.stageByKey(appt ? 'appointment_scheduled' : 'converted');
  if (target) await svc.changeStage(lead, target._id, { by: req.user._id });
  await LeadActivity.create({ lead: lead._id, type: 'conversion', text: `Linked to patient ${patient.patientId}${appt ? `, appointment ${appt.bookingId}` : ''}`, by: req.user._id });
  audit(req, { action: 'leads.convert', entity: 'Lead', entityId: lead._id, after: { patient: patient._id, appointment: appt?._id } });
  ok(res, { lead, patient, appointment: appt });
}));

// ---------- tasks ----------
const taskScope = (req) => (hasPerm(req, 'leads.assign') ? {} : { assignedTo: req.user._id });
r.get('/tasks', permit('tasks.view'), asyncHandler(async (req, res) => {
  const f = { ...taskScope(req) };
  if (req.query.status) f.status = { $in: String(req.query.status).split(',') };
  if (req.query.assignedTo === 'me') f.assignedTo = req.user._id;
  else if (req.query.assignedTo && hasPerm(req, 'leads.assign')) f.assignedTo = req.query.assignedTo;
  if (req.query.due === 'today') f.dueAt = istDayRange(todayIST());
  if (req.query.due === 'overdue') Object.assign(f, { dueAt: { $lt: new Date() }, status: { $in: ['open', 'in_progress'] } });
  ok(res, await Task.find(f).populate('assignedTo', 'name').populate('lead', 'name phone').sort({ status: 1, dueAt: 1 }).limit(500).lean());
}));
const taskBody = z.object({ title: z.string().trim().min(2).max(160), description: z.string().max(2000).optional(), lead: objectId.optional().nullable(), assignedTo: objectId.optional(), dueAt: z.coerce.date().optional().nullable(), priority: z.enum(['low', 'medium', 'high']).optional(), status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional() });
r.post('/tasks', permit('tasks.create'), validate({ body: taskBody }), asyncHandler(async (req, res) => {
  const assignedTo = req.body.assignedTo && hasPerm(req, 'leads.assign') ? req.body.assignedTo : req.user._id;
  const t = await Task.create({ ...req.body, assignedTo, createdBy: req.user._id });
  ok(res, t, 201);
}));
r.patch('/tasks/:id', permit('tasks.edit'), validate({ params: idParam, body: taskBody.partial() }), asyncHandler(async (req, res) => {
  const t = await Task.findOne({ _id: req.params.id, ...taskScope(req) });
  if (!t) throw ApiError.notFound();
  if (req.body.assignedTo && !hasPerm(req, 'leads.assign')) delete req.body.assignedTo;
  Object.assign(t, req.body);
  if (req.body.status === 'done' && !t.completedAt) t.completedAt = new Date();
  await t.save();
  ok(res, t);
}));
r.delete('/tasks/:id', permit('tasks.delete'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const t = await Task.findOneAndDelete({ _id: req.params.id, ...taskScope(req) });
  if (!t) throw ApiError.notFound();
  ok(res, { deleted: true });
}));

// ---------- campaigns ----------
r.get('/campaigns/stats', permit('campaigns.view'), asyncHandler(async (_req, res) => {
  const won = await LeadStage.find({ isWon: true }).distinct('_id');
  const rows = await Lead.aggregate([
    { $match: { campaign: { $ne: null }, isActive: true } },
    { $group: { _id: '$campaign', leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $in: ['$stage', won] }, 1, 0] } }, appointments: { $sum: { $cond: [{ $ifNull: ['$appointment', false] }, 1, 0] } } } },
  ]);
  ok(res, rows);
}));
r.use('/campaigns', crudRouter({
  model: Campaign, module: 'campaigns', search: ['name', 'utmCampaign'], populate: [{ path: 'branch', select: 'name' }],
  schema: z.object({
    name: z.string().trim().min(2).max(120), channel: z.enum(['google_ads', 'facebook_ads', 'instagram', 'whatsapp', 'sms', 'email', 'seo', 'offline', 'other']).optional(),
    utmCampaign: z.string().max(150).optional(), branch: objectId.optional().nullable(), budget: z.number().min(0).optional(), spend: z.number().min(0).optional(),
    startDate: ymd.optional(), endDate: ymd.optional(), status: z.enum(['draft', 'active', 'paused', 'ended']).optional(), notes: z.string().max(1000).optional(), isActive: z.boolean().optional(),
  }),
}));

// ---------- targets & performance ----------
r.get('/targets', permit('sales.view'), validate({ query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }) }), asyncHandler(async (req, res) => {
  const f = { month: req.query.month, ...(hasPerm(req, 'sales.edit') ? {} : { user: req.user._id }) };
  ok(res, await SalesTarget.find(f).populate('user', 'name').lean());
}));
r.put('/targets', permit('sales.edit'), validate({ body: z.object({ user: objectId, month: z.string().regex(/^\d{4}-\d{2}$/), leadsTarget: z.number().int().min(0).default(0), conversionsTarget: z.number().int().min(0).default(0), appointmentsTarget: z.number().int().min(0).default(0), revenueTarget: z.number().min(0).default(0) }) }), asyncHandler(async (req, res) => {
  const t = await SalesTarget.findOneAndUpdate({ user: req.body.user, month: req.body.month }, { ...req.body, setBy: req.user._id }, { upsert: true, new: true });
  audit(req, { action: 'sales.edit', entity: 'SalesTarget', entityId: t._id, after: t });
  ok(res, t);
}));

/** per-user performance for month: leads assigned, calls, conversions, appointments, visits vs targets */
r.get('/performance', permit('sales.view'), validate({ query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), user: objectId.optional() }) }), asyncHandler(async (req, res) => {
  const [y, m] = req.query.month.split('-').map(Number);
  const start = istDayRange(`${req.query.month}-01`).$gte;
  const end = istDayRange(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)).$lt;
  const range = { $gte: start, $lt: end };
  const userFilter = hasPerm(req, 'sales.edit') ? (req.query.user ? { _id: svc.oid(req.query.user) } : {}) : { _id: req.user._id };
  const { Role } = await import('../../models/Role.js');
  const salesRoles = await Role.find({ $or: [{ permissions: 'leads.create' }, { permissions: '*' }] }).distinct('_id');
  const users = await User.find({ ...userFilter, role: { $in: salesRoles }, isActive: true }).select('name').lean();
  const ids = users.map((u) => u._id);
  const won = await LeadStage.find({ isWon: true }).distinct('_id');
  const [leadAgg, callAgg, apptAgg, targets] = await Promise.all([
    Lead.aggregate([{ $match: { assignedTo: { $in: ids }, createdAt: range, isActive: true } }, { $group: { _id: '$assignedTo', leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $in: ['$stage', won] }, 1, 0] } } } }]),
    LeadActivity.aggregate([{ $match: { by: { $in: ids }, type: 'call', createdAt: range } }, { $group: { _id: '$by', calls: { $sum: 1 }, connected: { $sum: { $cond: [{ $eq: ['$call.outcome', 'connected'] }, 1, 0] } } } }]),
    Appointment.aggregate([{ $match: { createdBy: { $in: ids }, type: 'crm', createdAt: range } }, { $group: { _id: '$createdBy', appointments: { $sum: 1 }, visited: { $sum: { $cond: [{ $in: ['$status', ['checked_in', 'in_consultation', 'completed']] }, 1, 0] } } } }]),
    SalesTarget.find({ user: { $in: ids }, month: req.query.month }).lean(),
  ]);
  const by = (arr) => new Map(arr.map((r2) => [String(r2._id), r2]));
  const L = by(leadAgg), C = by(callAgg), A = by(apptAgg), T = new Map(targets.map((t) => [String(t.user), t]));
  ok(res, users.map((u) => {
    const k = String(u._id);
    const l = L.get(k) || {}, c = C.get(k) || {}, a = A.get(k) || {}, t = T.get(k) || {};
    return {
      user: u, leads: l.leads || 0, converted: l.converted || 0, calls: c.calls || 0, connected: c.connected || 0,
      appointments: a.appointments || 0, visited: a.visited || 0,
      conversionRate: l.leads ? Math.round(((l.converted || 0) / l.leads) * 1000) / 10 : 0,
      target: { leads: t.leadsTarget || 0, conversions: t.conversionsTarget || 0, appointments: t.appointmentsTarget || 0, revenue: t.revenueTarget || 0 },
    };
  }));
}));

/** salesperson home */
r.get('/dashboard', permit('leads.view'), asyncHandler(async (req, res) => {
  const scope = leadScope(req);
  const day = istDayRange(todayIST());
  const [stages, byStage, followToday, overdue, newToday, tasksOpen, bySource] = await Promise.all([
    LeadStage.find().sort({ order: 1 }).lean(),
    Lead.aggregate([{ $match: { ...scope, isActive: true } }, { $group: { _id: '$stage', n: { $sum: 1 } } }]),
    Lead.countDocuments({ ...scope, isActive: true, nextFollowUpAt: day }),
    Lead.countDocuments({ ...scope, isActive: true, nextFollowUpAt: { $lt: day.$gte } }),
    Lead.countDocuments({ ...scope, isActive: true, createdAt: day }),
    Task.countDocuments({ ...(hasPerm(req, 'leads.assign') ? {} : { assignedTo: req.user._id }), status: { $in: ['open', 'in_progress'] } }),
    Lead.aggregate([{ $match: { ...scope, isActive: true, createdAt: { $gte: new Date(Date.now() - 30 * 86_400_000) } } }, { $group: { _id: '$source', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
  ]);
  const counts = new Map(byStage.map((s) => [String(s._id), s.n]));
  ok(res, { funnel: stages.map((s) => ({ ...s, count: counts.get(String(s._id)) || 0 })), followToday, overdue, newToday, tasksOpen, bySource });
}));

// ---------- CMS: forms & landing pages ----------
const fieldSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/), label: z.string().min(1).max(80), type: z.enum(['text', 'tel', 'email', 'number', 'textarea', 'select', 'radio', 'checkbox', 'date']).default('text'), required: z.boolean().default(false), options: z.array(z.string().max(80)).max(30).optional(), placeholder: z.string().max(120).optional(), mapTo: z.enum(['name', 'phone', 'email', 'city', 'condition', 'branch']).nullable().optional() });
r.use('/forms', crudRouter({
  model: EnquiryForm, module: 'cms', search: ['name', 'slug'], populate: [{ path: 'campaign', select: 'name' }, { path: 'branch', select: 'name' }],
  schema: z.object({
    name: z.string().trim().min(2).max(120), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/), kind: z.enum(['form', 'landing_page']).optional(),
    page: z.object({ headline: z.string().max(200).optional(), subheadline: z.string().max(300).optional(), body: z.string().max(10000).optional(), heroImage: z.string().max(500).optional(), ctaText: z.string().max(60).optional(), bullets: z.array(z.string().max(200)).max(10).optional(), seoTitle: z.string().max(120).optional(), seoDescription: z.string().max(300).optional() }).optional(),
    fields: z.array(fieldSchema).max(30).refine((f) => f.some((x) => x.mapTo === 'phone'), 'Form needs a field mapped to phone').refine((f) => new Set(f.map((x) => x.key)).size === f.length, 'Field keys must be unique'),
    campaign: objectId.optional().nullable(), branch: objectId.optional().nullable(), defaultSource: z.enum(LEAD_SOURCES).optional(), assignTo: objectId.optional().nullable(),
    successMessage: z.string().max(300).optional(), redirectUrl: z.string().url().optional().or(z.literal('')), isActive: z.boolean().optional(),
  }),
}));

export default r;
