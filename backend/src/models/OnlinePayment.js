import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** one Razorpay payment request (link / UPI QR / checkout order) and its outcome */
const schema = new mongoose.Schema(
  {
    provider: { type: String, default: 'razorpay' },
    kind: { type: String, enum: ['link', 'qr', 'order'], required: true },
    purpose: { type: String, enum: ['invoice', 'advance', 'appointment'], required: true },
    branch: { type: ObjectId, ref: 'Branch' },
    invoice: { type: ObjectId, ref: 'Invoice' },
    patient: { type: ObjectId, ref: 'Patient' },
    appointment: { type: ObjectId, ref: 'Appointment' },
    admission: { type: ObjectId, ref: 'Admission' },
    customer: { name: String, phone: String, email: String },
    amount: { type: Number, required: true }, // rupees
    description: String,
    providerId: { type: String, index: true }, // plink_… / qr_… / order_…
    shortUrl: String, // payment link URL
    imageUrl: String, // Razorpay QR image
    expiresAt: Date,
    status: { type: String, enum: ['created', 'paid', 'expired', 'cancelled', 'failed', 'refunded'], default: 'created', index: true },
    paymentId: String, // pay_…
    method: String,
    paidAmount: Number,
    paidAt: Date,
    receipt: { type: ObjectId, ref: 'Payment' }, // our receipt once recorded
    recordError: String,
    sentTo: [{ to: String, at: Date, channel: String }],
    booking: mongoose.Schema.Types.Mixed, // appointment order: slot the patient is paying for
    refund: { id: String, amount: Number, at: Date, reason: String },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
schema.index({ invoice: 1, status: 1 });
schema.index({ createdAt: -1 });

export const OnlinePayment = mongoose.models.OnlinePayment || mongoose.model('OnlinePayment', schema);
