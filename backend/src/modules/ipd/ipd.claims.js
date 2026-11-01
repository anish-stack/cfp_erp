import { Router } from 'express';
import { z } from 'zod';
import { permit } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, paged, parsePaging, escapeRegex } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId } from '../../utils/zod.js';
import { nextDocNo } from '../../utils/counter.js';
import { Admission, InsuranceClaim, CLAIM_STATUS } from '../../models/Ipd.js';
import { Branch } from '../../models/Branch.js';
import { Invoice } from '../../models/Billing.js';
import { Patient } from '../../models/Patient.js';
import { addPayment } from '../billing/billing.service.js';
import { r2 } from '../../utils/invoiceMath.js';

/**
 * Insurance / TPA / corporate claims for IPD.
 * Flow: pre-auth pending → approved → (discharge) ready to submit → submitted → query ↔ submitted → approved → settled (or rejected).
 * Settlement posts an "insurance" payment on the IPD invoice; whatever the insurer disallows stays due from the patient.
 */
const fromAdmissionStatus = (a) => ({ pending: 'pre_auth_pending', approved: 'pre_auth_approved', partial: 'pre_auth_approved', rejected: 'pre_auth_rejected' })[a.payer?.preAuthStatus] || 'pre_auth_pending';

export async function createClaim(a, user, extra = {}) {
  if (!a.payer?.type || a.payer.type === 'self') throw ApiError.badRequest('Set the payer to insurance / corporate / government first');
  if (a.claim) throw ApiError.conflict('A claim already exists for this admission');
  const branch = await Branch.findById(a.branch).select('code').lean();
  const c = await InsuranceClaim.create({
    claimRef: await nextDocNo('CLM', branch.code),
    branch: a.branch, admission: a._id, patient: a.patient, invoice: a.invoice, payerType: a.payer.type,
    insurer: a.payer.insurer, tpa: a.payer.tpa, policyNo: a.payer.policyNo, cardNo: a.payer.cardNo, preAuthNo: a.payer.preAuthNo,
    estimate: a.estimate, preAuthAmount: a.payer.approvedAmount, approvedAmount: a.payer.approvedAmount,
    status: extra.status || fromAdmissionStatus(a), claimedAmount: extra.claimedAmount,
    timeline: [{ status: extra.status || fromAdmissionStatus(a), note: extra.note || 'Claim opened', by: user._id }],
    createdBy: user._id,
  });
  await Admission.updateOne({ _id: a._id }, { $set: { claim: c._id } });
  return c;
}

/** at discharge: link invoice, set claimed amount, move to "ready to submit" */
export async function upsertClaimForDischarge(a, inv, insurerShare, user) {
  const claimed = r2(Number(insurerShare) > 0 ? Math.min(insurerShare, inv.grandTotal) : Math.min(a.payer?.approvedAmount || inv.balance, inv.balance));
  let c = a.claim ? await InsuranceClaim.findById(a.claim) : null;
  if (!c) c = await createClaim(a, user, { status: 'ready_to_submit', claimedAmount: claimed, note: `Discharged — bill ${inv.invoiceNo}` });
  c.invoice = inv._id;
  c.claimedAmount = claimed;
  if (['pre_auth_pending', 'pre_auth_approved'].includes(c.status)) {
    c.status = 'ready_to_submit';
    c.timeline.push({ status: 'ready_to_submit', note: `Discharged — bill ${inv.invoiceNo}`, amount: claimed, by: user._id });
  }
  await c.save();
  return c;
}

const r = Router();
// auth + branchScope are applied once where the IPD routers are mounted (app.js)
const idParam = z.object({ id: objectId });

r.get('/claims', permit('ipd.view'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const f = { ...req.branchFilter('branch') };
  if (req.query.status === 'open') f.status = { $nin: ['settled', 'rejected', 'closed'] };
  else if (req.query.status) f.status = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
    const pids = await Patient.find({ $or: [{ name: rx }, { mobile: rx }, { patientId: rx }] }).distinct('_id');
    f.$or = [{ claimRef: rx }, { claimNo: rx }, { insurer: rx }, { tpa: rx }, { policyNo: rx }, { patient: { $in: pids } }];
  }
  const [items, total, summary] = await Promise.all([
    InsuranceClaim.find(f).populate('patient', 'name patientId mobile').populate('admission', 'admissionNo admittedAt dischargedAt').populate('invoice', 'invoiceNo grandTotal balance').populate('branch', 'name').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    InsuranceClaim.countDocuments(f),
    InsuranceClaim.aggregate([{ $match: req.branchFilter('branch') }, { $group: { _id: '$status', n: { $sum: 1 }, claimed: { $sum: { $ifNull: ['$claimedAmount', 0] } }, settled: { $sum: { $ifNull: ['$settledAmount', 0] } } } }]),
  ]);
  res.json({ success: true, data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) || 1, summary } });
}));

r.get('/claims/:id', permit('ipd.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const c = await InsuranceClaim.findById(req.params.id).populate('patient', 'name patientId mobile').populate('admission', 'admissionNo admittedAt dischargedAt documents provisionalDiagnosis').populate('invoice', 'invoiceNo grandTotal paid balance').populate('timeline.by', 'name').lean();
  if (!c) throw ApiError.notFound('Claim not found');
  if (!req.canAccessBranch(c.branch)) throw ApiError.forbidden();
  ok(res, c);
}));

