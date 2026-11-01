import mongoose from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { Invoice, Payment, CreditNote } from '../../models/Billing.js';
import { Product, STOCK_TYPES } from '../../models/Inventory.js';
import { Branch } from '../../models/Branch.js';
import { Patient } from '../../models/Patient.js';
import { Appointment } from '../../models/Appointment.js';
import { getSettings } from '../../models/Settings.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextDocNo } from '../../utils/counter.js';
import { computeLine, computeTotals, statusFor, r2 } from '../../utils/invoiceMath.js';
import * as stock from '../inventory/stock.service.js';
import * as notify from '../../services/notify.js';
import { Coupon, LoyaltyTxn } from '../../models/Loyalty.js';
import * as promo from './promo.service.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

export async function advanceBalance(patientId, session) {
  const rows = await Payment.aggregate([
    { $match: { patient: oid(patientId), kind: { $in: ['advance', 'advance_adjust', 'refund'] } } },
    { $group: { _id: { kind: '$kind', inv: { $cond: [{ $ifNull: ['$invoice', false] }, 1, 0] } }, sum: { $sum: '$amount' } } },
  ]).session(session || null);
  let bal = 0;
  for (const r of rows) {
    if (r._id.kind === 'advance') bal += r.sum;
    if (r._id.kind === 'advance_adjust') bal -= r.sum;
    if (r._id.kind === 'refund' && r._id.inv === 0) bal -= r.sum; // advance refunds have no invoice
  }
  return r2(bal);
}

function inferType(lines, products) {
  const kinds = new Set(
    lines.map((l) => {
      const p = l.product && products.get(String(l.product));
      if (!p) return 'custom';
      if (STOCK_TYPES.includes(p.type)) return 'pharmacy';
      return p.serviceKind || 'treatment';
    })
  );
  if (kinds.size === 1) {
    const k = [...kinds][0];
    if (['consultation', 'procedure', 'treatment', 'pharmacy'].includes(k)) return k;
  }
  return 'mixed';
}

/**
 * data: { branch, patient?, customer?, appointment?, doctor?, items[{ product?, description?, qty, rate?, discountPct, gstRate? }],
 *         payments[{ mode, amount, reference }], useAdvance, notes, source, type? }
 */
