import { withTransaction } from '../../config/db.js';
import { Admission, Bed, Ward, IpdPackage } from '../../models/Ipd.js';
import { Branch } from '../../models/Branch.js';
import { Patient } from '../../models/Patient.js';
import { Product, STOCK_TYPES } from '../../models/Inventory.js';
import { FollowUp } from '../../models/Clinical.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextDocNo } from '../../utils/counter.js';
import { r2 } from '../../utils/invoiceMath.js';
import * as stock from '../inventory/stock.service.js';
import { createInvoice, advanceBalance } from '../billing/billing.service.js';
import * as notify from '../../services/notify.js';
import { getSettings } from '../../models/Settings.js';

export const DEFAULT_PREOP = [
  'Consent signed', 'Nil by mouth (NBM) since', 'CBC / Blood sugar / Viral markers reviewed', 'BP & sugar controlled',
  'Allergies checked', 'Part preparation / shaving', 'Enema / bowel preparation', 'IV line secured', 'Jewellery & dentures removed', 'Pre-op antibiotic given',
];

let GRACE_HOURS = 2;
export const setGraceHours = (h) => { if (Number.isFinite(h)) GRACE_HOURS = h; };
/** chargeable days for a stay segment: every started 24 h (after a grace period, default 2 h), minimum 1 */
export function stayDays(from, to = new Date(), type) {
  if (type === 'day_care') return 1;
  const hours = (new Date(to) - new Date(from)) / 3_600_000;
  return Math.max(1, Math.ceil((hours - GRACE_HOURS) / 24));
}

/**
 * running bill: room + nursing per bed segment (computed) + posted charges.
 * With a package: one package line; covered kinds show as "included" (₹0) and room/nursing only beyond includedDays.
 */
export function runningBill(adm, upto = new Date()) {
  const end = adm.dischargedAt || upto;
  const lines = [];
  const segs = adm.bedHistory || [];
  const pkg = adm.package?.name ? adm.package : null;
  const covers = new Set(pkg?.covers || []);
  if (pkg) lines.push({ kind: 'package', description: `Package: ${pkg.name}${pkg.includedDays ? ` (incl. ${pkg.includedDays} day${pkg.includedDays > 1 ? 's' : ''} stay)` : ''}`, qty: 1, rate: pkg.price, gstRate: 0, amount: r2(pkg.price), computed: true });
  // total chargeable days for the whole stay, split across bed segments (transfers never double-charge a day)
  const totalDays = segs.length ? stayDays(segs[0].from, segs[segs.length - 1].to || end, adm.type) : 0;
  let used = 0;
  let includedLeft = pkg ? pkg.includedDays || 0 : 0;
  segs.forEach((s, i) => {
    const isLast = i === segs.length - 1;
    const days = isLast ? Math.max(0, totalDays - used) : Math.min(totalDays - used, Math.floor((new Date(s.to || end) - new Date(s.from)) / 86_400_000));
    used += days;
    if (!days) return;
    const inc = Math.min(days, includedLeft);
    includedLeft -= inc;
    const extra = days - inc;
    const label = `${s.wardName || 'Room'} — Bed ${s.bedNumber || ''}`.trim();
    const push = (kind, title, rate, gst) => {
      if (!rate) return;
      const coveredKind = covers.has(kind);
      if (coveredKind && inc) lines.push({ kind, description: `${title} (${inc} day${inc > 1 ? 's' : ''}, included in package)`, qty: inc, rate, gstRate: gst, amount: 0, included: true, computed: true });
      const n = coveredKind ? extra : days;
      if (n) lines.push({ kind, description: `${title} (${n} day${n > 1 ? 's' : ''}${coveredKind ? ', beyond package' : ''})`, qty: n, rate, gstRate: gst, amount: r2(n * rate), computed: true });
    };
    push('bed', `Room rent: ${label}`, s.dailyRate, s.gstRate || 0);
    push('nursing', `Nursing care: ${s.wardName || ''}`.trim(), s.nursingRate, 0);
  });
  for (const c of adm.charges || []) {
    const inc = pkg && covers.has(c.kind);
    lines.push({ _id: c._id, kind: c.kind, description: `${c.description}${inc ? ' (included in package)' : ''}`, qty: c.qty, rate: c.rate, gstRate: c.gstRate || 0, amount: inc ? 0 : r2(c.amount ?? c.qty * c.rate), included: inc || undefined, date: c.date });
  }
  const total = r2(lines.reduce((a, l) => a + l.amount, 0));
  return { lines, total, days: totalDays };
}

