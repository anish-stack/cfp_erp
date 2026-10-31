import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit, hasPerm } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { privateUpload, safeJoin } from '../../middleware/upload.js';
import { asyncHandler, ok, paged, parsePaging } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, ymd, paging } from '../../utils/zod.js';
import { nextDocNo } from '../../utils/counter.js';
import { todayIST } from '../../utils/time.js';
import { MedicalRecord, Prescription, FollowUp, PatientDocument, PrescriptionTemplate } from '../../models/Clinical.js';
import { Appointment } from '../../models/Appointment.js';
import { Branch } from '../../models/Branch.js';
import { Patient } from '../../models/Patient.js';
import { getForStaff } from '../patients/patients.service.js';
import { Invoice } from '../../models/Billing.js';
import { loadDocument, streamDocument } from '../../services/documents.js';
import * as notify from '../../services/notify.js';

const r = Router();
r.use(auth, branchScope);
const idParam = z.object({ id: objectId });
const LOCK_HOURS = 24;

const recordBody = z.object({
  patient: objectId,
  branch: objectId,
  doctor: objectId.optional(),
  appointment: objectId.optional(),
  type: z.enum(['consultation', 'procedure', 'note', 'investigation']).default('consultation'),
  complaints: z.string().max(3000).optional(),
  history: z.string().max(3000).optional(),
  examination: z.string().max(3000).optional(),
  diagnosis: z.string().max(1000).optional(),
  procedure: z.object({ name: z.string().max(200).optional(), anesthesia: z.string().max(100).optional(), notes: z.string().max(3000).optional(), date: ymd.optional() }).optional(),
  plan: z.string().max(3000).optional(),
  vitals: z.object({
    bp: z.string().max(10).optional(), pulse: z.number().optional(), temp: z.number().optional(),
    weightKg: z.number().optional(), heightCm: z.number().optional(), spo2: z.number().optional(),
  }).optional(),
  investigations: z.array(z.object({ name: z.string().max(120), result: z.string().max(500).optional(), date: ymd.optional() })).max(30).optional(),
});

const rxItemSchema = z.object({
  product: objectId.optional().nullable(), name: z.string().trim().min(1).max(160), dose: z.string().max(60).optional(),
  frequency: z.string().max(40).optional(), timing: z.string().max(60).optional(), duration: z.string().max(40).optional(),
  qty: z.number().min(0).optional(), notes: z.string().max(200).optional(),
});
const vitalsSchema = z.object({ bp: z.string().max(10).optional(), pulse: z.number().optional(), temp: z.number().optional(), weightKg: z.number().optional(), spo2: z.number().optional() }).partial();
const rxBody = z.object({
  patient: objectId,
  branch: objectId,
  doctor: objectId.optional(),
  appointment: objectId.optional(),
  record: objectId.optional(),
  mode: z.enum(['typed', 'image', 'both']).default('typed'),
  template: objectId.optional(),
  complaints: z.string().max(2000).optional(),
  diagnosis: z.string().max(1000).optional(),
  vitals: vitalsSchema.optional(),
  items: z.array(rxItemSchema).max(40).default([]),
  investigations: z.string().max(2000).optional(),
  advice: z.string().max(3000).optional(),
  diet: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
  followUpDate: ymd.optional(),
  sendWhatsApp: z.boolean().optional(),
}).refine((d) => d.mode !== 'typed' || d.items.length || d.diagnosis || d.advice, 'Add at least one medicine, diagnosis or advice');


/** patient must be visible to staff + target branch within scope */
async function guard(req, patientId, branchId) {
  await getForStaff(req, patientId);
  if (branchId) req.assertBranch(branchId);
}

// doctors writing records default to own doctor id
const doctorOf = (req, explicit) => explicit || (req.user.doctor ? String(req.user.doctor) : undefined);

// ---------- medical records ----------
r.get('/records', permit('medical_records.view'), validate({ query: z.object({ patient: objectId, appointment: objectId.optional() }) }), asyncHandler(async (req, res) => {
  await guard(req, req.query.patient);
  const items = await MedicalRecord.find({ patient: req.query.patient, ...(req.query.appointment ? { appointment: req.query.appointment } : {}) })
    .populate('doctor', 'name').populate('branch', 'name code').populate('createdBy', 'name').sort({ createdAt: -1 }).lean();
  audit(req, { action: 'medical_records.view', entity: 'Patient', entityId: req.query.patient });
  ok(res, items);
}));

