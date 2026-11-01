import { Coupon, LoyaltyTxn } from '../../models/Loyalty.js';
import { Invoice } from '../../models/Billing.js';
import { getSettings } from '../../models/Settings.js';
import { ApiError } from '../../utils/ApiError.js';
import { r2 } from '../../utils/invoiceMath.js';

export const mobileKey = (m) => {
  const d = String(m || '').replace(/\D/g, '');
  const ten = d.length > 10 ? d.slice(-10) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
};

/* ------------------------------------------------------------------ loyalty */
/** FIFO lots: redemptions consume the oldest unexpired points; expired lots drop out */
export async function loyaltyBalance(mobile, session) {
  if (!mobile) return { balance: 0, expiringSoon: 0 };
  const rows = await LoyaltyTxn.find({ mobile }).sort({ createdAt: 1, _id: 1 }).session(session || null).lean();
  const now = Date.now();
  let lots = [];
  for (const t of rows) {
    const at = new Date(t.createdAt).getTime();
    lots = lots.filter((l) => !l.exp || l.exp > at);
    if (t.points > 0) lots.push({ left: t.points, exp: t.expiresAt ? new Date(t.expiresAt).getTime() : null });
    else {
      let need = -t.points;
      for (const l of lots) { if (!need) break; const take = Math.min(l.left, need); l.left -= take; need -= take; }
      lots = lots.filter((l) => l.left > 0);
    }
  }
  lots = lots.filter((l) => !l.exp || l.exp > now);
  const balance = Math.floor(lots.reduce((a, l) => a + l.left, 0));
  const expiringSoon = Math.floor(lots.filter((l) => l.exp && l.exp < now + 30 * 864e5).reduce((a, l) => a + l.left, 0));
  return { balance, expiringSoon };
}

/** how many points can be used on this bill (net amount after line + coupon discounts) */
export function maxRedeemable(cfg, balance, net) {
  if (!cfg?.enabled || balance < (cfg.minRedeem || 0)) return 0;
  const byPct = Math.floor((net * (cfg.maxRedeemPct ?? 50)) / 100 / (cfg.pointValue || 1));
  return Math.max(0, Math.min(balance, byPct));
}

export const pointsFor = (cfg, amount) => (cfg?.enabled ? Math.floor((amount * (cfg.earnPer100 || 0)) / 100) : 0);

/* ------------------------------------------------------------------ coupons */
/**
 * Validate a coupon against a bill.
 * lines: [{ kind: 'product'|'service'|'custom', net }]  (net = after line discounts)
 */
export async function quoteCoupon(code, { lines, mobile, branch, excludeInvoice }, session) {
  const c = await Coupon.findOne({ code: String(code || '').trim().toUpperCase() }).session(session || null).lean();
  if (!c || !c.isActive) throw ApiError.badRequest('Invalid coupon code');
  const now = new Date();
  if (c.validFrom && c.validFrom > now) throw ApiError.badRequest('This coupon is not active yet');
  if (c.validTo && c.validTo < now) throw ApiError.badRequest('This coupon has expired');
  if (c.usageLimit && c.used >= c.usageLimit) throw ApiError.badRequest('This coupon has been fully used');
  if (c.branches?.length && branch && !c.branches.map(String).includes(String(branch))) throw ApiError.badRequest('Coupon not valid at this branch');
  if (c.perCustomer > 0) {
    if (!mobile) throw ApiError.badRequest('Enter the customer mobile number to use this coupon');
    const usedBy = await Invoice.countDocuments({ 'coupon.coupon': c._id, 'loyalty.mobile': mobile, status: { $ne: 'cancelled' }, ...(excludeInvoice ? { _id: { $ne: excludeInvoice } } : {}) }).session(session || null);
    if (usedBy >= c.perCustomer) throw ApiError.badRequest('This customer has already used this coupon');
  }
  const eligible = lines.filter((l) => c.appliesTo === 'all' || (c.appliesTo === 'products' ? l.kind === 'product' : l.kind !== 'product'));
  const base = r2(eligible.reduce((a, l) => a + l.net, 0));
  const total = r2(lines.reduce((a, l) => a + l.net, 0));
  if (total < (c.minBill || 0)) throw ApiError.badRequest(`Minimum bill ₹${c.minBill} for this coupon`);
  if (!base) throw ApiError.badRequest(`Coupon applies to ${c.appliesTo} only`);
  let discount = c.type === 'percent' ? (base * c.value) / 100 : c.value;
  if (c.type === 'percent' && c.maxDiscount) discount = Math.min(discount, c.maxDiscount);
  discount = r2(Math.min(discount, base));
  return { coupon: c, discount, eligibleIdx: lines.map((l, i) => (eligible.includes(l) ? i : -1)).filter((i) => i >= 0) };
}

/** spread an amount across the given line indexes in proportion to their net; last one takes the rounding */
export function spread(amount, lines, idx) {
  const out = new Array(lines.length).fill(0);
  const base = idx.reduce((a, i) => a + lines[i].net, 0);
  if (!amount || !base) return out;
  let left = r2(amount);
  idx.forEach((i, k) => {
    const share = k === idx.length - 1 ? left : r2((amount * lines[i].net) / base);
    out[i] = Math.min(share, lines[i].net);
    left = r2(left - out[i]);
  });
  return out;
}

export async function loyaltyCfg() {
  return (await getSettings()).loyalty || {};
}