/** price a bill without saving it (POS live preview + createInvoice) */
export async function priceInvoice(data) {
  const settings = await getSettings();
  const taxInclusive = settings.billing?.taxInclusive !== false;
  const gstOn = settings.billing?.gstEnabled !== false;

  const branch = await Branch.findById(data.branch).select('code isActive').lean();
  if (!branch?.isActive) throw ApiError.badRequest('Invalid branch');
  if (data.patient && !(await Patient.exists({ _id: data.patient }))) throw ApiError.badRequest('Patient not found');

  const pids = data.items.filter((i) => i.product).map((i) => i.product);
  const products = new Map((await Product.find({ _id: { $in: pids } }).lean()).map((p) => [String(p._id), p]));

  const lines = data.items.map((i) => {
    const p = i.product ? products.get(String(i.product)) : null;
    if (i.product && !p) throw ApiError.badRequest('Unknown product');
    if (p && !p.isActive) throw ApiError.badRequest(`${p.name} is inactive`);
    const rate = i.rate ?? p?.sellPrice ?? 0;
    const gstRate = gstOn ? (i.gstRate ?? (p ? (p.type === 'service' ? settings.billing?.consultationGst ?? 0 : p.gstRate) : 0)) : 0;
    const kind = p ? (STOCK_TYPES.includes(p.type) ? 'product' : 'service') : 'custom';
    const calc = computeLine({ qty: i.qty, rate, discountPct: i.discountPct || 0, gstRate }, taxInclusive);
    return { kind, product: p?._id, description: i.description || p?.name, hsn: p?.hsn, qty: i.qty, rate, discountPct: i.discountPct || 0, gstRate, ...calc };
  });
  if (lines.some((l) => !l.description)) throw ApiError.badRequest('Description required for custom lines');

  // ---- bill-level discounts: coupon, then loyalty points — spread over the lines before GST
  const patientDoc = data.patient ? await Patient.findById(data.patient).select('mobile').lean() : null;
  const mobile = promo.mobileKey(patientDoc?.mobile || data.customer?.phone);
  const loyaltyCfg = settings.loyalty || {};
  let couponQ = null;
  let redeemPts = 0;
  let redeemValue = 0;
  if (data.couponCode || data.redeemPoints) {
    const netOf = (ls) => ls.map((l) => ({ kind: l.kind, net: r2(l.gross - l.discountAmt) }));
    const base = netOf(lines);
    const extra = new Array(lines.length).fill(0);
    if (data.couponCode) {
      couponQ = await promo.quoteCoupon(data.couponCode, { lines: base, mobile, branch: data.branch });
      promo.spread(couponQ.discount, base, couponQ.eligibleIdx).forEach((v, i) => { extra[i] += v; });
    }
    if (data.redeemPoints > 0) {
      if (!loyaltyCfg.enabled) throw ApiError.badRequest('Loyalty points are switched off');
      if (!mobile) throw ApiError.badRequest('Customer mobile number required to redeem points');
      const { balance } = await promo.loyaltyBalance(mobile);
      const after = base.map((l, i) => ({ ...l, net: r2(l.net - extra[i]) }));
      const net = after.reduce((a, l) => a + l.net, 0);
      const max = promo.maxRedeemable(loyaltyCfg, balance, net);
      if (balance < (loyaltyCfg.minRedeem || 0)) throw ApiError.badRequest(`Minimum ${loyaltyCfg.minRedeem} points needed to redeem (balance ${balance})`);
      redeemPts = Math.min(Math.floor(data.redeemPoints), max);
      redeemValue = r2(redeemPts * (loyaltyCfg.pointValue || 1));
      promo.spread(redeemValue, after, after.map((_, i) => i)).forEach((v, i) => { extra[i] += v; });
    }
    lines.forEach((l, i) => {
      if (!extra[i]) return;
      Object.assign(l, computeLine({ qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate, extraDiscount: extra[i] }, taxInclusive));
    });
  }
  const totals = computeTotals(lines);
  const earnBase = loyaltyCfg.earnOnServices === false ? lines.filter((l) => l.kind === 'product').reduce((a, l) => a + l.total, 0) : totals.grandTotal;
  const earnPts = mobile ? promo.pointsFor(loyaltyCfg, earnBase) : 0;
  return { settings, taxInclusive, branch, products, lines, totals, couponQ, redeemPts, redeemValue, earnPts, mobile, loyaltyCfg };
}

