import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { permit } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { privateUpload, safeJoin } from '../../middleware/upload.js';
import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, ymd } from '../../utils/zod.js';
import { Admission, Bed, Ward, IpdPackage, InsuranceClaim, DIETS, FREQ_HOURS } from '../../models/Ipd.js';
import { Invoice } from '../../models/Billing.js';
import { getSettings } from '../../models/Settings.js';
import { streamDocument, loadDocument } from '../../services/documents.js';
import * as notify from '../../services/notify.js';
import * as svc from './ipd.service.js';

/** IPD extras: packages, bed reservations, OT schedule, nursing station, investigations, documents, diet, interim bill, reports */
const r = Router();
// auth + branchScope are applied once where the IPD routers are mounted (app.js)
const idParam = z.object({ id: objectId });
const sub = (k) => z.object({ id: objectId, [k]: objectId });
const reply = async (res, id, status = 200) => ok(res, await svc.loadAdmission(id), status);
async function activeOwn(req) {
  const a = await svc.activeAdmission(req.params.id);
  if (!req.canAccessBranch(a.branch)) throw ApiError.forbidden();
  return a;
}
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const branchMatch = (req) => {
  const f = req.branchFilter('branch');
  if (f.branch?.$in) return { branch: { $in: f.branch.$in.map(oid) } };
  if (f.branch) return { branch: oid(f.branch) };
  return {};
};

// ================================================================ packages
const pkgBody = z.object({
  branch: objectId.nullable().optional(), name: z.string().trim().min(2).max(120), procedure: objectId.nullable().optional(), wardType: z.string().max(30).optional(),
  price: z.number().min(0), includedDays: z.number().int().min(0).max(30).default(1),
  covers: z.array(z.enum(['bed', 'nursing', 'procedure', 'ot', 'surgeon', 'anaesthesia', 'doctor_visit', 'pharmacy', 'consumable', 'investigation'])).default(['bed', 'nursing', 'procedure', 'ot', 'surgeon', 'anaesthesia', 'doctor_visit']),
  inclusions: z.array(z.string().max(120)).max(20).optional(), exclusions: z.array(z.string().max(120)).max(20).optional(), isActive: z.boolean().optional(),
});
r.get('/packages', permit('ipd.view'), asyncHandler(async (req, res) => {
  const f = req.query.all === 'true' ? {} : { isActive: true };
  if (req.query.branch) f.$or = [{ branch: null }, { branch: req.query.branch }];
  ok(res, await IpdPackage.find(f).populate('procedure', 'name sellPrice').populate('branch', 'name').sort({ name: 1 }).lean());
}));
r.post('/packages', permit('ipd.manage_settings'), validate({ body: pkgBody }), asyncHandler(async (req, res) => {
  if (req.body.branch) req.assertBranch(req.body.branch);
  const p = await IpdPackage.create(req.body);
  audit(req, { action: 'ipd.package_create', entity: 'IpdPackage', entityId: p._id, after: p });
  ok(res, p, 201);
}));
r.patch('/packages/:id', permit('ipd.manage_settings'), validate({ params: idParam, body: pkgBody.partial() }), asyncHandler(async (req, res) => {
  const p = await IpdPackage.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!p) throw ApiError.notFound('Package not found');
  audit(req, { action: 'ipd.package_edit', entity: 'IpdPackage', entityId: p._id, after: req.body });
  ok(res, p);
}));
/** apply / change / remove the package on an admission (snapshot — later price edits don't change this patient's bill) */
r.put('/admissions/:id/package', permit('ipd.edit'), validate({ params: idParam, body: z.object({ package: objectId.nullable(), price: z.number().min(0).optional() }) }), asyncHandler(async (req, res) => {
  const a = await activeOwn(req);
  if (!req.body.package) a.package = undefined;
  else {
    const p = await IpdPackage.findOne({ _id: req.body.package, isActive: true }).lean();
    if (!p) throw ApiError.notFound('Package not found');
    a.package = { ...svc.packageSnapshot(p), price: req.body.price ?? p.price };
    if (!a.plannedProcedure?.name && p.procedure) a.plannedProcedure = { product: p.procedure, name: p.name };
  }
  await a.save();
  audit(req, { action: 'ipd.package_apply', entity: 'Admission', entityId: a._id, branch: a.branch, after: req.body });
  await reply(res, a._id);
}));

