import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit, hasPerm } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, parsePaging, escapeRegex } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId, ymd, paging } from '../../utils/zod.js';
import { istDayRange, addDays } from '../../utils/time.js';
import { Invoice, Payment, CreditNote } from '../../models/Billing.js';
import { Patient } from '../../models/Patient.js';
import { loadDocument, streamDocument } from '../../services/documents.js';
import * as svc from './billing.service.js';
import * as notify from '../../services/notify.js';

const r = Router();
r.use(auth, branchScope);
const idParam = z.object({ id: objectId });
const mode = z.enum(['cash', 'upi', 'card', 'bank']);
const amount = z.number().positive().max(10_000_000);

const createBody = z
  .object({
    branch: objectId,
    patient: objectId.optional(),
    customer: z.object({ name: z.string().max(80).optional(), phone: z.string().max(15).optional() }).optional(),
    appointment: objectId.optional(),
    doctor: objectId.optional(),
    type: z.enum(['consultation', 'treatment', 'procedure', 'pharmacy', 'mixed']).optional(),
    items: z
      .array(
        z.object({
          product: objectId.optional(),
          description: z.string().max(200).optional(),
          qty: z.number().positive().max(10000),
          rate: z.number().min(0).optional(),
          discountPct: z.number().min(0).max(100).default(0),
          gstRate: z.number().min(0).max(28).optional(),
        })
      )
      .min(1)
      .max(100),
    payments: z.array(z.object({ mode, amount, reference: z.string().max(60).optional() })).max(5).default([]),
    useAdvance: z.boolean().default(false),
    notes: z.string().max(500).optional(),
  })
  .refine((d) => d.items.every((i) => i.product || i.description), 'Each line needs product or description');

const createInvoice = (source) =>
  asyncHandler(async (req, res) => {
    req.assertBranch(req.body.branch);
    // rate/discount overrides need edit permission
    if (!hasPerm(req, 'billing.approve') && req.body.items.some((i) => i.discountPct > 20)) {
      throw ApiError.forbidden('Discount above 20% requires approval permission');
    }
    const inv = await svc.createInvoice({ ...req.body, source }, req.user);
    audit(req, { action: `${source === 'pos' ? 'pos' : 'billing'}.create`, entity: 'Invoice', entityId: inv._id, branch: inv.branch, after: { invoiceNo: inv.invoiceNo, grandTotal: inv.grandTotal } });
    ok(res, inv, 201);
  });

r.post('/invoices', permit('billing.create'), validate({ body: createBody }), createInvoice('billing'));
r.post('/pos/checkout', permit('pos.create'), validate({ body: createBody }), createInvoice('pos'));

const listQuery = paging.extend({ status: z.string().optional(), type: z.string().optional(), source: z.string().optional(), from: ymd.optional(), to: ymd.optional(), patient: objectId.optional() });

r.get('/invoices', permit.any('billing.view', 'pos.view'), validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const q = req.query;
  const f = { ...req.branchFilter('branch') };
  if (q.status) f.status = { $in: q.status.split(',') };
  if (q.type) f.type = { $in: q.type.split(',') };
  if (q.source) f.source = q.source;
  if (!hasPerm(req, 'billing.view')) f.source = 'pos';
  if (q.patient) f.patient = q.patient;
  if (q.from || q.to) f.createdAt = { ...(q.from ? { $gte: istDayRange(q.from).$gte } : {}), ...(q.to ? { $lt: istDayRange(q.to).$lt } : {}) };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const pats = await Patient.find({ $or: [{ name: rx }, { mobile: rx }, { patientId: rx }] }).select('_id').limit(200).lean();
    f.$or = [{ invoiceNo: rx }, { patient: { $in: pats.map((p) => p._id) } }, { 'customer.phone': rx }, { 'customer.name': rx }];
  }
  const { page, limit, skip } = parsePaging(q);
  const [items, total, sums] = await Promise.all([
    Invoice.find(f).select('-items.allocations').populate('patient', 'name patientId mobile').populate('branch', 'code').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Invoice.countDocuments(f),
    Invoice.aggregate([{ $match: { ...f, status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$grandTotal' }, paid: { $sum: '$paid' }, balance: { $sum: '$balance' }, refunded: { $sum: '$refunded' } } }]),
  ]);
  res.json({ success: true, data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) || 1, sums: sums[0] || { total: 0, paid: 0, balance: 0, refunded: 0 } } });
}));

async function loadInvoice(req) {
  const inv = await Invoice.findById(req.params.id);
  if (!inv) throw ApiError.notFound('Invoice not found');
  req.assertBranch(inv.branch);
  return inv;
}

r.get('/invoices/:id', permit.any('billing.view', 'pos.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  await inv.populate([
    { path: 'patient', select: 'name patientId mobile gender dob ageYears' },
    { path: 'branch', select: 'name code address phone gstin' },
    { path: 'doctor', select: 'name' },
    { path: 'createdBy', select: 'name' },
  ]);
  const [payments, creditNotes] = await Promise.all([
    Payment.find({ invoice: inv._id }).populate('by', 'name').sort({ createdAt: 1 }).lean(),
    CreditNote.find({ invoice: inv._id }).populate('by', 'name').lean(),
  ]);
  ok(res, { invoice: inv, payments, creditNotes });
}));

r.get('/invoices/:id/pdf', permit.any('billing.view', 'pos.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  return streamDocument(res, 'invoice', inv._id, { download: req.query.download === '1' });
}));

