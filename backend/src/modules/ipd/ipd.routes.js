import { Router } from 'express';
import { z } from 'zod';
import { permit } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, paged, parsePaging, escapeRegex } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, ymd } from '../../utils/zod.js';
import { Admission, Bed, Ward, WARD_TYPES, BED_STATUS, CHARGE_KINDS } from '../../models/Ipd.js';
import { Patient } from '../../models/Patient.js';
import { streamDocument, loadDocument } from '../../services/documents.js';
import * as svc from './ipd.service.js';
import { getSettings } from '../../models/Settings.js';

const r = Router();
// auth + branchScope are applied once where the IPD routers are mounted (app.js)

const idParam = z.object({ id: objectId });
const sub = (k) => z.object({ id: objectId, [k]: objectId });
const date = z.coerce.date();
const mode = z.enum(['cash', 'upi', 'card', 'bank']);

/** load an admission the user's branch scope can see */
async function own(req, populate = false) {
  const a = populate ? await svc.loadAdmission(req.params.id) : await Admission.findById(req.params.id);
  if (!a) throw ApiError.notFound('Admission not found');
  if (!req.canAccessBranch(a.branch?._id || a.branch)) throw ApiError.forbidden();
  return a;
}
const reply = async (res, id, status = 200) => ok(res, await svc.loadAdmission(id), status);

// ================================================================ wards & beds (setup)
const wardBody = z.object({ branch: objectId, name: z.string().trim().min(1).max(60), type: z.enum(WARD_TYPES).default('general'), floor: z.string().max(30).optional(), dailyRate: z.number().min(0).default(0), nursingRate: z.number().min(0).default(0), gstRate: z.number().min(0).max(28).default(0), description: z.string().max(300).optional(), isActive: z.boolean().optional() });

r.get('/wards', permit('ipd.view'), asyncHandler(async (req, res) => {
  ok(res, await Ward.find({ ...req.branchFilter('branch'), ...(req.query.all === 'true' ? {} : { isActive: true }) }).populate('branch', 'name code').sort({ branch: 1, name: 1 }).lean());
}));
r.post('/wards', permit('ipd.manage_settings'), validate({ body: wardBody }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.branch);
  const w = await Ward.create(req.body);
  audit(req, { action: 'ipd.ward_create', entity: 'Ward', entityId: w._id, branch: w.branch, after: w });
  ok(res, w, 201);
}));
r.patch('/wards/:id', permit('ipd.manage_settings'), validate({ params: idParam, body: wardBody.partial().omit({ branch: true }) }), asyncHandler(async (req, res) => {
  const w = await Ward.findById(req.params.id);
  if (!w) throw ApiError.notFound('Ward not found');
  req.assertBranch(w.branch);
  Object.assign(w, req.body);
  await w.save();
  audit(req, { action: 'ipd.ward_edit', entity: 'Ward', entityId: w._id, branch: w.branch, after: req.body });
  ok(res, w);
}));