// ================================================================ bed reservation (advance booking)
r.post('/beds/:id/reserve', permit('ipd.create'), validate({ params: idParam, body: z.object({ patient: objectId.optional(), name: z.string().trim().min(2).max(80), phone: z.string().max(15).optional(), date: z.coerce.date(), note: z.string().max(200).optional() }) }), asyncHandler(async (req, res) => {
  const b = await Bed.findOneAndUpdate({ _id: req.params.id, status: 'available', isActive: true }, { $set: { status: 'reserved', reservation: { ...req.body, by: req.user._id, at: new Date() } } }, { new: true });
  if (!b) throw ApiError.conflict('Bed is not free');
  req.assertBranch(b.branch);
  audit(req, { action: 'ipd.bed_reserve', entity: 'Bed', entityId: b._id, branch: b.branch, after: req.body });
  ok(res, b);
}));
r.delete('/beds/:id/reserve', permit('ipd.edit'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const b = await Bed.findOneAndUpdate({ _id: req.params.id, status: 'reserved' }, { $set: { status: 'available' }, $unset: { reservation: 1 } }, { new: true });
  if (!b) throw ApiError.badRequest('Bed is not reserved');
  req.assertBranch(b.branch);
  ok(res, b);
}));
r.get('/reservations', permit('ipd.view'), asyncHandler(async (req, res) => {
  ok(res, await Bed.find({ ...req.branchFilter('branch'), status: 'reserved' }).populate('ward', 'name').populate('reservation.patient', 'name patientId mobile').sort({ 'reservation.date': 1 }).lean());
}));

// ================================================================ OT schedule
r.get('/ot', permit('ipd.view'), validate({ query: z.object({ date: ymd.optional(), days: z.coerce.number().int().min(1).max(14).default(1) }).passthrough() }), asyncHandler(async (req, res) => {
  const from = new Date(`${req.query.date || new Date().toISOString().slice(0, 10)}T00:00:00+05:30`);
  const to = new Date(from.getTime() + (req.query.days || 1) * 86_400_000);
  const rows = await Admission.aggregate([
    { $match: { ...branchMatch(req), status: { $in: ['admitted', 'discharge_initiated', 'discharged'] } } },
    { $unwind: '$procedures' },
    { $match: { 'procedures.status': { $ne: 'cancelled' }, 'procedures.scheduledAt': { $gte: from, $lt: to } } },
    { $lookup: { from: 'patients', localField: 'patient', foreignField: '_id', as: 'p' } },
    { $lookup: { from: 'doctors', localField: 'procedures.surgeon', foreignField: '_id', as: 's' } },
    { $lookup: { from: 'beds', localField: 'bed', foreignField: '_id', as: 'b' } },
    { $project: { admission: '$_id', admissionNo: 1, branch: 1, patient: { $first: '$p.name' }, patientId: { $first: '$p.patientId' }, bed: { $first: '$b.number' }, proc: '$procedures', surgeon: { $first: '$s.name' }, preOpDone: { $size: { $filter: { input: { $ifNull: ['$preOp', []] }, cond: '$$this.done' } } }, preOpTotal: { $size: { $ifNull: ['$preOp', []] } }, consent: '$consent.signed' } },
    { $sort: { 'proc.scheduledAt': 1 } },
  ]);
  const s = await getSettings();
  ok(res, { rooms: s.ipd?.otRooms?.length ? s.ipd.otRooms : ['OT-1'], items: rows });
}));

