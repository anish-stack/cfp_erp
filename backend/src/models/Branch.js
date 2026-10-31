import mongoose from 'mongoose';

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const breakSchema = new mongoose.Schema(
  { label: String, start: { type: String, match: timeRe }, end: { type: String, match: timeRe } },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true, unique: true, match: /^[A-Z]{2,5}$/ },
    slug: { type: String, required: true, lowercase: true, unique: true },
    address: {
      line1: String,
      line2: String,
      city: { type: String, default: 'Delhi' },
      state: { type: String, default: 'Delhi' },
      pincode: String,
      mapUrl: String,
    },
    phone: String,
    whatsapp: String,
    email: { type: String, lowercase: true, trim: true },
    gstin: { type: String, uppercase: true, trim: true },
    isActive: { type: Boolean, default: true },
    acceptsOnlineBooking: { type: Boolean, default: true },
    settings: {
      slotMinutes: { type: Number, default: 15, min: 5, max: 240 },
      gapMinutes: { type: Number, default: 0, min: 0, max: 120 },
      openTime: { type: String, default: '10:00', match: timeRe },
      closeTime: { type: String, default: '19:00', match: timeRe },
      breaks: { type: [breakSchema], default: [{ label: 'Lunch', start: '14:00', end: '15:00' }] },
      weeklyOff: { type: [Number], default: [0] }, // 0=Sun
      bookingWindowDays: { type: Number, default: 30 },
      minLeadMinutes: { type: Number, default: 30 },
      invoicePrefix: String,
    },
  },
  { timestamps: true }
);

export const Branch = mongoose.model('Branch', schema);