r.get('/beds', permit('ipd.view'), asyncHandler(async (req, res) => {
  const f = { ...req.branchFilter('branch'), isActive: true };
  if (req.query.ward) f.ward = req.query.ward;
  if (req.query.status) f.status = req.query.status;
  ok(res, await Bed.find(f).populate('ward', 'name type dailyRate').sort({ number: 1 }).lean());
}));
/** bulk create: prefix + from..to → e.g. GW-1 … GW-8 */
r.post('/beds', permit('ipd.manage_settings'), validate({ body: z.object({ ward: objectId, prefix: z.string().trim().max(10).default(''), from: z.number().int().min(0).max(999), to: z.number().int().min(0).max(999), features: z.array(z.string().max(30)).max(10).optional() }).refine((b) => b.to >= b.from && b.to - b.from < 100, 'Max 100 beds at once') }), asyncHandler(async (req, res) => {
  const w = await Ward.findById(req.body.ward).lean();
  if (!w) throw ApiError.notFound('Ward not found');
  req.assertBranch(w.branch);
  const out = [];
  for (let n = req.body.from; n <= req.body.to; n++) {
    const number = `${req.body.prefix}${n}`;
    const ex = await Bed.findOne({ branch: w.branch, number });
    if (ex) { if (!ex.isActive) { ex.isActive = true; ex.ward = w._id; await ex.save(); out.push(ex); } continue; }
    out.push(await Bed.create({ branch: w.branch, ward: w._id, number, features: req.body.features }));
  }
  audit(req, { action: 'ipd.beds_create', entity: 'Bed', branch: w.branch, meta: { ward: w.name, n: out.length } });
  ok(res, out, 201);
}));
r.patch('/beds/:id', permit('ipd.edit'), validate({ params: idParam, body: z.object({ status: z.enum(BED_STATUS).optional(), number: z.string().trim().min(1).max(20).optional(), ward: objectId.optional(), features: z.array(z.string().max(30)).max(10).optional(), note: z.string().max(200).optional(), isActive: z.boolean().optional() }) }), asyncHandler(async (req, res) => {
  const b = await Bed.findById(req.params.id);
  if (!b) throw ApiError.notFound('Bed not found');
  req.assertBranch(b.branch);
  if (b.status === 'occupied' && (req.body.status && req.body.status !== 'occupied')) throw ApiError.badRequest('Bed is occupied — discharge or transfer the patient first');
  if (req.body.status === 'occupied') throw ApiError.badRequest('Admit a patient to occupy a bed');
  if (req.body.isActive === false && b.status === 'occupied') throw ApiError.badRequest('Bed is occupied');
  Object.assign(b, req.body);
  await b.save();
  audit(req, { action: 'ipd.bed_edit', entity: 'Bed', entityId: b._id, branch: b.branch, after: req.body });
  ok(res, b);
}));

/** bed board: wards → beds → occupant */
r.get('/board', permit('ipd.view'), asyncHandler(async (req, res) => {
  const f = req.branchFilter('branch');
  const [wards, beds] = await Promise.all([
    Ward.find({ ...f, isActive: true }).populate('branch', 'name code').sort({ name: 1 }).lean(),
    Bed.find({ ...f, isActive: true }).sort({ number: 1 }).populate('reservation.patient', 'name patientId mobile').populate({ path: 'currentAdmission', select: 'admissionNo patient doctor admittedAt status type expectedDischargeAt plannedProcedure payer diet package.name', populate: [{ path: 'patient', select: 'name patientId gender ageYears dob mobile' }, { path: 'doctor', select: 'name' }] }).lean(),
  ]);
  const byWard = new Map(wards.map((w) => [String(w._id), { ...w, beds: [] }]));
  for (const b of beds) byWard.get(String(b.ward))?.beds.push(b);
  const count = (st) => beds.filter((b) => b.status === st).length;
  ok(res, {
    wards: [...byWard.values()],
    stats: { total: beds.length, occupied: count('occupied'), available: count('available'), cleaning: count('cleaning'), reserved: count('reserved'), maintenance: count('maintenance'), occupancy: beds.length ? Math.round((count('occupied') / beds.length) * 100) : 0 },
    dischargesDue: beds.filter((b) => b.currentAdmission?.status === 'discharge_initiated' || (b.currentAdmission?.expectedDischargeAt && new Date(b.currentAdmission.expectedDischargeAt) <= new Date(Date.now() + 86_400_000))).length,
  });
}));

// ================================================================ admissions
r.get('/admissions', permit('ipd.view'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const f = { ...req.branchFilter('branch') };
  if (req.query.status === 'active') f.status = { $in: ['admitted', 'discharge_initiated'] };
  else if (req.query.status) f.status = req.query.status;
  if (req.query.patient) f.patient = req.query.patient;
  if (req.query.from || req.query.to) f.admittedAt = { ...(req.query.from && { $gte: new Date(`${req.query.from}T00:00:00+05:30`) }), ...(req.query.to && { $lte: new Date(`${req.query.to}T23:59:59+05:30`) }) };
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
    const pids = await Patient.find({ $or: [{ name: rx }, { mobile: rx }, { patientId: rx }] }).distinct('_id');
    f.$or = [{ admissionNo: rx }, { patient: { $in: pids } }];
  }
  const [items, total] = await Promise.all([
    Admission.find(f).select('admissionNo patient doctor branch bed ward type status admittedAt dischargedAt expectedDischargeAt plannedProcedure payer.type invoice').populate('patient', 'name patientId mobile gender').populate('doctor', 'name').populate('branch', 'name code').populate('bed', 'number').populate('ward', 'name').populate('invoice', 'invoiceNo grandTotal balance').sort({ admittedAt: -1 }).skip(skip).limit(limit).lean(),
    Admission.countDocuments(f),
  ]);
  paged(res, { items, total, page, limit });
}));

