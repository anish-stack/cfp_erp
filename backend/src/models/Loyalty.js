import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** discount coupons for POS / billing */
const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: String,
    type: { type: String, enum: ['percent', 'flat'], default: 'percent' },
    value: { type: Number, required: true, min: 0 },
    maxDiscount: Number, // cap for percent coupons
    minBill: { type: Number, default: 0 },
    appliesTo: { type: String, enum: ['all', 'products', 'services'], default: 'all' },
    branches: [{ type: ObjectId, ref: 'Branch' }], // empty = all branches
    validFrom: Date,
    validTo: Date,
    usageLimit: Number, // total uses (null = unlimited)
    perCustomer: { type: Number, default: 1 }, // uses per mobile (0 = unlimited)
    used: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/** loyalty ledger — one row per change; balance = FIFO of earned lots minus redemptions, ignoring expired lots */
const txnSchema = new mongoose.Schema(
  {
    mobile: { type: String, required: true, index: true },
    patient: { type: ObjectId, ref: 'Patient' },
    type: { type: String, enum: ['earn', 'redeem', 'reverse', 'adjust'], required: true },
    points: { type: Number, required: true }, // + earn / − redeem
    expiresAt: Date, // earn lots only
    invoice: { type: ObjectId, ref: 'Invoice' },
    invoiceNo: String,
    branch: { type: ObjectId, ref: 'Branch' },
    note: String,
    by: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
txnSchema.index({ mobile: 1, createdAt: 1 });

export const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);
export const LoyaltyTxn = mongoose.models.LoyaltyTxn || mongoose.model('LoyaltyTxn', txnSchema);
