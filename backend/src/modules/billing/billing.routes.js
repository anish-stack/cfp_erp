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
import * as promo from './promo.service.js';
import { Coupon, LoyaltyTxn } from '../../models/Loyalty.js';
import { r2 } from '../../utils/invoiceMath.js';
import { getSettings } from '../../models/Settings.js';
import { qrTarget, qrDataUrl } from '../../services/branding.js';
import { env } from '../../config/env.js';
import * as paySvc from '../payments/payments.service.js';
import { razorpayConfigured as rzpConfigured } from '../../services/razorpay.js';
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
    couponCode: z.string().trim().max(30).optional().or(z.literal('')).transform((v) => v || undefined),
    redeemPoints: z.number().int().min(0).max(1_000_000).optional(),
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

/** live price preview for POS / billing (coupon + points + GST exactly as the invoice will be) */
r.post('/quote', permit.any('billing.create', 'pos.create'), validate({ body: createBody }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.branch);
  const q = await svc.priceInvoice(req.body);
  const { balance, expiringSoon } = q.mobile && q.loyaltyCfg.enabled ? await promo.loyaltyBalance(q.mobile) : { balance: 0, expiringSoon: 0 };
  const afterCoupon = q.lines.reduce((a, l) => a + (l.gross - l.discountAmt), 0) + q.redeemValue; // net before points
  ok(res, {
    ...q.totals,
    coupon: q.couponQ ? { code: q.couponQ.coupon.code, discount: q.couponQ.discount, description: q.couponQ.coupon.description } : null,
    loyalty: { enabled: !!q.loyaltyCfg.enabled, mobile: q.mobile, balance, expiringSoon, pointValue: q.loyaltyCfg.pointValue || 1, minRedeem: q.loyaltyCfg.minRedeem || 0,
      maxRedeemable: promo.maxRedeemable(q.loyaltyCfg, balance, afterCoupon), redeemed: q.redeemPts, redeemValue: q.redeemValue, willEarn: q.earnPts },
  });
}));

/* ---------------------------------------------------------------- coupons */
const couponBody = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,30}$/, '3–30 letters, digits, - or _').transform((v) => v.toUpperCase()),
  description: z.string().max(200).optional(), type: z.enum(['percent', 'flat']), value: z.number().positive().max(1_000_000),
  maxDiscount: z.number().min(0).nullable().optional(), minBill: z.number().min(0).default(0), appliesTo: z.enum(['all', 'products', 'services']).default('all'),
  branches: z.array(objectId).max(50).default([]), validFrom: z.coerce.date().nullable().optional(), validTo: z.coerce.date().nullable().optional(),
  usageLimit: z.number().int().min(0).nullable().optional(), perCustomer: z.number().int().min(0).max(100).default(1), isActive: z.boolean().default(true),
}).refine((d) => d.type !== 'percent' || d.value <= 100, { message: 'Percent must be ≤ 100', path: ['value'] });

r.get('/coupons', permit.any('pos.view', 'billing.view'), asyncHandler(async (_req, res) => {
  ok(res, await Coupon.find().populate('branches', 'name code').sort({ createdAt: -1 }).lean());
}));
r.post('/coupons', permit.any('pos.edit', 'billing.edit'), validate({ body: couponBody }), asyncHandler(async (req, res) => {
  if (await Coupon.exists({ code: req.body.code })) throw ApiError.conflict('Coupon code already exists');
  const c = await Coupon.create({ ...req.body, createdBy: req.user._id });
  audit(req, { action: 'coupon.create', entity: 'Coupon', entityId: c._id, after: { code: c.code } });
  ok(res, c, 201);
}));
r.patch('/coupons/:id', permit.any('pos.edit', 'billing.edit'), validate({ params: idParam, body: couponBody.innerType().partial() }), asyncHandler(async (req, res) => {
  const c = await Coupon.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  if (!c) throw ApiError.notFound('Coupon not found');
  audit(req, { action: 'coupon.update', entity: 'Coupon', entityId: c._id });
  ok(res, c);
}));
r.delete('/coupons/:id', permit.any('pos.delete', 'billing.delete'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const c = await Coupon.findById(req.params.id);
  if (!c) throw ApiError.notFound('Coupon not found');
  if (c.used > 0) { c.isActive = false; await c.save(); return ok(res, { deactivated: true }); }
  await c.deleteOne();
  ok(res, { deleted: true });
}));