r.get('/admissions/:id', permit('ipd.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const a = await own(req, true);
  audit(req, { action: 'ipd.view', entity: 'Admission', entityId: a._id, branch: a.branch._id });
  ok(res, a);
}));

const payer = z.object({ type: z.enum(['self', 'insurance', 'corporate', 'government']).default('self'), insurer: z.string().max(80).optional(), tpa: z.string().max(80).optional(), policyNo: z.string().max(60).optional(), cardNo: z.string().max(60).optional(), preAuthNo: z.string().max(60).optional(), preAuthStatus: z.enum(['not_required', 'pending', 'approved', 'rejected', 'partial']).optional(), approvedAmount: z.number().min(0).optional() });
const attendant = z.object({ name: z.string().max(80).optional(), phone: z.string().max(15).optional(), relation: z.string().max(30).optional() });
const admitBody = z.object({
  branch: objectId, patient: objectId, bed: objectId, doctor: objectId, appointment: objectId.optional(),
  type: z.enum(['planned', 'emergency', 'day_care']).default('planned'), admittedAt: date.optional(), expectedDischargeAt: date.optional(),
  reason: z.string().max(500).optional(), provisionalDiagnosis: z.string().max(300).optional(), allergies: z.string().max(200).optional(),
  plannedProcedure: z.object({ product: objectId.optional(), name: z.string().max(120).optional() }).optional(), procedureAt: date.optional(),
  attendant: attendant.optional(), payer: payer.optional(), estimate: z.number().min(0).optional(), note: z.string().max(1000).optional(),
  deposit: z.object({ mode, amount: z.number().positive(), reference: z.string().max(60).optional() }).optional(),
  package: objectId.optional(),
});
r.post('/admissions', permit('ipd.create'), validate({ body: admitBody }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.branch);
  const a = await svc.admit(req.body, req.user);
  if (req.body.deposit) {
    const { addAdvance } = await import('../billing/billing.service.js');
    await addAdvance({ branch: a.branch, patient: a.patient, ...req.body.deposit, notes: `IPD deposit ${a.admissionNo}` }, req.user);
  }
  audit(req, { action: 'ipd.admit', entity: 'Admission', entityId: a._id, branch: a.branch, after: { admissionNo: a.admissionNo, bed: req.body.bed } });
  await reply(res, a._id, 201);
}));

r.patch('/admissions/:id', permit('ipd.edit'), validate({ params: idParam, body: z.object({
  doctor: objectId.optional(), type: z.enum(['planned', 'emergency', 'day_care']).optional(), expectedDischargeAt: date.nullable().optional(),
  reason: z.string().max(500).optional(), provisionalDiagnosis: z.string().max(300).optional(), allergies: z.string().max(200).optional(),
  attendant: attendant.optional(), payer: payer.optional(), estimate: z.number().min(0).optional(),
  consent: z.object({ signed: z.boolean(), signedBy: z.string().max(80).optional(), relation: z.string().max(30).optional(), witness: z.string().max(80).optional(), notes: z.string().max(300).optional() }).optional(),
  preOp: z.array(z.object({ item: z.string().max(120), done: z.boolean() })).max(30).optional(),
}) }), asyncHandler(async (req, res) => {
  const a = await own(req);
  if (a.status === 'discharged' || a.status === 'cancelled') throw ApiError.badRequest('Admission is closed');
  const b = req.body;
  if (b.consent) a.consent = { ...b.consent, at: b.consent.signed ? a.consent?.at || new Date() : undefined };
  if (b.preOp) {
    const prev = new Map((a.preOp || []).map((x) => [x.item, x]));
    a.preOp = b.preOp.map((x) => { const p = prev.get(x.item); return p && p.done === x.done ? p : { ...x, by: x.done ? req.user._id : undefined, at: x.done ? new Date() : undefined }; });
  }
  for (const k of ['doctor', 'type', 'expectedDischargeAt', 'reason', 'provisionalDiagnosis', 'allergies', 'attendant', 'payer', 'estimate']) if (b[k] !== undefined) a[k] = b[k];
  await a.save();
  audit(req, { action: 'ipd.edit', entity: 'Admission', entityId: a._id, branch: a.branch, after: b });
  await reply(res, a._id);
}));

