import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** Spin-to-win wheel. Weights & stock never leave the server — the server decides the prize. */
const segmentSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true },
  kind: { type: String, enum: ['prize', 'none'], default: 'prize' }, // none = "Better luck next time"
  description: String, // shown to the winner, e.g. "Valid on first consultation"
  weight: { type: Number, default: 10, min: 0 },
  stock: { type: Number, default: null }, // null = unlimited
  remaining: { type: Number, default: null },
  won: { type: Number, default: 0 },
  color: { type: String, default: '#e21f26' },
  textColor: { type: String, default: '#ffffff' },
});

const wheelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    title: { type: String, default: 'Spin & Win!' },
    subtitle: { type: String, default: 'Try your luck — every spin wins a health benefit.' },
    buttonText: { type: String, default: 'Spin now' },
    segments: { type: [segmentSchema], default: [] },
    validDays: { type: Number, default: 30 },
    codePrefix: { type: String, default: 'CPF', uppercase: true, trim: true },
    terms: { type: String, default: 'One spin per mobile number. Show the code at the clinic reception. Not redeemable for cash.' },
    sendWhatsapp: { type: Boolean, default: true },
    winMessage: { type: String, default: 'Congratulations {name}! 🎉\n\nYou won *{prize}* at {clinic}.\nYour code: *{code}*\nValid till {expiry}.\n\nShow this code at reception. Call {phone} to book.' },
    createLead: { type: Boolean, default: true },
    startsAt: Date,
    endsAt: Date,
    isActive: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const entrySchema = new mongoose.Schema(
  {
    wheel: { type: ObjectId, ref: 'SpinWheel', required: true, index: true },
    form: { type: ObjectId, ref: 'EnquiryForm' }, // landing page the spin came from
    name: String,
    phone: { type: String, required: true },
    segment: ObjectId,
    prize: String,
    isWin: Boolean,
    code: String,
    status: { type: String, enum: ['won', 'redeemed', 'lost', 'cancelled'], default: 'won', index: true },
    expiresAt: Date,
    redeemedAt: Date,
    redeemedBy: { type: ObjectId, ref: 'User' },
    redeemedBranch: { type: ObjectId, ref: 'Branch' },
    redeemNote: String,
    lead: { type: ObjectId, ref: 'Lead' },
    // where the spin came from
    utm: { source: String, medium: String, campaign: String, term: String, content: String, gclid: String, fbclid: String },
    pageUrl: String,
    referrer: String,
    device: { type: { type: String }, os: String, browser: String },
    ip: String,
    city: String,
    region: String,
    country: String,
    language: String,
    whatsapp: { status: String, error: String },
  },
  { timestamps: true }
);
entrySchema.index({ wheel: 1, phone: 1 }, { unique: true });
entrySchema.index({ code: 1 }, { unique: true, sparse: true });
entrySchema.index({ createdAt: -1 });

export const SpinWheel = mongoose.models.SpinWheel || mongoose.model('SpinWheel', wheelSchema);
export const SpinEntry = mongoose.models.SpinEntry || mongoose.model('SpinEntry', entrySchema);
