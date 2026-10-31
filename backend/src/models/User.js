import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
    branches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    allBranches: { type: Boolean, default: false },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
    designation: String,
    isActive: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0, select: false },
    lastLoginAt: Date,
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
  },
  { timestamps: true }
);

schema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
schema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
schema.index({ branches: 1, isActive: 1 });

schema.methods.setPassword = async function (pw) {
  this.passwordHash = await bcrypt.hash(pw, 12);
};
schema.methods.checkPassword = function (pw) {
  return bcrypt.compare(pw, this.passwordHash);
};

schema.set('toJSON', {
  transform: (_, r) => {
    delete r.passwordHash;
    delete r.tokenVersion;
    delete r.failedLogins;
    delete r.lockUntil;
    delete r.__v;
    return r;
  },
});

export const User = mongoose.model('User', schema);