r.post('/records', permit('medical_records.create'), validate({ body: recordBody }), asyncHandler(async (req, res) => {
  await guard(req, req.body.patient, req.body.branch);
  const rec = await MedicalRecord.create({ ...req.body, doctor: doctorOf(req, req.body.doctor), createdBy: req.user._id });
  if (req.body.appointment) await Appointment.updateOne({ _id: req.body.appointment, status: 'checked_in' }, { status: 'in_consultation' });
  audit(req, { action: 'medical_records.create', entity: 'MedicalRecord', entityId: rec._id, branch: rec.branch, after: rec });
  ok(res, rec, 201);
}));

r.patch('/records/:id', permit('medical_records.edit'), validate({ params: idParam, body: recordBody.partial().omit({ patient: true, branch: true }) }), asyncHandler(async (req, res) => {
  const rec = await MedicalRecord.findById(req.params.id);
  if (!rec) throw ApiError.notFound();
  await guard(req, rec.patient, rec.branch);
  const ageH = (Date.now() - rec.createdAt.getTime()) / 3600_000;
  if ((rec.isLocked || ageH > LOCK_HOURS) && !req.isSuperAdmin) throw ApiError.forbidden(`Records lock ${LOCK_HOURS}h after creation. Add a new note instead`);
  if (String(rec.createdBy) !== String(req.user._id) && !hasPerm(req, 'medical_records.approve')) throw ApiError.forbidden('Only the author can edit this record');
  const before = rec.toObject();
  Object.assign(rec, req.body, { updatedBy: req.user._id });
  await rec.save();
  audit(req, { action: 'medical_records.edit', entity: 'MedicalRecord', entityId: rec._id, branch: rec.branch, before, after: rec });
  ok(res, rec);
}));

// ---------- prescriptions ----------
r.get('/prescriptions', permit('medical_records.view'), validate({ query: z.object({ patient: objectId, appointment: objectId.optional() }) }), asyncHandler(async (req, res) => {
  await guard(req, req.query.patient);
  ok(res, await Prescription.find({ patient: req.query.patient, ...(req.query.appointment ? { appointment: req.query.appointment } : {}) }).populate('doctor', 'name').populate('branch', 'name code').sort({ createdAt: -1 }).lean());
}));

r.post('/prescriptions', permit('medical_records.create'), validate({ body: rxBody }), asyncHandler(async (req, res) => {
  await guard(req, req.body.patient, req.body.branch);
  const doctor = doctorOf(req, req.body.doctor);
  if (!doctor) throw ApiError.badRequest('Doctor required');
  const branch = await Branch.findById(req.body.branch).select('code').lean();
  const rxNo = await nextDocNo('RX', branch.code);
  const { sendWhatsApp, ...rxData } = req.body; // eslint-disable-line no-unused-vars
  if (rxData.template) rxData.templateName = (await PrescriptionTemplate.findById(rxData.template).select('name').lean())?.name;
  const rx = await Prescription.create({ ...rxData, doctor, rxNo, createdBy: req.user._id });
  if (rx.appointment) await Appointment.updateOne({ _id: rx.appointment, status: 'checked_in' }, { status: 'in_consultation' });
  if (req.body.followUpDate) {
    await FollowUp.create({ patient: rx.patient, branch: rx.branch, doctor, sourceAppointment: rx.appointment, dueDate: req.body.followUpDate, reason: 'Doctor advised follow-up', createdBy: req.user._id });
  }
  audit(req, { action: 'medical_records.create', entity: 'Prescription', entityId: rx._id, branch: rx.branch, after: rx });
  // image prescriptions are sent after the images are uploaded (POST /prescriptions/:id/images?send=1)
  if (req.body.sendWhatsApp !== false && rx.mode === 'typed') notify.enqueue('prescription.send', { rxId: String(rx._id) });
  ok(res, rx, 201);
}));

/** manual resend on WhatsApp (message + signed PDF link) */
r.post('/prescriptions/:id/send', permit('medical_records.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const rx = await Prescription.findById(req.params.id).select('patient branch').lean();
  if (!rx) throw ApiError.notFound();
  await guard(req, rx.patient);
  await notify.enqueueStrict('prescription.send', { rxId: String(rx._id), force: true });
  audit(req, { action: 'medical_records.export', entity: 'Prescription', entityId: rx._id, branch: rx.branch, meta: { channel: 'whatsapp' } });
  ok(res, { queued: true });
}));

