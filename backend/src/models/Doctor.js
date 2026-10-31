import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // login account (role doctor)
    qualification: String,
    specialization: { type: String, default: 'Proctology' },
    regNo: String,
    experienceYears: Number,
    photo: String,
    bio: String,
    phone: String,
    email: { type: String, lowercase: true, trim: true },
    branches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch', index: true }],
    consultationFee: { type: Number, default: 0, min: 0 },
    followUpFee: { type: Number, default: 0, min: 0 },
    acceptsOnlineBooking: { type: Boolean, default: true },
    // scanned signature printed on prescriptions (private file: uploads/signatures)
    signature: { storedName: String, mime: String, updatedAt: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Doctor = mongoose.model('Doctor', schema);