const POP = [
  { path: 'patient', select: 'name patientId mobile gender ageYears dob allergies bloodGroup address' },
  { path: 'doctor', select: 'name qualification regNo' },
  { path: 'branch', select: 'name code' },
  { path: 'bed', select: 'number status' },
  { path: 'ward', select: 'name type dailyRate nursingRate' },
  { path: 'invoice', select: 'invoiceNo grandTotal paid balance status' },
  { path: 'claim', select: 'claimRef status approvedAmount claimedAmount settledAmount' },
  { path: 'investigations.orderedBy investigations.by documents.by diet.by', select: 'name' },
  { path: 'procedures.surgeon', select: 'name' },
  { path: 'notes.by vitals.by medications.orderedBy medications.administrations.by charges.by preOp.by', select: 'name' },
];
export const populateAdmission = (q) => q.populate(POP);

export async function loadAdmission(id) {
  const a = await populateAdmission(Admission.findById(id));
  if (!a) throw ApiError.notFound('Admission not found');
  return a;
}

export const packageSnapshot = (p) => ({ package: p._id, name: p.name, price: p.price, includedDays: p.includedDays, covers: p.covers, appliedAt: new Date() });

// ---------------------------------------------------------------- admit
export async function admit(data, user) {
  const branch = await Branch.findById(data.branch).select('code isActive').lean();
  if (!branch?.isActive) throw ApiError.badRequest('Invalid branch');
  if (!(await Patient.exists({ _id: data.patient }))) throw ApiError.badRequest('Patient not found');
  if (await Admission.exists({ patient: data.patient, status: { $in: ['admitted', 'discharge_initiated'] } })) throw ApiError.conflict('Patient is already admitted');
  let pkg = null;
  if (data.package) {
    const p = await IpdPackage.findOne({ _id: data.package, isActive: true }).lean();
    if (!p) throw ApiError.badRequest('Package not found');
    pkg = packageSnapshot(p);
    if (!data.plannedProcedure?.product && p.procedure) data.plannedProcedure = { product: p.procedure };
  }
  let proc = null;
  if (data.plannedProcedure?.product) {
    const p = await Product.findById(data.plannedProcedure.product).select('name').lean();
    proc = { product: p?._id, name: data.plannedProcedure.name || p?.name };
  } else if (data.plannedProcedure?.name) proc = { name: data.plannedProcedure.name };

  const adm = await withTransaction(async (session) => {
    const bed = await Bed.findOneAndUpdate(
      { _id: data.bed, branch: data.branch, isActive: true, status: { $in: ['available', 'reserved'] } },
      { $set: { status: 'occupied' } },
      { new: true, session }
    );
    if (!bed) throw ApiError.conflict('Bed is not available — pick another bed');
    const ward = await Ward.findById(bed.ward).session(session).lean();
    const at = data.admittedAt ? new Date(data.admittedAt) : new Date();
    const [a] = await Admission.create([{
      admissionNo: await nextDocNo('ADM', branch.code, session),
      branch: data.branch, patient: data.patient, appointment: data.appointment, doctor: data.doctor, type: data.type || 'planned',
      admittedAt: at, expectedDischargeAt: data.expectedDischargeAt, reason: data.reason, provisionalDiagnosis: data.provisionalDiagnosis,
      plannedProcedure: proc || undefined, allergies: data.allergies, attendant: data.attendant, payer: data.payer, estimate: data.estimate,
      bed: bed._id, ward: ward._id, package: pkg || undefined,
      bedHistory: [{ bed: bed._id, bedNumber: bed.number, ward: ward._id, wardName: ward.name, dailyRate: ward.dailyRate, nursingRate: ward.nursingRate, gstRate: ward.gstRate, from: at }],
      preOp: proc ? DEFAULT_PREOP.map((item) => ({ item, done: false })) : [],
      procedures: proc ? [{ service: proc.product, name: proc.name, surgeon: data.doctor, scheduledAt: data.procedureAt ? new Date(data.procedureAt) : undefined, status: 'scheduled', by: user._id }] : [],
      notes: data.note ? [{ type: 'progress', text: data.note, by: user._id }] : [],
      createdBy: user._id,
    }], { session });
    bed.currentAdmission = a._id;
    bed.reservation = undefined;
    await bed.save({ session });
    return a;
  });
  notify.enqueue('ipd.admitted', { admissionId: String(adm._id) });
  return adm;
}

