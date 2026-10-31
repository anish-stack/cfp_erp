import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// ---------- Expense ----------
export const EXPENSE_CATEGORIES = ['rent', 'salary', 'utilities', 'marketing', 'maintenance', 'supplies', 'travel', 'professional_fees', 'taxes', 'misc'];
const expenseSchema = new mongoose.Schema(
  {
    branch: { type: ObjectId, ref: 'Branch', required: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    paidTo: String,
    mode: { type: String, enum: ['cash', 'upi', 'card', 'bank'], default: 'cash' },
    reference: String,
    note: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    createdBy: { type: ObjectId, ref: 'User' },
    approvedBy: { type: ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
expenseSchema.index({ branch: 1, date: -1 });
export const Expense = mongoose.model('Expense', expenseSchema);

// ---------- Notification log ----------
const nlSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['sms', 'whatsapp', 'email', 'webhook'], required: true },
    to: String,
    template: String,
    event: String,
    refType: String,
    refId: ObjectId,
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true },
    error: String,
    providerId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
nlSchema.index({ createdAt: -1 });
nlSchema.index({ refType: 1, refId: 1 });
nlSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86400 });
export const NotificationLog = mongoose.model('NotificationLog', nlSchema);

// ---------- Outbound webhook ----------
export const WEBHOOK_EVENTS = ['appointment.booked', 'appointment.cancelled', 'appointment.rescheduled', 'appointment.no_show', 'invoice.created', 'payment.received', 'lead.created', 'patient.created'];
const whSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    events: { type: [String], default: [] },
    secret: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
    lastStatus: Number,
    lastError: String,
    lastDeliveredAt: Date,
    failures: { type: Number, default: 0 },
  },
  { timestamps: true }
);
export const Webhook = mongoose.model('Webhook', whSchema);
