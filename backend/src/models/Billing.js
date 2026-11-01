import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const alloc = new mongoose.Schema({ batch: ObjectId, batchNo: String, expiry: String, qty: Number }, { _id: false });

const lineSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['product', 'service', 'custom'], default: 'custom' },
    product: { type: ObjectId, ref: 'Product' },
    description: { type: String, required: true },
    hsn: String,
    qty: { type: Number, required: true, min: 0.01 },
    rate: { type: Number, required: true, min: 0 },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    discountAmt: Number,
    gstRate: { type: Number, default: 0 },
    taxable: Number,
    cgst: Number,
    sgst: Number,
    total: Number,
    allocations: [alloc], // FEFO batches deducted
    returnedQty: { type: Number, default: 0 },
  },
  { _id: true }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNo: { type: String, unique: true },
    branch: { type: ObjectId, ref: 'Branch', required: true },
    patient: { type: ObjectId, ref: 'Patient' },
    customer: { name: String, phone: String }, // walk-in POS buyer
    appointment: { type: ObjectId, ref: 'Appointment' },
    doctor: { type: ObjectId, ref: 'Doctor' },
    type: { type: String, enum: ['consultation', 'treatment', 'procedure', 'pharmacy', 'mixed', 'ipd'], default: 'mixed' },
    admission: { type: ObjectId, ref: 'Admission' },
    source: { type: String, enum: ['billing', 'pos'], default: 'billing' },
    items: [lineSchema],
    taxInclusive: { type: Boolean, default: true },
    subtotal: Number, // sum gross before discount
    discount: Number,
    taxable: Number,
    cgst: Number,
    sgst: Number,
    tax: Number,
    roundOff: Number,
    grandTotal: Number,
    // bill-level discounts (already spread across the lines before GST)
    coupon: { code: String, coupon: { type: ObjectId, ref: 'Coupon' }, discount: Number },
    loyalty: { mobile: String, redeemed: { type: Number, default: 0 }, redeemValue: { type: Number, default: 0 }, earned: { type: Number, default: 0 } },
    paid: { type: Number, default: 0 },
    refunded: { type: Number, default: 0 },
    balance: Number,
    status: { type: String, enum: ['unpaid', 'partial', 'paid', 'partially_refunded', 'refunded', 'cancelled'], default: 'unpaid' },
    notes: String,
    cancelReason: String,
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
invoiceSchema.index({ branch: 1, createdAt: -1 });
invoiceSchema.index({ patient: 1, createdAt: -1 });
invoiceSchema.index({ status: 1 });
export const Invoice = mongoose.model('Invoice', invoiceSchema);

/**
 * kind: payment (+ against invoice), advance (+ patient wallet), advance_adjust (− wallet, applied to invoice),
 *       refund (money out; against invoice or advance)
 */
const paymentSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, unique: true },
    branch: { type: ObjectId, ref: 'Branch', required: true },
    invoice: { type: ObjectId, ref: 'Invoice' },
    patient: { type: ObjectId, ref: 'Patient' },
    kind: { type: String, enum: ['payment', 'advance', 'advance_adjust', 'refund'], required: true },
    mode: { type: String, enum: ['cash', 'upi', 'card', 'bank', 'advance', 'insurance'], required: true },
    amount: { type: Number, required: true, min: 0.01 },
    reference: String,
    notes: String,
    creditNote: { type: ObjectId, ref: 'CreditNote' },
    by: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
paymentSchema.index({ branch: 1, createdAt: -1 });
paymentSchema.index({ patient: 1, kind: 1 });
paymentSchema.index({ invoice: 1 });
export const Payment = mongoose.model('Payment', paymentSchema);

const cnSchema = new mongoose.Schema(
  {
    creditNoteNo: { type: String, unique: true },
    branch: { type: ObjectId, ref: 'Branch', required: true },
    invoice: { type: ObjectId, ref: 'Invoice', required: true },
    patient: { type: ObjectId, ref: 'Patient' },
    lines: [{ lineId: ObjectId, description: String, qty: Number, amount: Number, restocked: Boolean }],
    amount: Number,
    reason: String,
    refundMode: String,
    by: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const CreditNote = mongoose.model('CreditNote', cnSchema);
