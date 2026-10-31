import { Router } from 'express';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { auth } from '../../middleware/auth.js';
import { permit, hasPerm } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, parsePaging, escapeRegex } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, ymd, paging } from '../../utils/zod.js';
import { istDayRange, todayIST } from '../../utils/time.js';
import { env } from '../../config/env.js';
import { Call, Lead, LeadStage } from '../../models/Crm.js';
import { Patient } from '../../models/Patient.js';
import { User } from '../../models/User.js';
import * as exotel from '../../services/exotel.js';
import { finishCall } from './calls.service.js';
import { cfg } from '../../services/runtimeConfig.js';

const r = Router();
r.use(auth, branchScope);
const idParam = z.object({ id: objectId });

/** non-managers see their own calls + calls on leads they own */
async function callScope(req) {
  if (hasPerm(req, 'leads.assign')) return {};
  const myLeads = await Lead.find({ assignedTo: req.user._id }).distinct('_id');
  return { $or: [{ agent: req.user._id }, { lead: { $in: myLeads } }] };
}

r.get('/config', permit.any('leads.view', 'patients.view'), asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id).select('phone').lean();
  const out = { enabled: exotel.exotelConfigured(), callerId: cfg.EXOTEL_CALLER_ID || null, agentPhone: me?.phone || null };
  // callback URLs carry the secret token → only for admins who configure Exotel
  if (hasPerm(req, 'settings.manage_settings')) {
    out.webhooks = { status: exotel.webhookUrl('status'), inbound: exotel.webhookUrl('inbound'), connect: exotel.webhookUrl('connect') };
    out.tokenSet = Boolean(cfg.EXOTEL_WEBHOOK_TOKEN);
  }
  ok(res, out);
}));

/** Click-to-call: Exotel rings the agent, then the customer */
r.post('/', permit.any('leads.edit', 'patients.edit'), validate({ body: z.object({ lead: objectId.optional(), patient: objectId.optional(), phone: z.string().min(10).max(15).optional() }).refine((b) => b.lead || b.patient || b.phone, 'lead, patient or phone required') }), asyncHandler(async (req, res) => {
  let phone = req.body.phone;
  let lead = null;
  let patient = null;
  if (req.body.lead) {
    if (!hasPerm(req, 'leads.edit')) throw ApiError.forbidden();
    lead = await Lead.findOne({ _id: req.body.lead, isActive: true, ...(hasPerm(req, 'leads.assign') ? {} : { $or: [{ assignedTo: req.user._id }, ...(req.allowedBranches ? [{ branch: { $in: req.allowedBranches } }] : [])] }) }).lean();
    if (!lead) throw ApiError.notFound('Lead not found');
    phone = lead.phone;
  } else if (req.body.patient) {
    patient = await Patient.findById(req.body.patient).select('mobile name').lean();
    if (!patient) throw ApiError.notFound('Patient not found');
    phone = patient.mobile;
  } else {
    // raw dial: attach to an existing lead with this number if the agent can see it
    const ten = exotel.tenDigits(phone);
    lead = await Lead.findOne({ phone: ten, isActive: true }).sort({ createdAt: -1 }).lean();
    if (!lead) patient = await Patient.findOne({ mobile: ten }).select('_id').lean();
  }
  if (!exotel.exotelConfigured()) throw new ApiError(503, 'Exotel is not configured — dial from your phone instead');
  const me = await User.findById(req.user._id).select('phone').lean();
  const call = await Call.create({ direction: 'outbound', lead: lead?._id, patient: patient?._id, agent: req.user._id, branch: lead?.branch || req.activeBranch || undefined, from: exotel.tenDigits(me?.phone), to: exotel.tenDigits(phone), callerId: cfg.EXOTEL_CALLER_ID, status: 'queued' });
  try {
    const x = await exotel.connect({ agentPhone: me?.phone, customerPhone: phone, callId: call._id });
    call.sid = x.Sid;
    call.status = String(x.Status || 'queued').toLowerCase() === 'in-progress' ? 'in-progress' : 'queued';
    call.startedAt = new Date();
    await call.save();
  } catch (e) {
    call.status = 'failed';
    call.notes = e.message;
    await call.save();
    throw e;
  }
  audit(req, { action: 'leads.call', entity: 'Call', entityId: call._id, meta: { lead: lead?._id, to: call.to } });
  ok(res, call, 201);
}));