export async function createInvoice(data, user) {
  const { branch, products, lines, totals, couponQ, redeemPts, redeemValue, earnPts, mobile, loyaltyCfg, taxInclusive } = await priceInvoice(data);
  if (totals.grandTotal <= 0 && lines.length) {
    // allow zero-value invoices (free consultation) but no payments
    if ((data.payments || []).length) throw ApiError.badRequest('Nothing to pay on a zero invoice');
  }

  return withTransaction(async (session) => {
    const invoiceNo = await nextDocNo('INV', branch.code, session);
    const [inv] = await Invoice.create(
      [{
        invoiceNo,
        branch: data.branch,
        patient: data.patient,
        customer: data.customer,
        appointment: data.appointment,
        admission: data.admission,
        doctor: data.doctor,
        source: data.source || 'billing',
        type: data.type || inferType(lines, products),
        items: lines.map(({ gross, ...l }) => l),
        taxInclusive,
        ...totals,
        paid: 0,
        balance: totals.grandTotal,
        notes: data.notes,
        coupon: couponQ ? { code: couponQ.coupon.code, coupon: couponQ.coupon._id, discount: couponQ.discount } : undefined,
        loyalty: mobile ? { mobile, redeemed: redeemPts, redeemValue, earned: earnPts } : undefined,
        createdBy: user._id,
      }],
      { session }
    );

    // coupon usage (atomic — two tills can't over-use a limited coupon)
    if (couponQ) {
      const u = await Coupon.updateOne(
        { _id: couponQ.coupon._id, $or: [{ usageLimit: null }, { usageLimit: { $exists: false } }, { usageLimit: 0 }, { $expr: { $lt: ['$used', '$usageLimit'] } }] },
        { $inc: { used: 1 } },
        { session }
      );
      if (!u.modifiedCount) throw ApiError.badRequest('This coupon has been fully used');
    }
    // loyalty: redeem, then earn on this bill
    if (redeemPts > 0) {
      const { balance } = await promo.loyaltyBalance(mobile, session);
      if (balance < redeemPts) throw ApiError.badRequest('Not enough loyalty points');
      await LoyaltyTxn.create([{ mobile, patient: data.patient, type: 'redeem', points: -redeemPts, invoice: inv._id, invoiceNo, branch: inv.branch, by: user._id }], { session });
    }
    if (earnPts > 0) {
      const exp = loyaltyCfg.expiryDays > 0 ? new Date(Date.now() + loyaltyCfg.expiryDays * 864e5) : undefined;
      await LoyaltyTxn.create([{ mobile, patient: data.patient, type: 'earn', points: earnPts, expiresAt: exp, invoice: inv._id, invoiceNo, branch: inv.branch, by: user._id }], { session });
    }

    // stock out
    for (const line of inv.items) {
      if (line.kind !== 'product') continue;
      line.allocations = await stock.issueFEFO({ branch: inv.branch, product: line.product, qty: line.qty, type: 'sale', refType: 'Invoice', refId: inv._id, refNo: invoiceNo, by: user._id }, session);
    }

    let paid = 0;
    // apply advance
    if (data.useAdvance && data.patient) {
      const bal = await advanceBalance(data.patient, session);
      const use = r2(Math.min(bal, inv.grandTotal));
      if (use > 0) {
        await Payment.create([{ receiptNo: await nextDocNo('RCT', branch.code, session), branch: inv.branch, invoice: inv._id, patient: inv.patient, kind: 'advance_adjust', mode: 'advance', amount: use, by: user._id }], { session });
        paid += use;
      }
    }
    for (const p of data.payments || []) {
      if (paid + p.amount > inv.grandTotal + 0.009) throw ApiError.badRequest('Payment exceeds invoice total');
      await Payment.create([{ receiptNo: await nextDocNo('RCT', branch.code, session), branch: inv.branch, invoice: inv._id, patient: inv.patient, kind: 'payment', mode: p.mode, amount: p.amount, reference: p.reference, by: user._id }], { session });
      paid += p.amount;
    }
    inv.paid = r2(paid);
    inv.balance = r2(inv.grandTotal - paid);
    inv.status = statusFor(inv);
    await inv.save({ session });

    if (data.appointment) await Appointment.updateOne({ _id: data.appointment }, { invoice: inv._id }, { session });
    return inv;
  }).then((inv) => {
    notify.enqueue('invoice.created', { invoiceId: String(inv._id) }); // webhook + WhatsApp invoice PDF
    return inv;
  });
}