/* ---------------------------------------------------------------- loyalty */
r.get('/loyalty/:mobile', permit.any('pos.view', 'billing.view'), asyncHandler(async (req, res) => {
  const mobile = promo.mobileKey(req.params.mobile);
  if (!mobile) throw ApiError.badRequest('Invalid mobile');
  const cfg = await promo.loyaltyCfg();
  const [{ balance, expiringSoon }, history] = await Promise.all([promo.loyaltyBalance(mobile), LoyaltyTxn.find({ mobile }).populate('branch', 'code').populate('by', 'name').sort({ createdAt: -1 }).limit(50).lean()]);
  ok(res, { mobile, enabled: !!cfg.enabled, balance, expiringSoon, value: r2(balance * (cfg.pointValue || 1)), pointValue: cfg.pointValue || 1, history });
}));
r.post('/loyalty/:mobile/adjust', permit('billing.approve'), validate({ body: z.object({ points: z.number().int().refine((v) => v !== 0, 'Points cannot be 0'), note: z.string().trim().min(3).max(200) }) }), asyncHandler(async (req, res) => {
  const mobile = promo.mobileKey(req.params.mobile);
  if (!mobile) throw ApiError.badRequest('Invalid mobile');
  if (req.body.points < 0 && (await promo.loyaltyBalance(mobile)).balance < -req.body.points) throw ApiError.badRequest('Not enough points');
  const cfg = await promo.loyaltyCfg();
  const t = await LoyaltyTxn.create({ mobile, type: 'adjust', points: req.body.points, note: req.body.note, by: req.user._id, expiresAt: req.body.points > 0 && cfg.expiryDays > 0 ? new Date(Date.now() + cfg.expiryDays * 864e5) : undefined });
  audit(req, { action: 'loyalty.adjust', entity: 'LoyaltyTxn', entityId: t._id, after: { mobile, points: req.body.points } });
  ok(res, t, 201);
}));

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

/** everything a 58/80 mm thermal receipt needs (printed by the browser on the counter printer) */
r.get('/invoices/:id/thermal', permit.any('billing.view', 'pos.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const inv = await loadInvoice(req);
  await inv.populate([{ path: 'patient', select: 'name patientId mobile' }, { path: 'branch', select: 'name code address phone gstin' }, { path: 'doctor', select: 'name' }, { path: 'createdBy', select: 'name' }]);
  const [s, payments] = await Promise.all([getSettings(), Payment.find({ invoice: inv._id }).sort({ createdAt: 1 }).select('receiptNo kind mode amount reference createdAt').lean()]);
  // QR: balance due → scan-to-pay (Razorpay link, else static UPI); paid → website (Settings → Payments)
  const mode = s.print?.thermalQr || 'payment';
  let qr = null;
  const due = inv.balance > 0.009 && !['cancelled', 'refunded'].includes(inv.status);
  if (mode === 'payment' && due) {
    const amt = Number(inv.balance).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    try {
      if (s.payments?.onlineEnabled && rzpConfigured()) {
        const link = await paySvc.linkForInvoice(inv, req.user);
        if (link?.shortUrl) qr = { kind: 'payment', url: link.shortUrl, image: await qrDataUrl(link.shortUrl), label: `Scan to pay Rs ${amt}`, sub: 'UPI · card · net banking' };
      }
    } catch (e) {
      // Razorpay down / not allowed → fall back to UPI QR below
      qr = null;
    }
    if (!qr && s.payments?.upiId) {
      const upi = `upi://pay?pa=${encodeURIComponent(s.payments.upiId)}&pn=${encodeURIComponent(s.payments.upiName || s.clinic?.name || '')}&am=${Number(inv.balance).toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.invoiceNo)}`;
      qr = { kind: 'payment', url: upi, image: await qrDataUrl(upi), label: `Scan with any UPI app to pay Rs ${amt}`, sub: s.payments.upiId };
    }
  }
  if (!qr && mode !== 'none') {
    const qrUrl = qrTarget(s);
    if (qrUrl) qr = { kind: 'website', url: qrUrl, image: await qrDataUrl(qrUrl), label: 'Scan to visit our website', sub: qrUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') };
  }
  const loyaltyBalance = inv.loyalty?.mobile && s.loyalty?.enabled ? (await promo.loyaltyBalance(inv.loyalty.mobile)).balance : null;
  ok(res, {
    invoice: inv.toObject(), payments, loyaltyBalance,
    clinic: { name: s.clinic?.name, phone: s.clinic?.phone, gstin: s.clinic?.gstin, website: s.clinic?.website, logo: s.clinic?.logoFile ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/public/logo` : null },
    print: { width: s.print?.thermalWidth || '80', footer: s.print?.thermalFooter || s.billing?.invoiceFooter || '' },
    qr,
  });
}));

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
