import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    patientId: { type: String, required: true, unique: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'PatientAccount', required: true, index: true },
    mobile: { type: String, required: true, index: true }, // denormalised from account for search
    relation: { type: String, enum: ['self', 'spouse', 'child', 'parent', 'sibling', 'other'], default: 'self' },
    name: { type: String, required: true, trim: true },
    dob: Date,
    ageYears: Number, // when DOB unknown
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    email: { type: String, lowercase: true, trim: true },
    altPhone: String,
    address: { line1: String, city: String, state: String, pincode: String },
    bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', null] },
    allergies: [String],
    emergencyContact: { name: String, phone: String, relation: String },
    registeredBranch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    branchesVisited: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    source: { type: String, enum: ['online', 'walkin', 'reception', 'crm', 'import'], default: 'online' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

schema.index({ name: 'text' });
schema.index({ registeredBranch: 1, createdAt: -1 });
schema.index({ branchesVisited: 1 });

schema.virtual('age').get(function () {
  if (this.dob) {
    const d = new Date(this.dob);
    const n = new Date();
    let a = n.getFullYear() - d.getFullYear();
    if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
    return a;
  }
  return this.ageYears ?? null;
});

export const Patient = mongoose.model('Patient', schema);