export async function addPayment(invoiceId, { mode, amount, reference, notes, useAdvance }, user) {
  return withTransaction(async (session) => {
    const inv = await Invoice.findById(invoiceId).session(session);
    if (!inv) throw ApiError.notFound('Invoice not found');
    if (['cancelled', 'refunded'].includes(inv.status)) throw ApiError.badRequest(`Invoice ${inv.status}`);
    const branch = await Branch.findById(inv.branch).select('code').lean();
    let amt = amount;
    let kind = 'payment';
    if (useAdvance) {
      if (!inv.patient) throw ApiError.badRequest('No patient on invoice');
      const bal = await advanceBalance(inv.patient, session);
      amt = r2(Math.min(bal, inv.balance, amount || Infinity));
      if (amt <= 0) throw ApiError.badRequest('No advance balance');
      kind = 'advance_adjust';
      mode = 'advance';
    }
    if (amt > inv.balance + 0.009) throw ApiError.badRequest(`Amount exceeds balance ₹${inv.balance}`);
    const [p] = await Payment.create([{ receiptNo: await nextDocNo('RCT', branch.code, session), branch: inv.branch, invoice: inv._id, patient: inv.patient, kind, mode, amount: amt, reference, notes, by: user._id }], { session });
    inv.paid = r2(inv.paid + amt);
    inv.balance = r2(inv.grandTotal - inv.paid);
    inv.status = statusFor(inv);
    await inv.save({ session });
    return { invoice: inv, payment: p };
  }).then((out) => {
    // insurer settlements are not receipted to the patient
    if (out.payment.mode !== 'insurance') notify.enqueue('payment.received', { invoiceId: String(out.invoice._id), paymentId: String(out.payment._id) });
    return out;
  });
}

export async function addAdvance({ branch, patient, mode, amount, reference, notes }, user) {
  const b = await Branch.findById(branch).select('code').lean();
  if (!(await Patient.exists({ _id: patient }))) throw ApiError.badRequest('Patient not found');
  const p = await Payment.create({ receiptNo: await nextDocNo('RCT', b.code), branch, patient, kind: 'advance', mode, amount, reference, notes, by: user._id });
  notify.enqueue('advance.event', { paymentId: String(p._id), balance: await advanceBalance(patient) });
  return p;
}

export async function refundAdvance({ branch, patient, mode, amount, notes }, user) {
  const p = await withTransaction(async (session) => {
    const bal = await advanceBalance(patient, session);
    if (amount > bal + 0.009) throw ApiError.badRequest(`Advance balance only ₹${bal}`);
    const b = await Branch.findById(branch).select('code').lean();
    const [p] = await Payment.create([{ receiptNo: await nextDocNo('RFD', b.code, session), branch, patient, kind: 'refund', mode, amount, notes, by: user._id }], { session });
    return p;
  });
  notify.enqueue('advance.event', { paymentId: String(p._id), balance: await advanceBalance(patient) });
  return p;
}

/**
 * Return lines (full or partial). Restocks batches (reverse FEFO order), issues credit note + refund payment.
 * lines: [{ lineId, qty }]
 */