r.post('/admissions/:id/transfer', permit('ipd.edit'), validate({ params: idParam, body: z.object({ bed: objectId, reason: z.string().max(200).optional() }) }), asyncHandler(async (req, res) => {
  const a = await own(req);
  await svc.transfer(a._id, req.body, req.user);
  audit(req, { action: 'ipd.transfer', entity: 'Admission', entityId: a._id, branch: a.branch, after: req.body });
  await reply(res, a._id);
}));

// ---------------------------------------------------------------- clinical timeline
r.post('/admissions/:id/vitals', permit('ipd.edit'), validate({ params: idParam, body: z.object({ at: date.optional(), bp: z.string().max(12).optional(), pulse: z.number().min(0).max(300).optional(), temp: z.number().min(80).max(115).optional(), spo2: z.number().min(0).max(100).optional(), rr: z.number().min(0).max(80).optional(), pain: z.number().min(0).max(10).optional(), sugar: z.number().min(0).max(1000).optional(), intake: z.number().min(0).max(20000).optional(), output: z.number().min(0).max(20000).optional(), note: z.string().max(300).optional() }) }), asyncHandler(async (req, res) => {
  const a = await svc.activeAdmission(req.params.id);
  if (!req.canAccessBranch(a.branch)) throw ApiError.forbidden();
  a.vitals.push({ ...req.body, by: req.user._id });
  await a.save();
  await reply(res, a._id);
}));

r.post('/admissions/:id/notes', permit('ipd.edit'), validate({ params: idParam, body: z.object({ type: z.enum(['doctor_round', 'nursing', 'progress', 'diet', 'handover']).default('progress'), text: z.string().trim().min(2).max(3000), at: date.optional(), chargeVisit: z.boolean().optional() }) }), asyncHandler(async (req, res) => {
  const a = await svc.activeAdmission(req.params.id);
  if (!req.canAccessBranch(a.branch)) throw ApiError.forbidden();
  a.notes.push({ ...req.body, by: req.user._id });
  if (req.body.type === 'doctor_round' && req.body.chargeVisit !== false) {
    const s = await getSettings();
    const rate = s.ipd?.doctorVisitRate ?? 0;
    if (s.ipd?.autoChargeRounds !== false && rate > 0) {
      const { Doctor } = await import('../../models/Doctor.js');
      const d = req.user.doctor ? await Doctor.findById(req.user.doctor).select('name').lean() : await Doctor.findById(a.doctor).select('name').lean();
      a.charges.push({ kind: 'doctor_visit', description: `Doctor visit — ${d?.name || 'Consultant'}`, qty: 1, rate, amount: rate, date: req.body.at || new Date(), by: req.user._id });
    }
  }
  await a.save();
  await reply(res, a._id);
}));

const procBody = z.object({ service: objectId.optional(), name: z.string().max(120).optional(), surgeon: objectId.optional(), assistant: z.string().max(80).optional(), anaesthetist: z.string().max(80).optional(), anaesthesia: z.enum(['local', 'spinal', 'saddle', 'general', 'sedation', 'none']).optional(), ot: z.string().max(40).optional(), scheduledAt: date.optional(), durationMin: z.number().int().min(5).max(720).optional(), startedAt: date.nullable().optional(), endedAt: date.nullable().optional(), status: z.enum(['scheduled', 'in_progress', 'done', 'cancelled']).optional(), findings: z.string().max(2000).optional(), notes: z.string().max(2000).optional() });
r.post('/admissions/:id/procedures', permit('ipd.edit'), validate({ params: idParam, body: procBody.refine((b) => b.service || b.name, 'Pick a procedure') }), asyncHandler(async (req, res) => {
  const a = await svc.activeAdmission(req.params.id);
  if (!req.canAccessBranch(a.branch)) throw ApiError.forbidden();
  await svc.otConflict(a, req.body);
  if (!a.preOp?.length) a.preOp = svc.DEFAULT_PREOP.map((item) => ({ item, done: false }));
  a.procedures.push({ ...req.body, surgeon: req.body.surgeon || a.doctor, status: req.body.status || 'scheduled', by: req.user._id });
  await a.save();
  await reply(res, a._id);
}));
r.patch('/admissions/:id/procedures/:pid', permit('ipd.edit'), validate({ params: sub('pid'), body: procBody }), asyncHandler(async (req, res) => {
  const a = await svc.activeAdmission(req.params.id);
  if (!req.canAccessBranch(a.branch)) throw ApiError.forbidden();
  const p = a.procedures.id(req.params.pid);
  if (!p) throw ApiError.notFound('Procedure not found');
  if (req.body.scheduledAt || req.body.ot || req.body.durationMin) await svc.otConflict(a, { scheduledAt: req.body.scheduledAt || p.scheduledAt, ot: req.body.ot ?? p.ot, durationMin: req.body.durationMin || p.durationMin }, p._id);
  if (req.body.status === 'in_progress' && !p.startedAt && !req.body.startedAt) req.body.startedAt = new Date();
  if (req.body.status === 'done' && !p.endedAt && !req.body.endedAt) req.body.endedAt = new Date();
  Object.assign(p, req.body);
  await svc.procedureCharge(a, p, req.user);
  await a.save();
  audit(req, { action: 'ipd.procedure', entity: 'Admission', entityId: a._id, branch: a.branch, after: { procedure: p.name, status: p.status } });
  await reply(res, a._id);
}));

