import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    mobile: { type: String, required: true, unique: true, match: /^[6-9]\d{9}$/ },
    isVerified: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

export const PatientAccount = mongoose.model('PatientAccount', schema);
