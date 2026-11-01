import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** Bulk WhatsApp campaign ("broadcast") to patients and/or leads */
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: ['package', 'lab_offer', 'health_info', 'camp', 'festival', 'reminder', 'other'], default: 'other' },
    message: { type: String, required: true }, // supports {name} {first} {clinic} {branch}
    mediaUrl: String, // public image or PDF
    mediaType: { type: String, enum: ['image', 'pdf', null], default: null },
    audience: {
      patients: { type: Boolean, default: true },
      leads: { type: Boolean, default: false },
      branches: [{ type: ObjectId, ref: 'Branch' }], // empty = all
      visitedFrom: String, visitedTo: String, // YYYY-MM-DD (patients' last appointment)
      gender: { type: String, enum: ['male', 'female', null], default: null },
      ageMin: Number, ageMax: Number,
      leadStages: [{ type: ObjectId, ref: 'LeadStage' }],
      leadSources: [String],
      condition: String, // lead condition contains
      extraNumbers: [String], // pasted numbers
    },
    status: { type: String, enum: ['draft', 'scheduled', 'sending', 'done', 'cancelled', 'failed'], default: 'draft', index: true },
    scheduledAt: Date,
    startedAt: Date,
    finishedAt: Date,
    gapSeconds: { type: Number, default: 4, min: 1, max: 120 }, // throttle between messages
    stats: { total: { type: Number, default: 0 }, sent: { type: Number, default: 0 }, failed: { type: Number, default: 0 }, skipped: { type: Number, default: 0 } },
    lastError: String,
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
schema.index({ createdAt: -1 });
export const Broadcast = mongoose.model('Broadcast', schema);