// ================================================================ nursing station
r.get('/nursing', permit('ipd.view'), asyncHandler(async (req, res) => {
  const list = await Admission.find({ ...req.branchFilter('branch'), status: { $in: ['admitted', 'discharge_initiated'] } })
    .select('admissionNo patient doctor bed ward status type admittedAt expectedDischargeAt diet vitals medications investigations preOp procedures allergies')
    .populate('patient', 'name patientId gender ageYears dob').populate('doctor', 'name').populate('bed', 'number').populate('ward', 'name').lean();
  const now = Date.now();
  const out = list.map((a) => {
    const lastV = (a.vitals || []).reduce((m, v) => (!m || new Date(v.at) > new Date(m.at) ? v : m), null);
    const meds = (a.medications || []).filter((m) => m.active).map((m) => {
      const h = FREQ_HOURS[m.frequency];
      const given = (m.administrations || []).filter((x) => x.status === 'given');
      const last = given.length ? given[given.length - 1].at : null;
      const nextAt = h ? new Date(new Date(last || m.startAt).getTime() + (last ? h * 3_600_000 : 0)) : null;
      return { _id: m._id, name: m.name, dose: m.dose, route: m.route, frequency: m.frequency, lastGivenAt: last, nextAt, overdue: !!(nextAt && nextAt.getTime() < now - 30 * 60_000), due: !!(nextAt && nextAt.getTime() <= now + 60 * 60_000) };
    });
    const lastIO = (a.vitals || []).filter((v) => new Date(v.at).getTime() > now - 86_400_000);
    return {
      _id: a._id, admissionNo: a.admissionNo, patient: a.patient, doctor: a.doctor, bed: a.bed, ward: a.ward, status: a.status, type: a.type, allergies: a.allergies,
      admittedAt: a.admittedAt, expectedDischargeAt: a.expectedDischargeAt, diet: a.diet,
      lastVitalsAt: lastV?.at || null, lastVitals: lastV, vitalsDue: !lastV || new Date(lastV.at).getTime() < now - 6 * 3_600_000,
      meds, medsDue: meds.filter((m) => m.due || m.overdue).length,
      io24: { intake: lastIO.reduce((s2, v) => s2 + (v.intake || 0), 0), output: lastIO.reduce((s2, v) => s2 + (v.output || 0), 0) },
      labsPending: (a.investigations || []).filter((i) => ['ordered', 'sample_collected'].includes(i.status)).length,
      preOpPending: (a.preOp || []).filter((x) => !x.done).length,
      nextProcedure: (a.procedures || []).filter((p) => p.status === 'scheduled').sort((x, y) => new Date(x.scheduledAt || 0) - new Date(y.scheduledAt || 0))[0] || null,
    };
  }).sort((x, y) => (x.ward?.name || '').localeCompare(y.ward?.name || '') || (x.bed?.number || '').localeCompare(y.bed?.number || '', undefined, { numeric: true }));
  ok(res, out);
}));

// ================================================================ diet
r.put('/admissions/:id/diet', permit('ipd.edit'), validate({ params: idParam, body: z.object({ type: z.enum(DIETS), notes: z.string().max(300).optional() }) }), asyncHandler(async (req, res) => {
  const a = await activeOwn(req);
  a.diet = { ...req.body, by: req.user._id, at: new Date() };
  a.notes.push({ type: 'diet', text: `Diet: ${req.body.type.replace('_', ' ')}${req.body.notes ? ` — ${req.body.notes}` : ''}`, by: req.user._id });
  await a.save();
  await reply(res, a._id);
}));

// ================================================================ investigations (lab / radiology)
r.post('/admissions/:id/investigations', permit('ipd.edit'), validate({ params: idParam, body: z.object({ tests: z.array(z.object({ name: z.string().trim().min(2).max(120), rate: z.number().min(0).default(0), urgent: z.boolean().default(false) })).min(1).max(30) }) }), asyncHandler(async (req, res) => {
  const a = await activeOwn(req);
  for (const t of req.body.tests) {
    a.investigations.push({ ...t, orderedBy: req.user._id });
    if (t.rate > 0) a.charges.push({ kind: 'investigation', description: t.name, qty: 1, rate: t.rate, amount: t.rate, by: req.user._id });
  }
  await a.save();
  audit(req, { action: 'ipd.lab_order', entity: 'Admission', entityId: a._id, branch: a.branch, after: req.body });
  await reply(res, a._id);
}));
r.patch('/admissions/:id/investigations/:iid', permit('ipd.edit'), validate({ params: sub('iid'), body: z.object({ status: z.enum(['ordered', 'sample_collected', 'reported', 'cancelled']).optional(), result: z.string().max(4000).optional(), abnormal: z.boolean().optional(), document: objectId.optional() }) }), asyncHandler(async (req, res) => {
  const a = await Admission.findById(req.params.id);
  if (!a) throw ApiError.notFound('Admission not found');
  req.assertBranch(a.branch);
  const t = a.investigations.id(req.params.iid);
  if (!t) throw ApiError.notFound('Test not found');
  Object.assign(t, req.body, { by: req.user._id });
  if (req.body.status === 'sample_collected') t.collectedAt = new Date();
  if (req.body.status === 'reported' || req.body.result) { t.reportedAt = new Date(); t.status = 'reported'; }
  if (req.body.status === 'cancelled') {
    const c = a.charges.find((x) => x.kind === 'investigation' && x.description === t.name && !x.allocations?.length);
    if (c && ['admitted', 'discharge_initiated'].includes(a.status)) c.deleteOne();
  }
  await a.save();
  await reply(res, a._id);
}));

