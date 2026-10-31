import mongoose from 'mongoose';

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const win = new mongoose.Schema(
  { start: { type: String, match: timeRe, required: true }, end: { type: String, match: timeRe, required: true } },
  { _id: false }
);

/**
 * holiday     → branch closed (doctor=null) / all branches (branch=null & doctor=null)
 * leave       → doctor off: full day (no sessions) or partial (sessions = off windows)
 * special_day → working hours override (sessions = working windows) even on weekly off
 * block       → manual blocked windows (sessions) for branch or doctor
 */
const schema = new mongoose.Schema(
  {
    type: { type: String, enum: ['holiday', 'leave', 'special_day', 'block'], required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    sessions: { type: [win], default: [] },
    reason: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' }, // leave approval
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

schema.index({ date: 1, branch: 1 });
schema.index({ doctor: 1, date: 1 });

export const ScheduleException = mongoose.model('ScheduleException', schema);