// medication orders (MAR)
r.post('/admissions/:id/medications', permit('ipd.edit'), validate({ params: idParam, body: z.object({ product: objectId.optional(), name: z.string().trim().min(2).max(120), dose: z.string().max(40).optional(), route: z.string().max(20).optional(), frequency: z.string().max(30).optional(), instructions: z.string().max(200).optional() }) }), asyncHandler(async (req, res) => {
  const a = await svc.activeAdmission(req.params.id);
  if (!req.canAccessBranch(a.branch)) throw ApiError.forbidden();
  a.medications.push({ ...req.body, orderedBy: req.user._id });
  await a.save();
  await reply(res, a._id);
}));
r.patch('/admissions/:id/medications/:mid', permit('ipd.edit'), validate({ params: sub('mid'), body: z.object({ active: z.boolean().optional(), dose: z.string().max(40).optional(), frequency: z.string().max(30).optional(), instructions: z.string().max(200).optional() }) }), asyncHandler(async (req, res) => {
  const a = await svc.activeAdmission(req.params.id);
  if (!req.canAccessBranch(a.branch)) throw ApiError.forbidden();
  const m = a.medications.id(req.params.mid);
  if (!m) throw ApiError.notFound('Medication not found');
  Object.assign(m, req.body);
  if (req.body.active === false) m.stopAt = new Date();
  await a.save();
  await reply(res, a._id);
}));
r.post('/admissions/:id/medications/:mid/administer', permit('ipd.edit'), validate({ params: sub('mid'), body: z.object({ status: z.enum(['given', 'missed', 'refused', 'held']).default('given'), note: z.string().max(200).optional(), at: date.optional() }) }), asyncHandler(async (req, res) => {
  const a = await svc.activeAdmission(req.params.id);
  if (!req.canAccessBranch(a.branch)) throw ApiError.forbidden();
  const m = a.medications.id(req.params.mid);
  if (!m || !m.active) throw ApiError.badRequest('Medication is not active');
  m.administrations.push({ ...req.body, by: req.user._id });
  await a.save();
  await reply(res, a._id);
}));

// ---------------------------------------------------------------- charges & bill
r.get('/admissions/:id/bill', permit('ipd.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const a = await own(req);
  ok(res, await svc.billSummary(a));
}));
r.post('/admissions/:id/charges', permit('ipd.edit'), validate({ params: idParam, body: z.object({ kind: z.enum(CHARGE_KINDS).optional(), product: objectId.optional(), description: z.string().max(200).optional(), qty: z.number().positive().max(999).default(1), rate: z.number().min(0).optional(), gstRate: z.number().min(0).max(28).optional(), date: date.optional() }).refine((b) => b.product || (b.description && b.rate !== undefined), 'Pick a service or enter description + rate') }), asyncHandler(async (req, res) => {
  const a = await own(req);
  await svc.addCharge(a._id, req.body, req.user);
  audit(req, { action: 'ipd.charge_add', entity: 'Admission', entityId: a._id, branch: a.branch, after: req.body });
  await reply(res, a._id);
}));
r.post('/admissions/:id/issue', permit('ipd.edit'), validate({ params: idParam, body: z.object({ product: objectId, qty: z.number().int().positive().max(500), addToMar: z.boolean().default(false), dose: z.string().max(40).optional(), frequency: z.string().max(30).optional(), route: z.string().max(20).optional() }) }), asyncHandler(async (req, res) => {
  const a = await own(req);
  await svc.issueMedicine(a._id, req.body, req.user);
  audit(req, { action: 'ipd.pharmacy_issue', entity: 'Admission', entityId: a._id, branch: a.branch, after: req.body });
  await reply(res, a._id);
}));
r.delete('/admissions/:id/charges/:cid', permit('ipd.edit'), validate({ params: sub('cid') }), asyncHandler(async (req, res) => {
  const a = await own(req);
  await svc.removeCharge(a._id, req.params.cid, req.user);
  audit(req, { action: 'ipd.charge_remove', entity: 'Admission', entityId: a._id, branch: a.branch, meta: { charge: req.params.cid } });
  await reply(res, a._id);
}));

