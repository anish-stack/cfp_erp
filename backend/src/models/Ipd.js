import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * IPD (in-patient) — wards, beds, admissions.
 * An Admission embeds its clinical timeline (vitals, notes, MAR, procedures) and running charges;
 * on discharge the charges become one IPD invoice through the normal billing service.
 */
export const WARD_TYPES = ['general', 'semi_private', 'private', 'deluxe', 'icu', 'day_care', 'recovery', 'emergency'];
export const BED_STATUS = ['available', 'occupied', 'reserved', 'cleaning', 'maintenance'];
export const ADMISSION_STATUS = ['admitted', 'discharge_initiated', 'discharged', 'cancelled'];
export const CHARGE_KINDS = ['bed', 'nursing', 'procedure', 'surgeon', 'anaesthesia', 'ot', 'doctor_visit', 'pharmacy', 'consumable', 'investigation', 'other'];
export const DIETS = ['normal', 'soft', 'liquid', 'clear_liquid', 'nbm', 'high_fibre', 'diabetic', 'low_salt', 'custom'];
export const CLAIM_STATUS = ['pre_auth_pending', 'pre_auth_approved', 'pre_auth_rejected', 'ready_to_submit', 'submitted', 'query', 'approved', 'settled', 'rejected', 'closed'];
export const FREQ_HOURS = { OD: 24, HS: 24, BD: 12, TDS: 8, QID: 6, '6 hourly': 6, '8 hourly': 8, '4 hourly': 4, '12 hourly': 12 };