r.get('/prescriptions/:id/pdf', permit('medical_records.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const loaded = await loadDocument('rx', req.params.id);
  await guard(req, loaded.patient);
  audit(req, { action: 'medical_records.export', entity: 'Prescription', entityId: loaded.doc._id, branch: loaded.branch });
  return streamDocument(res, 'rx', loaded, { download: req.query.download === '1' });
}));

/** edit within 24h (author or approver) */
r.patch('/prescriptions/:id', permit('medical_records.edit'), validate({ params: idParam, body: z.object({
  complaints: z.string().max(2000).optional(), diagnosis: z.string().max(1000).optional(), vitals: vitalsSchema.optional(), items: z.array(rxItemSchema).max(40).optional(),
  investigations: z.string().max(2000).optional(), advice: z.string().max(3000).optional(), diet: z.string().max(2000).optional(), notes: z.string().max(2000).optional(), followUpDate: ymd.optional().nullable(),
}) }), asyncHandler(async (req, res) => {
  const rx = await Prescription.findById(req.params.id);
  if (!rx) throw ApiError.notFound();
  await guard(req, rx.patient, rx.branch);
  if ((Date.now() - rx.createdAt.getTime()) / 3600_000 > LOCK_HOURS && !req.isSuperAdmin) throw ApiError.forbidden(`Prescriptions lock ${LOCK_HOURS}h after creation`);
  if (String(rx.createdBy) !== String(req.user._id) && !hasPerm(req, 'medical_records.approve')) throw ApiError.forbidden('Only the author can edit');
  const before = rx.toObject();
  Object.assign(rx, req.body);
  await rx.save();
  audit(req, { action: 'medical_records.edit', entity: 'Prescription', entityId: rx._id, branch: rx.branch, before, after: rx });
  ok(res, rx);
}));

/** attach photos / scans of a handwritten prescription (PNG/JPG, max 5) */
const rxImageUpload = privateUpload('rx');
r.post('/prescriptions/:id/images', permit('medical_records.create'), validate({ params: idParam }), rxImageUpload.array('files', 5), asyncHandler(async (req, res) => {
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  const rx = await Prescription.findById(req.params.id);
  if (!rx) { cleanup(); throw ApiError.notFound(); }
  try { await guard(req, rx.patient, rx.branch); } catch (e) { cleanup(); throw e; }
  const bad = files.filter((f) => !/image\/(png|jpe?g)/.test(f.mimetype));
  if (!files.length || bad.length) { cleanup(); throw ApiError.badRequest('Upload 1-5 PNG or JPG images'); }
  if (rx.images.length + files.length > 8) { cleanup(); throw ApiError.badRequest('Max 8 images per prescription'); }
  rx.images.push(...files.map((f) => ({ storedName: f.filename, originalName: f.originalname, mime: f.mimetype, size: f.size })));
  if (rx.mode === 'typed') rx.mode = 'both';
  await rx.save();
  audit(req, { action: 'medical_records.create', entity: 'Prescription', entityId: rx._id, branch: rx.branch, meta: { images: files.length } });
  if (req.query.send === '1') notify.enqueue('prescription.send', { rxId: String(rx._id) });
  ok(res, rx, 201);
}));

r.get('/prescriptions/:id/images/:idx', permit('medical_records.view'), validate({ params: z.object({ id: objectId, idx: z.coerce.number().int().min(0).max(20) }) }), asyncHandler(async (req, res) => {
  const rx = await Prescription.findById(req.params.id).select('patient images').lean();
  if (!rx) throw ApiError.notFound();
  await guard(req, rx.patient);
  const img = rx.images?.[req.params.idx];
  if (!img) throw ApiError.notFound();
  const p = safeJoin('rx', img.storedName);
  if (!fs.existsSync(p)) throw ApiError.notFound('File missing');
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', 'private, max-age=600');
  fs.createReadStream(p).pipe(res);
}));

r.delete('/prescriptions/:id/images/:idx', permit('medical_records.edit'), validate({ params: z.object({ id: objectId, idx: z.coerce.number().int().min(0).max(20) }) }), asyncHandler(async (req, res) => {
  const rx = await Prescription.findById(req.params.id);
  if (!rx) throw ApiError.notFound();
  await guard(req, rx.patient, rx.branch);
  const [img] = rx.images.splice(req.params.idx, 1);
  if (!img) throw ApiError.notFound();
  await rx.save();
  fs.unlink(safeJoin('rx', img.storedName), () => {});
  ok(res, rx);
}));