// ================================================================ admission documents (reports, scans, claim papers, ID proof)
const docUpload = privateUpload('ipd');
r.post('/admissions/:id/documents', permit('ipd.edit'), validate({ params: idParam }), docUpload.single('file'), asyncHandler(async (req, res) => {
  const a = await Admission.findById(req.params.id);
  if (!a) { if (req.file) fs.unlink(req.file.path, () => {}); throw ApiError.notFound('Admission not found'); }
  if (!req.canAccessBranch(a.branch)) { if (req.file) fs.unlink(req.file.path, () => {}); throw ApiError.forbidden(); }
  if (!req.file) throw ApiError.badRequest('Choose a file (PDF / JPG / PNG / WEBP)');
  const cat = ['report', 'scan', 'consent', 'claim', 'id_proof', 'other'].includes(req.body.category) ? req.body.category : 'report';
  a.documents.push({ title: String(req.body.title || req.file.originalname).slice(0, 120), category: cat, storedName: req.file.filename, originalName: req.file.originalname, mime: req.file.mimetype, size: req.file.size, by: req.user._id });
  const doc = a.documents[a.documents.length - 1];
  if (req.body.investigation) { const t = a.investigations.id(req.body.investigation); if (t) { t.document = doc._id; t.status = 'reported'; t.reportedAt = t.reportedAt || new Date(); } }
  await a.save();
  audit(req, { action: 'ipd.document_upload', entity: 'Admission', entityId: a._id, branch: a.branch, meta: { title: doc.title, category: cat } });
  await reply(res, a._id, 201);
}));
r.get('/admissions/:id/documents/:did', permit('ipd.view'), validate({ params: sub('did') }), asyncHandler(async (req, res) => {
  const a = await Admission.findById(req.params.id).select('branch documents').lean();
  if (!a) throw ApiError.notFound('Admission not found');
  if (!req.canAccessBranch(a.branch)) throw ApiError.forbidden();
  const d = (a.documents || []).find((x) => String(x._id) === req.params.did);
  if (!d) throw ApiError.notFound('Document not found');
  const p = safeJoin('ipd', d.storedName);
  if (!fs.existsSync(p)) throw ApiError.notFound('File missing');
  res.setHeader('Content-Type', d.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.originalName || d.title)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(p).pipe(res);
}));
r.delete('/admissions/:id/documents/:did', permit('ipd.edit'), validate({ params: sub('did') }), asyncHandler(async (req, res) => {
  const a = await Admission.findById(req.params.id);
  if (!a) throw ApiError.notFound('Admission not found');
  req.assertBranch(a.branch);
  const d = a.documents.id(req.params.did);
  if (!d) throw ApiError.notFound('Document not found');
  fs.unlink(safeJoin('ipd', d.storedName), () => {});
  d.deleteOne();
  await a.save();
  await reply(res, a._id);
}));

// ================================================================ interim bill / estimate (PDF + WhatsApp)
r.get('/admissions/:id/pdf-bill/:kind', permit('ipd.view'), validate({ params: z.object({ id: objectId, kind: z.enum(['interim', 'estimate']) }) }), asyncHandler(async (req, res) => {
  const loaded = await loadDocument(req.params.kind, req.params.id);
  if (!req.canAccessBranch(loaded.branch)) throw ApiError.forbidden();
  return streamDocument(res, req.params.kind, loaded, { download: req.query.download === '1' });
}));
r.post('/admissions/:id/send/:kind', permit('ipd.edit'), validate({ params: z.object({ id: objectId, kind: z.enum(['interim', 'estimate', 'discharge']) }) }), asyncHandler(async (req, res) => {
  const a = await Admission.findById(req.params.id).select('branch status').lean();
  if (!a) throw ApiError.notFound('Admission not found');
  if (!req.canAccessBranch(a.branch)) throw ApiError.forbidden();
  if (req.params.kind === 'discharge' && a.status !== 'discharged') throw ApiError.badRequest('Not discharged yet');
  notify.enqueue('ipd.send_doc', { admissionId: req.params.id, kind: req.params.kind });
  audit(req, { action: `ipd.send_${req.params.kind}`, entity: 'Admission', entityId: a._id, branch: a.branch });
  ok(res, { queued: true });
}));

