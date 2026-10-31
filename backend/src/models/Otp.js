import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    mobile: { type: String, required: true },
    purpose: { type: String, enum: ['patient_login'], default: 'patient_login' },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ mobile: 1, purpose: 1 }, { unique: true });

export const Otp = mongoose.model('Otp', schema);