// ---------------------------------------------------------------- discharge
const med = z.object({ name: z.string().max(120), dose: z.string().max(40).optional(), frequency: z.string().max(30).optional(), duration: z.string().max(30).optional(), instructions: z.string().max(120).optional() });
r.put('/admissions/:id/discharge-summary', permit('ipd.edit'), validate({ params: idParam, body: z.object({
  type: z.enum(['normal', 'lama', 'dama', 'referred', 'death', 'absconded']).default('normal'),
  finalDiagnosis: z.string().max(500).optional(), procedureDone: z.string().max(500).optional(), courseInHospital: z.string().max(4000).optional(), investigations: z.string().max(2000).optional(),
  conditionAtDischarge: z.string().max(300).optional(), medications: z.array(med).max(30).optional(), advice: z.string().max(2000).optional(), diet: z.string().max(1000).optional(),
  followUpDate: ymd.optional().or(z.literal('')), followUpNote: z.string().max(200).optional(), referredTo: z.string().max(200).optional(),
}) }), asyncHandler(async (req, res) => {
  const a = await own(req);
  await svc.saveSummary(a._id, { ...req.body, followUpDate: req.body.followUpDate || undefined }, req.user);
  audit(req, { action: 'ipd.discharge_summary', entity: 'Admission', entityId: a._id, branch: a.branch });
  await reply(res, a._id);
}));

r.post('/admissions/:id/discharge', permit('ipd.edit'), validate({ params: idParam, body: z.object({ payments: z.array(z.object({ mode, amount: z.number().positive(), reference: z.string().max(60).optional() })).max(5).default([]), useAdvance: z.boolean().default(true), discountPct: z.number().min(0).max(100).default(0), notes: z.string().max(200).optional(), dischargedAt: date.optional(), insurerShare: z.number().min(0).optional() }) }), asyncHandler(async (req, res) => {
  const a = await own(req);
  if (req.body.discountPct > 20 && !req.perms.has('*') && !req.perms.has('billing.approve')) throw ApiError.forbidden('Discount above 20% needs billing approval permission');
  const out = await svc.finalizeDischarge(a._id, req.body, req.user);
  audit(req, { action: 'ipd.discharge', entity: 'Admission', entityId: a._id, branch: a.branch, after: { invoice: out.invoice?.invoiceNo } });
  ok(res, { admission: await svc.loadAdmission(a._id), invoice: out.invoice });
}));

r.post('/admissions/:id/cancel', permit('ipd.delete'), validate({ params: idParam, body: z.object({ reason: z.string().trim().min(3).max(300) }) }), asyncHandler(async (req, res) => {
  const a = await own(req);
  await svc.cancelAdmission(a._id, req.body.reason, req.user);
  audit(req, { action: 'ipd.cancel', entity: 'Admission', entityId: a._id, branch: a.branch, after: req.body });
  await reply(res, a._id);
}));

// ---------------------------------------------------------------- PDFs
r.get('/admissions/:id/pdf/:kind', permit('ipd.view'), validate({ params: z.object({ id: objectId, kind: z.enum(['discharge', 'admission']) }) }), asyncHandler(async (req, res) => {
  const loaded = await loadDocument(req.params.kind, req.params.id);
  if (!req.canAccessBranch(loaded.branch)) throw ApiError.forbidden();
  return streamDocument(res, req.params.kind, loaded, { download: req.query.download === '1' });
}));

export default r;
