import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Temporary seat lock while a patient pays (BookMyShow style).
 * key = the same "doctor|date|start|seat" string an appointment's slotKey would get.
 * An active hold makes that seat unavailable to everyone else (portal + staff) until it expires or is released.
 */
const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    branch: { type: ObjectId, ref: 'Branch', required: true },
    doctor: { type: ObjectId, ref: 'Doctor', required: true },
    date: { type: String, required: true },
    start: { type: String, required: true },
    end: String,
    account: { type: ObjectId, ref: 'PatientAccount' },
    patient: { type: ObjectId, ref: 'Patient' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);
schema.index({ branch: 1, date: 1, doctor: 1 });
schema.index({ account: 1 });
// Mongo removes stale holds automatically (checks also compare expiresAt, so the TTL delay doesn't matter)
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });

export const SlotHold = mongoose.models.SlotHold || mongoose.model('SlotHold', schema);
export const HOLD_MINUTES = 10;