// ================================================================ reports
r.get('/reports', permit('ipd.view'), validate({ query: z.object({ from: ymd, to: ymd }).passthrough() }), asyncHandler(async (req, res) => {
  const from = new Date(`${req.query.from}T00:00:00+05:30`);
  const to = new Date(`${req.query.to}T23:59:59.999+05:30`);
  const days = Math.max(1, Math.round((to - from) / 86_400_000));
  const bm = branchMatch(req);
  const [adms, beds, invs, claims] = await Promise.all([
    Admission.find({ ...req.branchFilter('branch'), status: { $ne: 'cancelled' }, admittedAt: { $lte: to }, $or: [{ dischargedAt: null }, { dischargedAt: { $gte: from } }] })
      .select('admittedAt dischargedAt status type payer.type ward procedures.name procedures.status package.name doctor').populate('ward', 'name').populate('doctor', 'name').lean(),
    Bed.countDocuments({ ...req.branchFilter('branch'), isActive: true }),
    Invoice.aggregate([{ $match: { ...bm, type: 'ipd', status: { $ne: 'cancelled' }, createdAt: { $gte: from, $lte: to } } }, { $lookup: { from: 'admissions', localField: 'admission', foreignField: '_id', as: 'a' } }, { $project: { grandTotal: 1, paid: 1, balance: 1, payer: { $ifNull: [{ $first: '$a.payer.type' }, 'self'] }, ward: { $first: '$a.ward' } } }]),
    InsuranceClaim.aggregate([{ $match: { ...bm, createdAt: { $lte: to } } }, { $group: { _id: '$status', n: { $sum: 1 }, claimed: { $sum: { $ifNull: ['$claimedAmount', 0] } }, settled: { $sum: { $ifNull: ['$settledAmount', 0] } }, deduction: { $sum: { $ifNull: ['$deduction', 0] } } } }]),
  ]);
  const inRange = (d) => d && new Date(d) >= from && new Date(d) <= to;
  // daily census
  const series = [];
  let bedDays = 0;
  for (let i = 0; i < days; i++) {
    const d0 = new Date(from.getTime() + i * 86_400_000);
    const d1 = new Date(d0.getTime() + 86_400_000);
    const census = adms.filter((a) => new Date(a.admittedAt) < d1 && (!a.dischargedAt || new Date(a.dischargedAt) >= d0)).length;
    bedDays += census;
    series.push({ date: new Date(d0.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10), admissions: adms.filter((a) => new Date(a.admittedAt) >= d0 && new Date(a.admittedAt) < d1).length, discharges: adms.filter((a) => a.dischargedAt && new Date(a.dischargedAt) >= d0 && new Date(a.dischargedAt) < d1).length, census });
  }
  const discharged = adms.filter((a) => a.status === 'discharged' && inRange(a.dischargedAt));
  const alos = discharged.length ? discharged.reduce((s2, a) => s2 + (new Date(a.dischargedAt) - new Date(a.admittedAt)) / 86_400_000, 0) / discharged.length : 0;
  const group = (rows, key, val) => Object.values(rows.reduce((m, x) => { const k = key(x) || '—'; m[k] ||= { name: k, value: 0, count: 0 }; m[k].value += val(x); m[k].count += 1; return m; }, {})).sort((x, y) => y.value - x.value);
  const wardName = new Map(adms.map((a) => [String(a.ward?._id), a.ward?.name]));
  const procs = group(adms.filter((a) => inRange(a.admittedAt)).flatMap((a) => (a.procedures || []).filter((p) => p.status === 'done')), (p) => p.name, () => 1);
  ok(res, {
    kpis: {
      admissions: adms.filter((a) => inRange(a.admittedAt)).length, discharges: discharged.length, inHouse: adms.filter((a) => a.status !== 'discharged').length,
      alos: Math.round(alos * 10) / 10, bedDays, beds, occupancy: beds ? Math.round((bedDays / (beds * days)) * 100) : 0,
      revenue: invs.reduce((s2, x) => s2 + x.grandTotal, 0), collected: invs.reduce((s2, x) => s2 + x.paid, 0), outstanding: invs.reduce((s2, x) => s2 + x.balance, 0),
      dayCare: adms.filter((a) => a.type === 'day_care' && inRange(a.admittedAt)).length, emergency: adms.filter((a) => a.type === 'emergency' && inRange(a.admittedAt)).length,
    },
    series,
    byPayer: group(invs, (x) => x.payer, (x) => x.grandTotal),
    byWard: group(invs, (x) => wardName.get(String(x.ward)) || 'Other', (x) => x.grandTotal),
    byDoctor: group(adms.filter((a) => inRange(a.admittedAt)), (a) => a.doctor?.name, () => 1),
    procedures: procs.slice(0, 10),
    claims,
  });
}));

/** attendant pass / sticker header info (visible to all IPD staff, not only settings admins) */
r.get('/print-info', permit('ipd.view'), asyncHandler(async (_req, res) => {
  const s = await getSettings();
  ok(res, { clinic: { name: s.clinic?.name, phone: s.clinic?.phone }, visitingHours: s.ipd?.visitingHours || '', passRules: s.ipd?.passRules || '' });
}));

export default r;
