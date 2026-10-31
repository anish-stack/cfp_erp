import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// ---------- Medical record (consultation / procedure / note) ----------
const recordSchema = new mongoose.Schema(
  {
    patient: { type: ObjectId, ref: 'Patient', required: true },
    branch: { type: ObjectId, ref: 'Branch', required: true },
    doctor: { type: ObjectId, ref: 'Doctor' },
    appointment: { type: ObjectId, ref: 'Appointment' },
    type: { type: String, enum: ['consultation', 'procedure', 'note', 'investigation'], default: 'consultation' },
    complaints: String,
    history: String,
    examination: String, // e.g. P/R findings
    diagnosis: String,
    procedure: { name: String, anesthesia: String, notes: String, date: String },
    plan: String,
    vitals: { bp: String, pulse: Number, temp: Number, weightKg: Number, heightCm: Number, spo2: Number },
    investigations: [{ name: String, result: String, date: String }],
    isLocked: { type: Boolean, default: false }, // locked after 24h
    createdBy: { type: ObjectId, ref: 'User', required: true },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
recordSchema.index({ patient: 1, createdAt: -1 });
recordSchema.index({ branch: 1, createdAt: -1 });
export const MedicalRecord = mongoose.model('MedicalRecord', recordSchema);

// ---------- Prescription ----------
const rxItem = new mongoose.Schema(
  {
    product: { type: ObjectId, ref: 'Product' },
    name: { type: String, required: true },
    dose: String, // 1 tab
    frequency: String, // 1-0-1
    timing: String, // after food
    duration: String, // 5 days
    qty: Number,
    notes: String,
  },
  { _id: false }
);
const rxSchema = new mongoose.Schema(
  {
    rxNo: { type: String, unique: true },
    patient: { type: ObjectId, ref: 'Patient', required: true },
    branch: { type: ObjectId, ref: 'Branch', required: true },
    doctor: { type: ObjectId, ref: 'Doctor', required: true },
    appointment: { type: ObjectId, ref: 'Appointment' },
    record: { type: ObjectId, ref: 'MedicalRecord' },
    diagnosis: String,
    items: { type: [rxItem], default: [] },
    advice: String,
    diet: String,
    followUpDate: String,
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
rxSchema.index({ patient: 1, createdAt: -1 });
export const Prescription = mongoose.model('Prescription', rxSchema);

// ---------- Follow-up ----------
const fuSchema = new mongoose.Schema(
  {
    patient: { type: ObjectId, ref: 'Patient', required: true },
    branch: { type: ObjectId, ref: 'Branch', required: true },
    doctor: { type: ObjectId, ref: 'Doctor' },
    sourceAppointment: { type: ObjectId, ref: 'Appointment' },
    dueDate: { type: String, required: true },
    reason: String,
    status: { type: String, enum: ['pending', 'contacted', 'booked', 'done', 'missed', 'cancelled'], default: 'pending' },
    bookedAppointment: { type: ObjectId, ref: 'Appointment' },
    notes: [{ text: String, by: { type: ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }],
    assignedTo: { type: ObjectId, ref: 'User' },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
fuSchema.index({ branch: 1, status: 1, dueDate: 1 });
fuSchema.index({ patient: 1 });
export const FollowUp = mongoose.model('FollowUp', fuSchema);

// ---------- Document ----------
const docSchema = new mongoose.Schema(
  {
    patient: { type: ObjectId, ref: 'Patient', required: true, index: true },
    branch: { type: ObjectId, ref: 'Branch' },
    title: { type: String, required: true },
    category: { type: String, enum: ['report', 'scan', 'prescription', 'consent', 'invoice', 'other'], default: 'report' },
    storedName: { type: String, required: true },
    originalName: String,
    mime: String,
    size: Number,
    uploadedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const PatientDocument = mongoose.model('PatientDocument', docSchema);
