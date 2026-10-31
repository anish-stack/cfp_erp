import mongoose from 'mongoose';

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const session = new mongoose.Schema(
  { start: { type: String, match: timeRe, required: true }, end: { type: String, match: timeRe, required: true } },
  { _id: false }
);

/** One doc per doctor × branch × weekday. Missing slotMinutes/gapMinutes → branch settings. */
const schema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    weekday: { type: Number, min: 0, max: 6, required: true },
    sessions: { type: [session], default: [] },
    slotMinutes: { type: Number, min: 5, max: 240 },
    gapMinutes: { type: Number, min: 0, max: 120 },
    capacityPerSlot: { type: Number, default: 1, min: 1, max: 20 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

schema.index({ doctor: 1, branch: 1, weekday: 1 }, { unique: true });
schema.index({ branch: 1, weekday: 1 });

export const DoctorSchedule = mongoose.model('DoctorSchedule', schema);