// ---------- prescription types (templates) ----------
const tplBody = z.object({
  name: z.string().trim().min(2).max(100), condition: z.string().max(60).optional(), diagnosis: z.string().max(1000).optional(), complaints: z.string().max(2000).optional(),
  items: z.array(rxItemSchema).max(40).default([]), investigations: z.string().max(2000).optional(), advice: z.string().max(3000).optional(), diet: z.string().max(2000).optional(),
  followUpDays: z.number().int().min(0).max(365).optional().nullable(), doctor: objectId.optional().nullable(), isActive: z.boolean().optional(),
});
r.get('/rx-templates', permit('medical_records.view'), asyncHandler(async (req, res) => {
  const f = req.query.all === 'true' ? {} : { isActive: true };
  if (req.query.doctor) f.$or = [{ doctor: null }, { doctor: req.query.doctor }];
  ok(res, await PrescriptionTemplate.find(f).populate('doctor', 'name').sort({ condition: 1, name: 1 }).lean());
}));
r.post('/rx-templates', permit('medical_records.create'), validate({ body: tplBody }), asyncHandler(async (req, res) => {
  const t = await PrescriptionTemplate.create({ ...req.body, createdBy: req.user._id });
  audit(req, { action: 'medical_records.template_create', entity: 'PrescriptionTemplate', entityId: t._id, after: t });
  ok(res, t, 201);
}));
r.patch('/rx-templates/:id', permit('medical_records.edit'), validate({ params: idParam, body: tplBody.partial() }), asyncHandler(async (req, res) => {
  const t = await PrescriptionTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!t) throw ApiError.notFound();
  ok(res, t);
}));
r.delete('/rx-templates/:id', permit('medical_records.delete'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  await PrescriptionTemplate.updateOne({ _id: req.params.id }, { isActive: false });
  ok(res, { deleted: true });
}));

// ---------- follow-ups ----------
const fuQuery = paging.extend({ status: z.string().optional(), from: ymd.optional(), to: ymd.optional(), due: z.enum(['today', 'overdue', 'upcoming']).optional(), patient: objectId.optional() });

r.get('/followups', permit('followups.view'), validate({ query: fuQuery }), asyncHandler(async (req, res) => {
  const q = req.query;
  const f = { ...req.branchFilter('branch') };
  const today = todayIST();
  if (q.patient) f.patient = q.patient;
  if (q.status) f.status = { $in: q.status.split(',') };
  if (q.due === 'today') f.dueDate = today;
  if (q.due === 'overdue') Object.assign(f, { dueDate: { $lt: today }, status: { $in: ['pending', 'contacted'] } });
  if (q.due === 'upcoming') f.dueDate = { $gt: today };
  if (q.from || q.to) f.dueDate = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const { page, limit, skip } = parsePaging(q);
  const [items, total] = await Promise.all([
    FollowUp.find(f).populate('patient', 'name patientId mobile').populate('doctor', 'name').populate('assignedTo', 'name').sort({ dueDate: 1 }).skip(skip).limit(limit).lean(),
    FollowUp.countDocuments(f),
  ]);
  paged(res, { items, total, page, limit });
}));

r.post('/followups', permit('followups.create'), validate({ body: z.object({ patient: objectId, branch: objectId, doctor: objectId.optional(), dueDate: ymd, reason: z.string().max(300).optional(), assignedTo: objectId.optional(), sourceAppointment: objectId.optional() }) }), asyncHandler(async (req, res) => {
  await guard(req, req.body.patient, req.body.branch);
  const fu = await FollowUp.create({ ...req.body, createdBy: req.user._id });
  audit(req, { action: 'followups.create', entity: 'FollowUp', entityId: fu._id, branch: fu.branch, after: fu });
  ok(res, fu, 201);
}));

