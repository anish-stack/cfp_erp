import mongoose from 'mongoose';

export const APPT_STATUS = ['booked', 'confirmed', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show', 'rescheduled'];
export const ACTIVE_STATUS = ['booked', 'confirmed', 'checked_in', 'in_consultation'];

const schema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true, unique: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'PatientAccount', index: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    start: { type: String, required: true },
    end: { type: String, required: true },
    type: { type: String, enum: ['online', 'phone', 'walkin', 'followup', 'crm'], default: 'online' },
    visitType: { type: String, enum: ['new', 'followup', 'procedure'], default: 'new' },
    status: { type: String, enum: APPT_STATUS, default: 'booked' },
    // set only while active: doctor|date|start|seat ; unique sparse → atomic double-booking guard
    slotKey: { type: String },
    tokenNo: Number,
    complaint: { type: String, maxlength: 500 },
    notes: String,
    cancelReason: String,
    cancelledBy: { type: String, enum: ['patient', 'staff', 'system'] },
    rescheduledFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
    rescheduledTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
    utm: { source: String, medium: String, campaign: String },
    checkedInAt: Date,
    completedAt: Date,
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reminderJobIds: [String],
  },
  { timestamps: true }
);

schema.index({ slotKey: 1 }, { unique: true, sparse: true });
schema.index({ branch: 1, date: 1, start: 1 });
schema.index({ doctor: 1, date: 1 });
schema.index({ status: 1, date: 1 });

export const Appointment = mongoose.model('Appointment', schema);