// ---------------------------------------------------------------- bed transfer
export async function transfer(id, { bed: bedId, reason }, user) {
  return withTransaction(async (session) => {
    const a = await Admission.findById(id).session(session);
    if (!a || !['admitted', 'discharge_initiated'].includes(a.status)) throw ApiError.badRequest('Admission is not active');
    if (String(a.bed) === String(bedId)) throw ApiError.badRequest('Already in this bed');
    const nb = await Bed.findOneAndUpdate({ _id: bedId, branch: a.branch, isActive: true, status: { $in: ['available', 'reserved'] } }, { $set: { status: 'occupied', currentAdmission: a._id } }, { new: true, session });
    if (!nb) throw ApiError.conflict('Target bed is not available');
    const ward = await Ward.findById(nb.ward).session(session).lean();
    const now = new Date();
    const last = a.bedHistory[a.bedHistory.length - 1];
    if (last && !last.to) last.to = now;
    await Bed.updateOne({ _id: a.bed, currentAdmission: a._id }, { $set: { status: 'cleaning', currentAdmission: null } }, { session });
    a.bedHistory.push({ bed: nb._id, bedNumber: nb.number, ward: ward._id, wardName: ward.name, dailyRate: ward.dailyRate, nursingRate: ward.nursingRate, gstRate: ward.gstRate, from: now });
    a.bed = nb._id;
    a.ward = ward._id;
    a.notes.push({ type: 'handover', text: `Shifted to ${ward.name} / Bed ${nb.number}${reason ? ` — ${reason}` : ''}`, by: user._id });
    await a.save({ session });
    return a;
  });
}

// ---------------------------------------------------------------- charges & pharmacy
export async function addCharge(id, c, user) {
  const a = await activeAdmission(id);
  let product = null;
  if (c.product) product = await Product.findById(c.product).lean();
  if (product && STOCK_TYPES.includes(product.type)) throw ApiError.badRequest('Use “Issue from pharmacy” for stock items');
  const rate = c.rate ?? product?.sellPrice ?? 0;
  const qty = c.qty || 1;
  a.charges.push({ kind: c.kind || (product ? 'procedure' : 'other'), description: c.description || product?.name, product: product?._id, qty, rate, gstRate: c.gstRate ?? 0, amount: r2(qty * rate), date: c.date || new Date(), by: user._id });
  await a.save();
  return a;
}