r.patch('/followups/:id', permit('followups.edit'), validate({ params: idParam, body: z.object({ status: z.enum(['pending', 'contacted', 'booked', 'done', 'missed', 'cancelled']).optional(), dueDate: ymd.optional(), note: z.string().max(500).optional(), assignedTo: objectId.nullable().optional(), bookedAppointment: objectId.optional() }) }), asyncHandler(async (req, res) => {
  const fu = await FollowUp.findById(req.params.id);
  if (!fu) throw ApiError.notFound();
  req.assertBranch(fu.branch);
  const { note, ...rest } = req.body;
  Object.assign(fu, rest);
  if (note) fu.notes.push({ text: note, by: req.user._id });
  await fu.save();
  audit(req, { action: 'followups.edit', entity: 'FollowUp', entityId: fu._id, branch: fu.branch, after: rest });
  ok(res, fu);
}));

// ---------- documents ----------
r.get('/documents', permit('medical_records.view'), validate({ query: z.object({ patient: objectId }) }), asyncHandler(async (req, res) => {
  await guard(req, req.query.patient);
  ok(res, await PatientDocument.find({ patient: req.query.patient }).populate('uploadedBy', 'name').sort({ createdAt: -1 }).lean());
}));

r.post('/documents', permit('medical_records.create'), privateUpload('patients').single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('File required');
  const body = z.object({ patient: objectId, branch: objectId.optional(), title: z.string().min(1).max(120), category: z.enum(['report', 'scan', 'prescription', 'consent', 'invoice', 'other']).default('report') }).safeParse(req.body);
  if (!body.success) {
    fs.unlink(req.file.path, () => {});
    throw ApiError.badRequest('Validation failed', body.error.issues);
  }
  try {
    await guard(req, body.data.patient, body.data.branch);
  } catch (e) {
    fs.unlink(req.file.path, () => {});
    throw e;
  }
  const doc = await PatientDocument.create({ ...body.data, storedName: req.file.filename, originalName: req.file.originalname, mime: req.file.mimetype, size: req.file.size, uploadedBy: req.user._id });
  audit(req, { action: 'medical_records.create', entity: 'PatientDocument', entityId: doc._id, after: doc });
  ok(res, doc, 201);
}));

r.get('/documents/:id/file', permit('medical_records.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const doc = await PatientDocument.findById(req.params.id);
  if (!doc) throw ApiError.notFound();
  await guard(req, doc.patient);
  audit(req, { action: 'medical_records.view', entity: 'PatientDocument', entityId: doc._id });
  const p = safeJoin('patients', doc.storedName);
  if (!fs.existsSync(p)) throw ApiError.notFound('File missing');
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalName || doc.storedName)}"`);
  fs.createReadStream(p).pipe(res);
}));

r.delete('/documents/:id', permit('medical_records.delete'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const doc = await PatientDocument.findById(req.params.id);
  if (!doc) throw ApiError.notFound();
  await guard(req, doc.patient);
  await doc.deleteOne();
  fs.unlink(safeJoin('patients', doc.storedName), () => {});
  audit(req, { action: 'medical_records.delete', entity: 'PatientDocument', entityId: doc._id, before: doc });
  ok(res, { deleted: true });
}));

// ---------- patient timeline (one call for profile page) ----------
r.get('/timeline/:id', permit('patients.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const patient = await getForStaff(req, req.params.id);
  const medical = hasPerm(req, 'medical_records.view');
  const billing = hasPerm(req, 'billing.view');
  const [appointments, records, prescriptions, followups, invoices, family] = await Promise.all([
    Appointment.find({ patient: patient._id }).populate('doctor', 'name').populate('branch', 'name code').sort({ date: -1, start: -1 }).limit(100).lean(),
    medical ? MedicalRecord.find({ patient: patient._id }).populate('doctor', 'name').populate('createdBy', 'name').sort({ createdAt: -1 }).lean() : [],
    medical ? Prescription.find({ patient: patient._id }).populate('doctor', 'name').sort({ createdAt: -1 }).lean() : [],
    FollowUp.find({ patient: patient._id }).populate('doctor', 'name').sort({ dueDate: -1 }).lean(),
    billing ? Invoice.find({ patient: patient._id }).select('invoiceNo type grandTotal paid balance status createdAt branch').populate('branch', 'code').sort({ createdAt: -1 }).lean() : [],
    Patient.find({ account: patient.account, _id: { $ne: patient._id }, isActive: true }).select('name patientId relation').lean(),
  ]);
  if (medical) audit(req, { action: 'medical_records.view', entity: 'Patient', entityId: patient._id });
  ok(res, { patient, appointments, records, prescriptions, followups, invoices, family, access: { medical, billing } });
}));

export default r;