r.get('/payments/:id/receipt', permit.any('billing.view', 'pos.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const loaded = await loadDocument('receipt', req.params.id);
  req.assertBranch(loaded.branch);
  return streamDocument(res, 'receipt', loaded, { download: req.query.download === '1' });
}));

r.post('/invoices/:id/payments', permit.any('billing.create', 'pos.create'), validate({ params: idParam, body: z.object({ mode: mode.optional(), amount: amount.optional(), reference: z.string().max(60).optional(), notes: z.string().max(200).optional(), useAdvance: z.boolean().default(false) }).refine((d) => d.useAdvance || (d.mode && d.amount), 'mode and amount required') }), asyncHandler(async (req, res) => {
  await loadInvoice(req);
  const out = await svc.addPayment(req.params.id, req.body, req.user);
  audit(req, { action: 'billing.payment', entity: 'Invoice', entityId: out.invoice._id, branch: out.invoice.branch, after: { amount: out.payment.amount, mode: out.payment.mode } });
  ok(res, out, 201);
}));

r.post('/invoices/:id/return', permit('billing.approve'), validate({ params: idParam, body: z.object({ lines: z.array(z.object({ lineId: objectId, qty: z.number().positive() })).min(1), refundMode: mode.default('cash'), reason: z.string().min(3).max(300), restock: z.boolean().default(true) }) }), asyncHandler(async (req, res) => {
  await loadInvoice(req);
  const out = await svc.returnItems(req.params.id, req.body, req.user);
  audit(req, { action: 'billing.return', entity: 'Invoice', entityId: out.invoice._id, branch: out.invoice.branch, after: { creditNote: out.creditNote.creditNoteNo, refunded: out.refunded } });
  ok(res, out, 201);
}));

r.post('/invoices/:id/cancel', permit('billing.delete'), validate({ params: idParam, body: z.object({ reason: z.string().min(3).max(300) }) }), asyncHandler(async (req, res) => {
  await loadInvoice(req);
  const inv = await svc.cancelInvoice(req.params.id, req.body.reason, req.user);
  audit(req, { action: 'billing.cancel', entity: 'Invoice', entityId: inv._id, branch: inv.branch, after: { reason: req.body.reason } });
  ok(res, inv);
}));

r.post('/invoices/:id/send', permit.any('billing.view', 'pos.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  if (inv.status === 'cancelled') throw ApiError.badRequest('Invoice is cancelled');
  if (!inv.patient && !/^\d{10}$/.test(String(inv.customer?.phone || '').replace(/\D/g, '').slice(-10))) throw ApiError.badRequest('No mobile number on this invoice');
  await notify.enqueueStrict('invoice.send', { invoiceId: String(inv._id), force: true });
  audit(req, { action: 'billing.export', entity: 'Invoice', entityId: inv._id, branch: inv.branch, meta: { channel: 'whatsapp' } });
  ok(res, { queued: true });
}));

// ---------- advances ----------
r.get('/advances/:patient', permit('billing.view'), validate({ params: z.object({ patient: objectId }) }), asyncHandler(async (req, res) => {
  const [balance, history] = await Promise.all([
    svc.advanceBalance(req.params.patient),
    Payment.find({ patient: req.params.patient, kind: { $in: ['advance', 'advance_adjust', 'refund'] } }).populate('invoice', 'invoiceNo').populate('branch', 'code').sort({ createdAt: -1 }).limit(100).lean(),
  ]);
  ok(res, { balance, history });
}));

r.post('/advances', permit('billing.create'), validate({ body: z.object({ branch: objectId, patient: objectId, mode, amount, reference: z.string().max(60).optional(), notes: z.string().max(200).optional() }) }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.branch);
  const p = await svc.addAdvance(req.body, req.user);
  audit(req, { action: 'billing.advance', entity: 'Payment', entityId: p._id, branch: p.branch, after: p });
  ok(res, p, 201);
}));

r.post('/advances/refund', permit('billing.approve'), validate({ body: z.object({ branch: objectId, patient: objectId, mode, amount, notes: z.string().max(200).optional() }) }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.branch);
  const p = await svc.refundAdvance(req.body, req.user);
  audit(req, { action: 'billing.advance_refund', entity: 'Payment', entityId: p._id, branch: p.branch, after: p });
  ok(res, p, 201);
}));

// ---------- payments ledger ----------
r.get('/payments', permit('billing.view'), validate({ query: paging.extend({ from: ymd.optional(), to: ymd.optional(), mode: z.string().optional(), kind: z.string().optional() }) }), asyncHandler(async (req, res) => {
  const q = req.query;
  const f = { ...req.branchFilter('branch') };
  if (q.mode) f.mode = { $in: q.mode.split(',') };
  if (q.kind) f.kind = { $in: q.kind.split(',') };
  const from = q.from || addDays(new Date().toISOString().slice(0, 10), -30);
  f.createdAt = { $gte: istDayRange(from).$gte, ...(q.to ? { $lt: istDayRange(q.to).$lt } : {}) };
  const { page, limit, skip } = parsePaging(q);
  const [items, total, byMode] = await Promise.all([
    Payment.find(f).populate('patient', 'name patientId').populate('invoice', 'invoiceNo').populate('by', 'name').populate('branch', 'code').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Payment.countDocuments(f),
    Payment.aggregate([{ $match: f }, { $group: { _id: { kind: '$kind', mode: '$mode' }, amount: { $sum: '$amount' }, n: { $sum: 1 } } }]),
  ]);
  res.json({ success: true, data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) || 1, byMode } });
}));

export default r;