// ---------------------------------------------------------------- ward
const wardSchema = new mongoose.Schema(
  {
    branch: { type: ObjectId, ref: 'Branch', required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: WARD_TYPES, default: 'general' },
    floor: String,
    dailyRate: { type: Number, default: 0, min: 0 }, // bed / room rent per day
    nursingRate: { type: Number, default: 0, min: 0 }, // nursing charge per day
    gstRate: { type: Number, default: 0 }, // room rent ≤ ₹5000/day in hospitals is GST-exempt
    description: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
wardSchema.index({ branch: 1, name: 1 }, { unique: true });
export const Ward = mongoose.model('Ward', wardSchema);

// ---------------------------------------------------------------- bed
const bedSchema = new mongoose.Schema(
  {
    branch: { type: ObjectId, ref: 'Branch', required: true, index: true },
    ward: { type: ObjectId, ref: 'Ward', required: true, index: true },
    number: { type: String, required: true, trim: true },
    status: { type: String, enum: BED_STATUS, default: 'available' },
    currentAdmission: { type: ObjectId, ref: 'Admission', default: null },
    features: [String], // oxygen, monitor, attached bath…
    note: String,
    // advance booking for a planned admission
    reservation: { patient: { type: ObjectId, ref: 'Patient' }, name: String, phone: String, date: Date, note: String, by: { type: ObjectId, ref: 'User' }, at: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
bedSchema.index({ branch: 1, number: 1 }, { unique: true });
export const Bed = mongoose.model('Bed', bedSchema);

// ---------------------------------------------------------------- surgery / day-care packages
const packageSchema = new mongoose.Schema(
  {
    branch: { type: ObjectId, ref: 'Branch', default: null }, // null = all branches
    name: { type: String, required: true, trim: true },
    procedure: { type: ObjectId, ref: 'Product' },
    wardType: String, // room class the price is for (general, private…)
    price: { type: Number, required: true, min: 0 },
    includedDays: { type: Number, default: 1, min: 0 },
    covers: { type: [String], default: ['bed', 'nursing', 'procedure', 'ot', 'surgeon', 'anaesthesia', 'doctor_visit'] },
    inclusions: [String], // shown on estimate
    exclusions: [String],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const IpdPackage = mongoose.model('IpdPackage', packageSchema);

// ---------------------------------------------------------------- admission
const by = { type: ObjectId, ref: 'User' };
const admissionSchema = new mongoose.Schema(
  {
    admissionNo: { type: String, unique: true },
    branch: { type: ObjectId, ref: 'Branch', required: true, index: true },
    patient: { type: ObjectId, ref: 'Patient', required: true, index: true },
    appointment: { type: ObjectId, ref: 'Appointment' },
    doctor: { type: ObjectId, ref: 'Doctor', required: true }, // attending / consultant
    type: { type: String, enum: ['planned', 'emergency', 'day_care'], default: 'planned' },
    status: { type: String, enum: ADMISSION_STATUS, default: 'admitted', index: true },
    admittedAt: { type: Date, default: Date.now },
    expectedDischargeAt: Date,
    dischargedAt: Date,
    reason: String, // chief complaint / reason for admission
    provisionalDiagnosis: String,
    plannedProcedure: { product: { type: ObjectId, ref: 'Product' }, name: String },
    allergies: String,
    bed: { type: ObjectId, ref: 'Bed' },
    ward: { type: ObjectId, ref: 'Ward' },
    bedHistory: [{ _id: false, bed: { type: ObjectId, ref: 'Bed' }, bedNumber: String, ward: { type: ObjectId, ref: 'Ward' }, wardName: String, dailyRate: Number, nursingRate: Number, gstRate: Number, from: Date, to: Date }],
    attendant: { name: String, phone: String, relation: String },
    payer: {
      type: { type: String, enum: ['self', 'insurance', 'corporate', 'government'], default: 'self' },
      insurer: String, tpa: String, policyNo: String, cardNo: String, preAuthNo: String,
      preAuthStatus: { type: String, enum: ['not_required', 'pending', 'approved', 'rejected', 'partial'], default: 'not_required' },
      approvedAmount: Number,
    },
    estimate: Number,
    consent: { signed: { type: Boolean, default: false }, signedBy: String, relation: String, witness: String, at: Date, notes: String },
    preOp: [{ _id: false, item: String, done: Boolean, by, at: Date }],
    procedures: [{
      service: { type: ObjectId, ref: 'Product' }, name: String, surgeon: { type: ObjectId, ref: 'Doctor' }, assistant: String, anaesthetist: String,
      anaesthesia: { type: String, enum: ['local', 'spinal', 'saddle', 'general', 'sedation', 'none'], default: 'local' },
      ot: String, scheduledAt: Date, startedAt: Date, endedAt: Date,
      status: { type: String, enum: ['scheduled', 'in_progress', 'done', 'cancelled'], default: 'scheduled' },
      durationMin: { type: Number, default: 60 },
      findings: String, notes: String, chargePosted: { type: Boolean, default: false }, by,
    }],
    vitals: [{ at: { type: Date, default: Date.now }, bp: String, pulse: Number, temp: Number, spo2: Number, rr: Number, pain: Number, sugar: Number, intake: Number, output: Number, note: String, by }],
    notes: [{ at: { type: Date, default: Date.now }, type: { type: String, enum: ['doctor_round', 'nursing', 'progress', 'diet', 'handover'], default: 'progress' }, text: String, by }],
    medications: [{
      product: { type: ObjectId, ref: 'Product' }, name: String, dose: String, route: { type: String, default: 'oral' }, frequency: String, instructions: String,
      startAt: { type: Date, default: Date.now }, stopAt: Date, active: { type: Boolean, default: true }, orderedBy: by,
      administrations: [{ _id: false, at: { type: Date, default: Date.now }, status: { type: String, enum: ['given', 'missed', 'refused', 'held'], default: 'given' }, note: String, by }],
    }],
    charges: [{
      date: { type: Date, default: Date.now }, kind: { type: String, enum: CHARGE_KINDS, default: 'other' }, description: String,
      product: { type: ObjectId, ref: 'Product' }, qty: { type: Number, default: 1 }, rate: Number, gstRate: { type: Number, default: 0 }, amount: Number,
      allocations: [{ _id: false, batch: ObjectId, batchNo: String, expiry: String, qty: Number }], // pharmacy issue (FEFO)
      by,
    }],
    discharge: {
      type: { type: String, enum: ['normal', 'lama', 'dama', 'referred', 'death', 'absconded'], default: 'normal' },
      finalDiagnosis: String, procedureDone: String, courseInHospital: String, investigations: String, conditionAtDischarge: String,
      medications: [{ _id: false, name: String, dose: String, frequency: String, duration: String, instructions: String }],
      advice: String, diet: String, followUpDate: String, followUpNote: String, referredTo: String, preparedBy: by, at: Date,
    },
    package: { package: { type: ObjectId, ref: 'IpdPackage' }, name: String, price: Number, includedDays: Number, covers: [String], appliedAt: Date },
    diet: { type: { type: String, enum: DIETS, default: 'normal' }, notes: String, by, at: Date },
    investigations: [{
      name: String, urgent: Boolean, status: { type: String, enum: ['ordered', 'sample_collected', 'reported', 'cancelled'], default: 'ordered' },
      rate: Number, orderedAt: { type: Date, default: Date.now }, orderedBy: by, collectedAt: Date, reportedAt: Date, result: String, abnormal: Boolean, document: ObjectId, by,
    }],
    documents: [{ title: String, category: { type: String, enum: ['report', 'scan', 'consent', 'claim', 'id_proof', 'other'], default: 'report' }, storedName: String, originalName: String, mime: String, size: Number, by, at: { type: Date, default: Date.now } }],
    claim: { type: ObjectId, ref: 'InsuranceClaim' },
    invoice: { type: ObjectId, ref: 'Invoice' },
    finalizing: Boolean,
    cancelReason: String,
    createdBy: by,
  },
  { timestamps: true }
);
admissionSchema.index({ branch: 1, status: 1, admittedAt: -1 });
export const Admission = mongoose.model('Admission', admissionSchema);

// ---------------------------------------------------------------- insurance / TPA claim
const claimSchema = new mongoose.Schema(
  {
    claimRef: { type: String, unique: true },
    branch: { type: ObjectId, ref: 'Branch', required: true, index: true },
    admission: { type: ObjectId, ref: 'Admission', required: true, index: true },
    patient: { type: ObjectId, ref: 'Patient', required: true },
    invoice: { type: ObjectId, ref: 'Invoice' },
    payerType: { type: String, default: 'insurance' },
    insurer: String, tpa: String, policyNo: String, cardNo: String, preAuthNo: String, claimNo: String,
    status: { type: String, enum: CLAIM_STATUS, default: 'pre_auth_pending', index: true },
    estimate: Number, preAuthAmount: Number, approvedAmount: Number, claimedAmount: Number,
    settledAmount: Number, tds: Number, deduction: Number, deductionReason: String, settlementRef: String, settledAt: Date,
    submittedAt: Date, followUpOn: Date, notes: String,
    timeline: [{ _id: false, at: { type: Date, default: Date.now }, status: String, note: String, amount: Number, by: { type: ObjectId, ref: 'User' } }],
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const InsuranceClaim = mongoose.model('InsuranceClaim', claimSchema);