export async function returnItems(invoiceId, { lines, refundMode, reason, restock = true }, user) {
  return withTransaction(async (session) => {
    const inv = await Invoice.findById(invoiceId).session(session);
    if (!inv) throw ApiError.notFound('Invoice not found');
    if (['cancelled', 'refunded'].includes(inv.status)) throw ApiError.badRequest(`Invoice ${inv.status}`);
    const branch = await Branch.findById(inv.branch).select('code').lean();
    const cnNo = await nextDocNo('CN', branch.code, session);

    let amount = 0;
    const cnLines = [];
    for (const req of lines) {
      const line = inv.items.id(req.lineId);
      if (!line) throw ApiError.badRequest('Line not found');
      if (req.qty <= 0 || line.returnedQty + req.qty > line.qty) throw ApiError.badRequest(`Invalid return qty for ${line.description}`);
      const lineAmt = r2((line.total / line.qty) * req.qty);
      if (line.kind === 'product' && restock) {
        // reverse the allocations: last-allocated first, respecting what was already returned
        let left = req.qty;
        let alreadyReturned = line.returnedQty;
        const allocs = [...line.allocations];
        // skip quantities already returned (consumed from the end)
        for (let i = allocs.length - 1; i >= 0 && left > 0; i--) {
          let avail = allocs[i].qty;
          const skip = Math.min(avail, alreadyReturned);
          avail -= skip;
          alreadyReturned -= skip;
          if (avail <= 0) continue;
          const put = Math.min(avail, left);
          await stock.restockBatch({ batch: allocs[i].batch, qty: put, type: 'return', refType: 'CreditNote', refNo: cnNo, by: user._id, reason }, session);
          left -= put;
        }
      }
      line.returnedQty += req.qty;
      amount += lineAmt;
      cnLines.push({ lineId: line._id, description: line.description, qty: req.qty, amount: lineAmt, restocked: line.kind === 'product' && restock });
    }
    amount = r2(amount);
    const refundable = r2(Math.min(amount, inv.paid - inv.refunded));

    const [cn] = await CreditNote.create([{ creditNoteNo: cnNo, branch: inv.branch, invoice: inv._id, patient: inv.patient, lines: cnLines, amount, reason, refundMode, by: user._id }], { session });

    if (refundable > 0) {
      await Payment.create([{ receiptNo: await nextDocNo('RFD', branch.code, session), branch: inv.branch, invoice: inv._id, patient: inv.patient, kind: 'refund', mode: refundMode || 'cash', amount: refundable, creditNote: cn._id, notes: reason, by: user._id }], { session });
    }
    inv.refunded = r2(inv.refunded + refundable);
    // unpaid portion of returned value reduces balance
    const reduceBalance = r2(amount - refundable);
    inv.balance = r2(Math.max(0, inv.balance - reduceBalance));
    const fullyReturned = inv.items.every((l) => l.returnedQty >= l.qty);
    inv.status = fullyReturned ? 'refunded' : inv.refunded > 0 ? 'partially_refunded' : statusFor(inv);
    await inv.save({ session });
    return { invoice: inv, creditNote: cn, refunded: refundable };
  }).then((out) => {
    notify.enqueue('invoice.refund', { invoiceId: String(out.invoice._id), creditNoteId: String(out.creditNote._id), refunded: out.refunded });
    return out;
  });
}

/** Cancel: only when no money collected. Restocks all. */
export async function cancelInvoice(invoiceId, reason, user) {
  return withTransaction(async (session) => {
    const inv = await Invoice.findById(invoiceId).session(session);
    if (!inv) throw ApiError.notFound();
    if (inv.status === 'cancelled') throw ApiError.badRequest('Already cancelled');
    if (inv.paid - inv.refunded > 0.009) throw ApiError.badRequest('Refund payments before cancelling (use Return)');
    for (const line of inv.items) {
      if (line.kind !== 'product') continue;
      let alreadyReturned = line.returnedQty;
      for (let i = line.allocations.length - 1; i >= 0; i--) {
        const a = line.allocations[i];
        const skip = Math.min(a.qty, alreadyReturned);
        alreadyReturned -= skip;
        const put = a.qty - skip;
        if (put > 0) await stock.restockBatch({ batch: a.batch, qty: put, type: 'cancel', refType: 'Invoice', refId: inv._id, refNo: inv.invoiceNo, by: user._id, reason }, session);
      }
      line.returnedQty = line.qty;
    }
    // give back redeemed points, take back earned points, free the coupon
    const L = inv.loyalty || {};
    if (L.mobile && (L.redeemed || L.earned)) {
      const rows = [];
      if (L.redeemed) rows.push({ mobile: L.mobile, patient: inv.patient, type: 'reverse', points: L.redeemed, invoice: inv._id, invoiceNo: inv.invoiceNo, branch: inv.branch, note: 'Bill cancelled — points returned', by: user._id });
      if (L.earned) rows.push({ mobile: L.mobile, patient: inv.patient, type: 'reverse', points: -L.earned, invoice: inv._id, invoiceNo: inv.invoiceNo, branch: inv.branch, note: 'Bill cancelled — earned points removed', by: user._id });
      await LoyaltyTxn.create(rows, { session, ordered: true });
    }
    if (inv.coupon?.coupon) await Coupon.updateOne({ _id: inv.coupon.coupon, used: { $gt: 0 } }, { $inc: { used: -1 } }, { session });
    inv.status = 'cancelled';
    inv.cancelReason = reason;
    inv.balance = 0;
    await inv.save({ session });
    return inv;
  });
}
