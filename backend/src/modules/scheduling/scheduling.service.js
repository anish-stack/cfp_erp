import mongoose from 'mongoose';
import { Branch } from '../../models/Branch.js';
import { Doctor } from '../../models/Doctor.js';
import { DoctorSchedule } from '../../models/DoctorSchedule.js';
import { ScheduleException } from '../../models/ScheduleException.js';
import { Appointment, ACTIVE_STATUS } from '../../models/Appointment.js';
import { SlotHold } from '../../models/SlotHold.js';
import { ApiError } from '../../utils/ApiError.js';
import { generateSlots } from '../../utils/slots.js';
import { weekdayOf, todayIST, daysBetween } from '../../utils/time.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Availability for a branch/date, one or all doctors.
 * @returns [{ doctor, closed, reason, slots, slotMinutes, capacity }]
 */
export async function availability({ branchId, date, doctorId, staff = false, onlineOnly = false, excludeHold }) {
  const branch = await Branch.findById(branchId).lean();
  if (!branch || !branch.isActive) throw ApiError.notFound('Branch not found');

  if (!staff) {
    if (!branch.acceptsOnlineBooking) throw ApiError.badRequest('Online booking not available at this branch');
    const diff = daysBetween(todayIST(), date);
    if (diff < 0) throw ApiError.badRequest('Date is in the past');
    if (diff > (branch.settings?.bookingWindowDays ?? 30)) throw ApiError.badRequest('Date beyond booking window');
  }

  const docFilter = { branches: branch._id, isActive: true };
  if (onlineOnly) docFilter.acceptsOnlineBooking = true;
  if (doctorId) docFilter._id = oid(doctorId);
  const doctors = await Doctor.find(docFilter).select('name qualification specialization photo consultationFee experienceYears').sort({ name: 1 }).lean();
  if (doctorId && !doctors.length) throw ApiError.notFound('Doctor not available at this branch');
  if (!doctors.length) return [];

  const ids = doctors.map((d) => d._id);
  const [schedules, exceptions, bookedAgg, heldAgg] = await Promise.all([
    DoctorSchedule.find({ branch: branch._id, weekday: weekdayOf(date), doctor: { $in: ids } }).lean(),
    ScheduleException.find({
      date,
      $and: [
        { $or: [{ branch: branch._id }, { branch: null }] },
        { $or: [{ doctor: null }, { doctor: { $in: ids } }] },
      ],
      status: { $ne: 'rejected' },
    }).lean(),
    Appointment.aggregate([
      { $match: { branch: branch._id, date, doctor: { $in: ids }, status: { $in: ACTIVE_STATUS }, slotKey: { $exists: true } } },
      { $group: { _id: { d: '$doctor', s: '$start' }, n: { $sum: 1 } } },
    ]),
    // seats locked by patients who are paying right now
    SlotHold.aggregate([
      { $match: { branch: branch._id, date, doctor: { $in: ids }, expiresAt: { $gt: new Date() }, ...(excludeHold ? { _id: { $ne: oid(excludeHold) } } : {}) } },
      { $group: { _id: { d: '$doctor', s: '$start' }, n: { $sum: 1 } } },
    ]),
  ]);

  const booked = {};
  for (const b of bookedAgg) (booked[String(b._id.d)] ||= {})[b._id.s] = b.n;
  for (const h of heldAgg) { const m = (booked[String(h._id.d)] ||= {}); m[h._id.s] = (m[h._id.s] || 0) + h.n; }

  return doctors.map((doctor) => {
    const did = String(doctor._id);
    const r = generateSlots({
      date,
      branch,
      schedule: schedules.find((s) => String(s.doctor) === did) || null,
      exceptions,
      doctorId: did,
      booked: booked[did] || {},
      ignoreLeadTime: staff,
    });
    return { doctor, ...r };
  });
}

/** Merge for "any doctor": per start time, total remaining across doctors */
export function mergeAny(perDoctor) {
  const map = new Map();
  for (const d of perDoctor) {
    for (const s of d.slots) {
      const cur = map.get(s.start) || { start: s.start, end: s.end, remaining: 0, available: false, doctors: [] };
      if (s.available) {
        cur.remaining += s.remaining;
        cur.available = true;
        cur.doctors.push(String(d.doctor._id));
      }
      map.set(s.start, cur);
    }
  }
  return [...map.values()].sort((a, b) => a.start.localeCompare(b.start));
}