export async function issueMedicine(id, { product: pid, qty, addToMar, dose, frequency, route }, user) {
  return withTransaction(async (session) => {
    const a = await Admission.findById(id).session(session);
    if (!a || !['admitted', 'discharge_initiated'].includes(a.status)) throw ApiError.badRequest('Admission is not active');
    const p = await Product.findById(pid).session(session).lean();
    if (!p || !STOCK_TYPES.includes(p.type)) throw ApiError.badRequest('Pick a medicine / consumable');
    const alloc = await stock.issueFEFO({ branch: a.branch, product: p._id, qty, type: 'sale', refType: 'Admission', refId: a._id, refNo: a.admissionNo, by: user._id }, session);
    a.charges.push({
      kind: p.type === 'consumable' ? 'consumable' : 'pharmacy', description: p.name, product: p._id, qty, rate: p.sellPrice || p.mrp || 0, gstRate: p.gstRate || 0,
      amount: r2(qty * (p.sellPrice || p.mrp || 0)), allocations: alloc.map(({ batch, batchNo, expiry, qty: q }) => ({ batch, batchNo, expiry, qty: q })), by: user._id,
    });
    if (addToMar && p.type === 'medicine') a.medications.push({ product: p._id, name: p.name, dose, frequency, route: route || 'oral', orderedBy: user._id });
    await a.save({ session });
    return a;
  });
}

export async function removeCharge(id, chargeId, user) {
  return withTransaction(async (session) => {
    const a = await Admission.findById(id).session(session);
    if (!a || !['admitted', 'discharge_initiated'].includes(a.status)) throw ApiError.badRequest('Admission is not active');
    const c = a.charges.id(chargeId);
    if (!c) throw ApiError.notFound('Charge not found');
    for (const al of c.allocations || []) {
      await stock.restockBatch({ batch: al.batch, qty: al.qty, type: 'return', refType: 'Admission', refId: a._id, refNo: a.admissionNo, by: user._id, reason: 'IPD charge removed' }, session);
    }
    c.deleteOne();
    await a.save({ session });
    return a;
  });
}

async function activeAdmission(id) {
  const a = await Admission.findById(id);
  if (!a) throw ApiError.notFound('Admission not found');
  if (!['admitted', 'discharge_initiated'].includes(a.status)) throw ApiError.badRequest('Admission is closed');
  return a;
}
export { activeAdmission };

/** finishing a procedure posts its charge once (service price) */
export function procedureCharge(a, proc, user) {
  if (proc.status !== 'done' || proc.chargePosted) return;
  return Product.findById(proc.service).lean().then((p) => {
    if (!p || !p.sellPrice) return;
    a.charges.push({ kind: 'procedure', description: `${p.name}${proc.endedAt ? ` (${new Date(proc.endedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })})` : ''}`, product: p._id, qty: 1, rate: p.sellPrice, gstRate: 0, amount: p.sellPrice, by: user._id });
    proc.chargePosted = true;
  });
}

// ---------------------------------------------------------------- discharge
export async function saveSummary(id, summary, user) {
  const a = await activeAdmission(id);
  a.discharge = { ...(a.discharge?.toObject?.() || {}), ...summary, preparedBy: user._id, at: new Date() };
  if (a.status === 'admitted') a.status = 'discharge_initiated';
  await a.save();
  return a;
}

