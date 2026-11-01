export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Compute one line. Intra-state → CGST = SGST = tax/2. */
export function computeLine({ qty, rate, discountPct = 0, gstRate = 0, extraDiscount = 0 }, taxInclusive = true) {
  const gross = qty * rate;
  // extraDiscount = this line's share of a bill-level discount (coupon / loyalty points), applied before GST
  const discountAmt = r2(Math.min(gross, (gross * discountPct) / 100 + extraDiscount));
  const net = gross - discountAmt;
  let taxable;
  let tax;
  if (taxInclusive) {
    // total must equal net exactly → derive tax as remainder
    taxable = r2(net / (1 + gstRate / 100));
    tax = r2(net - taxable);
  } else {
    taxable = r2(net);
    tax = r2((net * gstRate) / 100);
  }
  const cgst = r2(tax / 2);
  const sgst = r2(tax - cgst);
  return { discountAmt, taxable, cgst, sgst, total: r2(taxable + tax), gross: r2(gross) };
}

/** Totals with rounding to nearest rupee */
export function computeTotals(lines) {
  const sum = (k) => r2(lines.reduce((a, l) => a + (l[k] || 0), 0));
  const subtotal = sum('gross');
  const discount = sum('discountAmt');
  const taxable = sum('taxable');
  const cgst = sum('cgst');
  const sgst = sum('sgst');
  const exact = r2(taxable + cgst + sgst);
  const grandTotal = Math.round(exact);
  return { subtotal, discount, taxable, cgst, sgst, tax: r2(cgst + sgst), roundOff: r2(grandTotal - exact), grandTotal };
}

export function statusFor({ grandTotal, paid, refunded = 0, cancelled = false }) {
  if (cancelled) return 'cancelled';
  if (refunded > 0) return refunded >= paid - 0.009 ? 'refunded' : 'partially_refunded';
  if (paid >= grandTotal - 0.009) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}
