import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, match: /^[a-z0-9_]+$/ },
    description: String,
    permissions: { type: [String], default: [] },
    scope: { type: String, enum: ['global', 'branch'], default: 'branch' },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Role = mongoose.model('Role', schema);