r.get('/queue', permit('leads.view'), asyncHandler(async (req, res) => {
  const mine = hasPerm(req, 'leads.assign') && req.query.all === 'true' ? {} : { assignedTo: req.user._id };
  const closed = await LeadStage.find({ $or: [{ isWon: true }, { isLost: true }] }).distinct('_id');
  const day = istDayRange(todayIST());
  const base = { ...mine, isActive: true, stage: { $nin: closed } };
  const [due, fresh] = await Promise.all([
    Lead.find({ ...base, nextFollowUpAt: { $lt: day.$lt } }).populate('stage', 'name color').sort({ nextFollowUpAt: 1 }).limit(50).lean(),
    Lead.find({ ...base, callCount: 0, nextFollowUpAt: null }).populate('stage', 'name color').sort({ createdAt: 1 }).limit(50).lean(),
  ]);
  ok(res, [...due.map((l) => ({ ...l, reason: new Date(l.nextFollowUpAt) < day.$gte ? 'overdue' : 'due today' })), ...fresh.map((l) => ({ ...l, reason: 'not contacted' }))]);
}));

r.get('/', permit('leads.view'), validate({ query: paging.extend({ direction: z.enum(['inbound', 'outbound']).optional(), status: z.string().optional(), agent: z.string().optional(), lead: objectId.optional(), from: ymd.optional(), to: ymd.optional(), recorded: z.enum(['true']).optional() }) }), asyncHandler(async (req, res) => {
  const q = req.query;
  const f = { ...(await callScope(req)) };
  if (q.direction) f.direction = q.direction;
  if (q.status) f.status = { $in: q.status.split(',') };
  if (q.agent === 'me') f.agent = req.user._id;
  else if (q.agent && hasPerm(req, 'leads.assign')) f.agent = q.agent;
  if (q.lead) f.lead = q.lead;
  if (q.recorded) f.recordingUrl = { $nin: [null, ''] };
  if (q.from || q.to) f.createdAt = { ...(q.from ? { $gte: istDayRange(q.from).$gte } : {}), ...(q.to ? { $lt: istDayRange(q.to).$lt } : {}) };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const leads = await Lead.find({ $or: [{ name: rx }, { phone: rx }] }).select('_id').limit(200).lean();
    (f.$and ||= []).push({ $or: [{ from: rx }, { to: rx }, { lead: { $in: leads.map((l) => l._id) } }] });
  }
  const { page, limit, skip } = parsePaging(q);
  const [items, total, stats] = await Promise.all([
    Call.find(f).select('-raw').populate('lead', 'name phone').populate('patient', 'name patientId').populate('agent', 'name').populate('branch', 'code').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Call.countDocuments(f),
    Call.aggregate([{ $match: f }, { $group: { _id: '$direction', n: { $sum: 1 }, connected: { $sum: { $cond: [{ $eq: ['$outcome', 'connected'] }, 1, 0] } }, talk: { $sum: '$durationSec' } } }]),
  ]);
  res.json({ success: true, data: items.map((c) => ({ ...c, hasRecording: Boolean(c.recordingUrl), recordingUrl: undefined })), meta: { total, page, limit, pages: Math.ceil(total / limit) || 1, stats } });
}));

async function loadCall(req) {
  const c = await Call.findOne({ _id: req.params.id, ...(await callScope(req)) });
  if (!c) throw ApiError.notFound('Call not found');
  return c;
}

r.patch('/:id', permit('leads.edit'), validate({ params: idParam, body: z.object({ outcome: z.enum(['connected', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback']).optional(), notes: z.string().max(2000).optional() }) }), asyncHandler(async (req, res) => {
  const c = await loadCall(req);
  Object.assign(c, req.body);
  await c.save();
  ok(res, c);
}));

/** Backfill status/recording from Exotel (missed callback, or recording processed later) */
r.post('/:id/refresh', permit('leads.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const c = await loadCall(req);
  if (!c.sid) throw ApiError.badRequest('Call has no Exotel id');
  const x = await exotel.getCall(c.sid);
  const out = await finishCall(c, { status: String(x.Status || c.status).toLowerCase(), durationSec: Number(x.Duration) || c.durationSec, recordingUrl: x.RecordingUrl, startedAt: x.StartTime ? new Date(x.StartTime) : undefined, endedAt: x.EndTime ? new Date(x.EndTime) : undefined });
  ok(res, out);
}));

/** Recording proxy — staff never see the provider URL; supports seeking (Range) */
r.get('/:id/recording', permit('leads.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const c = await loadCall(req);
  if (!c.recordingUrl) throw ApiError.notFound('No recording for this call');
  const upstream = await exotel.fetchRecording(c.recordingUrl, req.get('range'));
  if (!upstream.ok && upstream.status !== 206) throw new ApiError(502, `Recording unavailable (${upstream.status})`);
  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.headers.get('content-type')) res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  audit(req, { action: 'leads.recording_play', entity: 'Call', entityId: c._id });
  Readable.fromWeb(upstream.body).pipe(res);
}));

export default r;