r.post('/admissions/:id/claim', permit('ipd.edit'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const a = await Admission.findById(req.params.id);
  if (!a) throw ApiError.notFound('Admission not found');
  req.assertBranch(a.branch);
  const c = await createClaim(a, req.user);
  audit(req, { action: 'ipd.claim_create', entity: 'InsuranceClaim', entityId: c._id, branch: c.branch });
  ok(res, c, 201);
}));

r.patch('/claims/:id', permit('ipd.edit'), validate({ params: idParam, body: z.object({
  status: z.enum(CLAIM_STATUS).optional(), note: z.string().max(500).optional(),
  insurer: z.string().max(80).optional(), tpa: z.string().max(80).optional(), policyNo: z.string().max(60).optional(), cardNo: z.string().max(60).optional(), preAuthNo: z.string().max(60).optional(), claimNo: z.string().max(60).optional(),
  preAuthAmount: z.number().min(0).optional(), approvedAmount: z.number().min(0).optional(), claimedAmount: z.number().min(0).optional(), followUpOn: z.coerce.date().nullable().optional(), notes: z.string().max(1000).optional(),
}) }), asyncHandler(async (req, res) => {
  const c = await InsuranceClaim.findById(req.params.id);
  if (!c) throw ApiError.notFound('Claim not found');
  req.assertBranch(c.branch);
  if (c.status === 'settled' && req.body.status && req.body.status !== 'closed') throw ApiError.badRequest('Claim is settled');
  const { status, note, ...rest } = req.body;
  Object.assign(c, rest);
  if (status && status !== c.status) {
    c.status = status;
    if (status === 'submitted' && !c.submittedAt) c.submittedAt = new Date();
    c.timeline.push({ status, note, amount: rest.approvedAmount ?? rest.claimedAmount, by: req.user._id });
  } else if (note) c.timeline.push({ status: c.status, note, by: req.user._id });
  // keep the admission's payer card in sync for pre-auth
  if (rest.approvedAmount !== undefined || rest.preAuthNo || ['pre_auth_approved', 'pre_auth_rejected'].includes(status)) {
    const set = {};
    if (rest.approvedAmount !== undefined) set['payer.approvedAmount'] = rest.approvedAmount;
    if (rest.preAuthNo) set['payer.preAuthNo'] = rest.preAuthNo;
    if (status === 'pre_auth_approved') set['payer.preAuthStatus'] = 'approved';
    if (status === 'pre_auth_rejected') set['payer.preAuthStatus'] = 'rejected';
    await Admission.updateOne({ _id: c.admission }, { $set: set });
  }
  await c.save();
  audit(req, { action: 'ipd.claim_update', entity: 'InsuranceClaim', entityId: c._id, branch: c.branch, after: req.body });
  ok(res, c);
}));

/** insurer paid: post payment on the IPD bill; remainder (disallowed) stays due from the patient */
r.post('/claims/:id/settle', permit('ipd.edit'), validate({ params: idParam, body: z.object({ settledAmount: z.number().min(0), tds: z.number().min(0).default(0), deduction: z.number().min(0).default(0), deductionReason: z.string().max(300).optional(), reference: z.string().max(60).optional(), settledAt: z.coerce.date().optional() }) }), asyncHandler(async (req, res) => {
  const c = await InsuranceClaim.findById(req.params.id);
  if (!c) throw ApiError.notFound('Claim not found');
  req.assertBranch(c.branch);
  if (c.status === 'settled') throw ApiError.conflict('Already settled');
  if (!c.invoice) throw ApiError.badRequest('Discharge the patient first (no IPD bill yet)');
  const inv = await Invoice.findById(c.invoice).lean();
  const credit = r2(req.body.settledAmount + req.body.tds); // TDS is deducted at source but counts against the bill
  if (credit > 0) {
    const amt = Math.min(credit, inv.balance);
    if (amt > 0) await addPayment(inv._id, { mode: 'insurance', amount: amt, reference: req.body.reference || c.claimNo || c.claimRef, notes: `${c.insurer || c.tpa || 'Insurer'} settlement${req.body.tds ? ` (incl. TDS ${req.body.tds})` : ''}` }, req.user);
  }
  Object.assign(c, { settledAmount: req.body.settledAmount, tds: req.body.tds, deduction: req.body.deduction, deductionReason: req.body.deductionReason, settlementRef: req.body.reference, settledAt: req.body.settledAt || new Date(), status: 'settled' });
  c.timeline.push({ status: 'settled', note: `Settled ₹${req.body.settledAmount}${req.body.tds ? ` + TDS ₹${req.body.tds}` : ''}${req.body.deduction ? `, deduction ₹${req.body.deduction} (${req.body.deductionReason || 'disallowed'})` : ''}`, amount: req.body.settledAmount, by: req.user._id });
  await c.save();
  audit(req, { action: 'ipd.claim_settle', entity: 'InsuranceClaim', entityId: c._id, branch: c.branch, after: req.body });
  ok(res, { claim: c, invoice: await Invoice.findById(c.invoice).select('invoiceNo grandTotal paid balance status').lean() });
}));

export default r;