export async function finalizeDischarge(id, { payments = [], useAdvance = true, discountPct = 0, notes, dischargedAt, insurerShare }, user) {
  const claim = await Admission.findOneAndUpdate({ _id: id, status: { $in: ['admitted', 'discharge_initiated'] }, invoice: null, finalizing: { $ne: true } }, { $set: { finalizing: true } }, { new: true });
  if (!claim) throw ApiError.conflict('Already discharged or being discharged');
  try {
    setGraceHours((await getSettings()).ipd?.graceHours);
    const at = dischargedAt ? new Date(dischargedAt) : new Date();
    const last = claim.bedHistory[claim.bedHistory.length - 1];
    if (last && !last.to) last.to = at;
    claim.dischargedAt = at;
    const bill = runningBill(claim, at);
    const items = bill.lines.filter((l) => l.amount > 0).map((l) => ({ description: l.description.slice(0, 200), qty: l.qty, rate: l.rate, gstRate: l.gstRate || 0, discountPct: ['pharmacy', 'consumable'].includes(l.kind) ? 0 : discountPct || 0 }));
    let inv = null;
    if (items.length) {
      const payerNote = claim.payer?.type && claim.payer.type !== 'self' ? ` · ${claim.payer.type}: ${[claim.payer.insurer, claim.payer.tpa, claim.payer.policyNo && `Policy ${claim.payer.policyNo}`, claim.payer.preAuthNo && `Pre-auth ${claim.payer.preAuthNo}`].filter(Boolean).join(', ')}` : '';
      inv = await createInvoice({
        branch: claim.branch, patient: claim.patient, doctor: claim.doctor, admission: claim._id, type: 'ipd', items, payments, useAdvance,
        source: 'billing', notes: `IPD ${claim.admissionNo} · ${bill.days} day(s)${payerNote}${notes ? ` · ${notes}` : ''}`.slice(0, 500),
      }, user);
    }
    claim.status = 'discharged';
    claim.invoice = inv?._id;
    if (inv && claim.payer?.type && claim.payer.type !== 'self') {
      const { upsertClaimForDischarge } = await import('./ipd.claims.js');
      await upsertClaimForDischarge(claim, inv, insurerShare, user).catch(() => {});
    }
    claim.finalizing = undefined;
    await claim.save();
    await Bed.updateOne({ _id: claim.bed, currentAdmission: claim._id }, { $set: { status: 'cleaning', currentAdmission: null } });
    if (claim.discharge?.followUpDate) {
      await FollowUp.create({ patient: claim.patient, branch: claim.branch, doctor: claim.doctor, dueDate: claim.discharge.followUpDate, reason: claim.discharge.followUpNote || `Post-discharge review (${claim.admissionNo})`, createdBy: user._id }).catch(() => {});
    }
    notify.enqueue('ipd.discharged', { admissionId: String(claim._id) });
    return { admission: claim, invoice: inv };
  } catch (e) {
    await Admission.updateOne({ _id: id }, { $unset: { finalizing: 1 } });
    throw e;
  }
}

export async function cancelAdmission(id, reason, user) {
  const a = await activeAdmission(id);
  if (a.charges.length) throw ApiError.badRequest('Remove posted charges first (pharmacy items are restocked on removal)');
  a.status = 'cancelled';
  a.cancelReason = reason;
  a.dischargedAt = new Date();
  const last = a.bedHistory[a.bedHistory.length - 1];
  if (last && !last.to) last.to = new Date();
  a.notes.push({ type: 'progress', text: `Admission cancelled: ${reason}`, by: user._id });
  await a.save();
  await Bed.updateOne({ _id: a.bed, currentAdmission: a._id }, { $set: { status: 'available', currentAdmission: null } });
  return a;
}

export async function billSummary(a) {
  setGraceHours((await getSettings()).ipd?.graceHours);
  const bill = runningBill(a);
  const advance = await advanceBalance(a.patient?._id || a.patient);
  return { ...bill, advance, approved: a.payer?.approvedAmount || 0, estimate: a.estimate || 0, due: r2(Math.max(0, bill.total - advance)) };
}

/** same OT, overlapping time, any active admission in the branch → 409 */
export async function otConflict(a, { scheduledAt, ot, durationMin = 60 }, selfId) {
  if (!scheduledAt || !ot) return;
  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + (durationMin || 60) * 60_000);
  const others = await Admission.find({ branch: a.branch, status: { $in: ['admitted', 'discharge_initiated'] }, procedures: { $elemMatch: { ot, status: { $in: ['scheduled', 'in_progress'] }, scheduledAt: { $gte: new Date(start.getTime() - 12 * 3_600_000), $lt: end } } } }).select('admissionNo procedures').lean();
  for (const o of others) {
    for (const p of o.procedures) {
      if (String(p._id) === String(selfId) || p.ot !== ot || !['scheduled', 'in_progress'].includes(p.status) || !p.scheduledAt) continue;
      const ps = new Date(p.scheduledAt);
      const pe = new Date(ps.getTime() + (p.durationMin || 60) * 60_000);
      if (ps < end && pe > start) throw ApiError.conflict(`${ot} is booked ${ps.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}–${pe.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} for ${p.name} (${o.admissionNo})`);
    }
  }
}
