import { withTransaction } from '../../config/db.js';
import { Appointment, ACTIVE_STATUS } from '../../models/Appointment.js';
import { SlotHold, HOLD_MINUTES } from '../../models/SlotHold.js';
import { Branch } from '../../models/Branch.js';
import { Patient } from '../../models/Patient.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextBookingId, nextSeq } from '../../utils/counter.js';
import { nowIST, toHHMM, todayIST } from '../../utils/time.js';
import { availability } from '../scheduling/scheduling.service.js';
import { linkBranch } from '../patients/patients.service.js';
import * as notify from '../../services/notify.js';

const isDupSlot = (e) => e?.code === 11000 && (e.keyPattern?.slotKey || /slotKey/.test(e.message));

const activeHold = (key, notId) => SlotHold.exists({ key, expiresAt: { $gt: new Date() }, ...(notId ? { _id: { $ne: notId } } : {}) });

/**
 * Insert appointment, trying seats 1..capacity. Unique slotKey index makes appointment-vs-appointment race-safe.
 * Holds live in another collection, so both sides use "write, then check the other": whoever writes second
 * always sees the first write and backs off → a seat can never end up both held and booked.
 * own = the caller's own hold (tried first, ignored in checks)
 */
async function insertWithSeat(data, capacity, branchCode, own) {
  const seats = Array.from({ length: capacity }, (_, i) => i + 1);
  if (own?.key) {
    const s = Number(own.key.split('|')[3]);
    if (seats.includes(s)) seats.sort((a, b) => (a === s ? -1 : b === s ? 1 : a - b));
  }
  for (const seat of seats) {
    const slotKey = `${data.doctor}|${data.date}|${data.start}|${seat}`;
    if (await activeHold(slotKey, own?._id)) continue;
    let appt;
    try {
      appt = await withTransaction(async (session) => {
        const bookingId = await nextBookingId(branchCode, data.date, session);
        const [a] = await Appointment.create([{ ...data, bookingId, slotKey }], { session });
        return a;
      });
    } catch (e) {
      if (isDupSlot(e)) continue;
      throw e;
    }
    if (await activeHold(slotKey, own?._id)) {
      // someone locked this seat at the same instant → give it back, try the next seat
      await Appointment.deleteOne({ _id: appt._id });
      continue;
    }
    return appt;
  }
  return null;
}

/**
 * Core booking. doctorId may be 'any'.
 * opts: { staff, patientId, accountId (portal ownership), branchId, doctorId, date, start, type, visitType, complaint, createdBy, utm, lead, notes }
 */
export async function book(opts) {
  const { staff = false, patientId, accountId, branchId, doctorId, date, start } = opts;

  const patient = await Patient.findOne({ _id: patientId, isActive: true, ...(accountId ? { account: accountId } : {}) });
  if (!patient) throw ApiError.notFound('Patient profile not found');

  const branch = await Branch.findById(branchId).select('code isActive').lean();
  if (!branch?.isActive) throw ApiError.notFound('Branch not found');

  if (!staff && !opts.skipDupCheck) {
    const dup = await Appointment.exists({ patient: patient._id, date, branch: branch._id, status: { $in: ACTIVE_STATUS } });
    if (dup) throw ApiError.conflict('This patient already has an appointment on this date at this branch');
  }

  // the patient's own seat lock (paid booking): book exactly that doctor/seat if still possible
  const own = opts.holdId ? await SlotHold.findOne({ _id: opts.holdId, ...(accountId ? { account: accountId } : {}) }).lean() : null;
  const docId = own ? String(own.doctor) : doctorId;
  const any = !docId || docId === 'any';
  const avail = await availability({ branchId, date, doctorId: any ? null : docId, staff, onlineOnly: !staff, excludeHold: own?._id });

  // candidates: doctors with this slot available, least-booked first
  const candidates = avail
    .map((d) => ({ d, slot: d.slots.find((s) => s.start === start && s.available) }))
    .filter((c) => c.slot)
    .sort((a, b) => a.slot.booked - b.slot.booked);
  if (!candidates.length) throw ApiError.conflict('Selected slot is no longer available');

  for (const { d, slot } of candidates) {
    const appt = await insertWithSeat(
      {
        patient: patient._id,
        account: patient.account,
        branch: branch._id,
        doctor: d.doctor._id,
        date,
        start: slot.start,
        end: slot.end,
        type: opts.type || (staff ? 'phone' : 'online'),
        visitType: opts.visitType || 'new',
        status: staff ? 'confirmed' : 'booked',
        complaint: opts.complaint,
        notes: opts.notes,
        createdBy: opts.createdBy,
        utm: opts.utm,
        lead: opts.lead,
        rescheduledFrom: opts.rescheduledFrom,
      },
      slot.capacity,
      branch.code,
      own && String(own.doctor) === String(d.doctor._id) ? own : null
    );
    if (appt) {
      if (own) await SlotHold.deleteOne({ _id: own._id });
      await linkBranch(patient._id, branch._id);
      appt.reminderJobIds = await notify.scheduleReminders(appt);
      await Appointment.updateOne({ _id: appt._id }, { reminderJobIds: appt.reminderJobIds });
      if (!opts.silent) notify.appointmentEvent('booked', appt);
      return appt;
    }
  }
  throw ApiError.conflict('Selected slot was just taken. Please choose another');
}

export async function cancel(appt, { reason, by }) {
  if (!ACTIVE_STATUS.includes(appt.status)) throw ApiError.badRequest(`Cannot cancel a ${appt.status} appointment`);
  const res = await Appointment.findOneAndUpdate(
    { _id: appt._id, status: { $in: ACTIVE_STATUS } },
    { $set: { status: 'cancelled', cancelReason: reason, cancelledBy: by }, $unset: { slotKey: 1 } },
    { new: true }
  );
  if (!res) throw ApiError.conflict('Appointment already changed');
  await notify.cancelReminders(appt);
  notify.appointmentEvent('cancelled', res);
  return res;
}

export async function reschedule(appt, { date, start, doctorId, staff, createdBy }) {
  if (!['booked', 'confirmed'].includes(appt.status)) throw ApiError.badRequest(`Cannot reschedule a ${appt.status} appointment`);
  const fresh = await book({
    staff,
    patientId: appt.patient,
    branchId: appt.branch,
    doctorId: doctorId || String(appt.doctor),
    date,
    start,
    type: appt.type,
    visitType: appt.visitType,
    complaint: appt.complaint,
    createdBy,
    rescheduledFrom: appt._id,
    silent: true,
    skipDupCheck: true,
  });
  await Appointment.updateOne(
    { _id: appt._id },
    { $set: { status: 'rescheduled', rescheduledTo: fresh._id }, $unset: { slotKey: 1 } }
  );
  await notify.cancelReminders(appt);
  notify.appointmentEvent('rescheduled', fresh);
  return fresh;
}

const TRANSITIONS = {
  booked: ['confirmed', 'checked_in', 'no_show'],
  confirmed: ['checked_in', 'no_show'],
  checked_in: ['in_consultation', 'completed', 'no_show'],
  in_consultation: ['completed'],
};

export async function setStatus(appt, status) {
  if (!(TRANSITIONS[appt.status] || []).includes(status)) {
    throw ApiError.badRequest(`Cannot move from ${appt.status} to ${status}`);
  }
  const set = { status };
  const unset = {};
  if (status === 'checked_in') {
    set.checkedInAt = new Date();
    if (!appt.tokenNo) set.tokenNo = await nextSeq(`token:${appt.branch}:${appt.date}`);
  }
  if (status === 'completed') set.completedAt = new Date();
  if (status === 'no_show') unset.slotKey = 1; // frees capacity for later same-day walk-ins
  const res = await Appointment.findOneAndUpdate(
    { _id: appt._id, status: appt.status },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true }
  );
  if (!res) throw ApiError.conflict('Appointment changed by someone else, refresh');
  if (['no_show', 'completed'].includes(status)) await notify.cancelReminders(appt);
  if (status === 'no_show') notify.appointmentEvent('no_show', res);
  if (status === 'checked_in') {
    await notify.cancelReminders(appt); // patient is here — no "in 2 hours" ping
    notify.appointmentEvent('checked_in', res); // token number on WhatsApp
  }
  return res;
}

/** Walk-in: with slot → normal booking; without → immediate token, no capacity hold. */
export async function walkin({ patientId, branchId, doctorId, start, complaint, visitType, createdBy }) {
  let appt;
  if (start) {
    appt = await book({ staff: true, patientId, branchId, doctorId, date: todayIST(), start, type: 'walkin', visitType, complaint, createdBy, silent: true });
  } else {
    if (!doctorId || doctorId === 'any') throw ApiError.badRequest('Select doctor for walk-in without slot');
    const patient = await Patient.findById(patientId);
    if (!patient) throw ApiError.notFound('Patient not found');
    const branch = await Branch.findById(branchId).select('code').lean();
    const n = nowIST();
    const date = n.date;
    appt = await withTransaction(async (session) => {
      const bookingId = await nextBookingId(branch.code, date, session);
      const [a] = await Appointment.create(
        [{
          bookingId, patient: patient._id, account: patient.account, branch: branchId, doctor: doctorId, date,
          start: toHHMM(n.minutes), end: toHHMM(Math.min(n.minutes + 15, 1439)),
          type: 'walkin', visitType: visitType || 'new', status: 'confirmed', complaint, createdBy,
        }],
        { session }
      );
      return a;
    });
    await linkBranch(patient._id, branchId);
  }
  return setStatus(appt, 'checked_in');
}

/**
 * Lock one seat of a slot for a paying patient (portal). Returns the hold.
 * One active hold per account: a new hold releases the previous one.
 */
export async function createHold({ accountId, patientId, branchId, doctorId, date, start, minutes = HOLD_MINUTES }) {
  const patient = await Patient.findOne({ _id: patientId, isActive: true, account: accountId }).select('_id').lean();
  if (!patient) throw ApiError.notFound('Patient profile not found');
  const dup = await Appointment.exists({ patient: patient._id, date, branch: branchId, status: { $in: ACTIVE_STATUS } });
  if (dup) throw ApiError.conflict('This patient already has an appointment on this date at this branch');
  await SlotHold.deleteMany({ account: accountId });

  const any = !doctorId || doctorId === 'any';
  const avail = await availability({ branchId, date, doctorId: any ? null : doctorId, staff: false, onlineOnly: true });
  const candidates = avail
    .map((d) => ({ d, slot: d.slots.find((s) => s.start === start && s.available) }))
    .filter((c) => c.slot)
    .sort((a, b) => a.slot.booked - b.slot.booked);
  const now = () => new Date();
  for (const { d, slot } of candidates) {
    for (let seat = 1; seat <= slot.capacity; seat++) {
      const key = `${d.doctor._id}|${date}|${slot.start}|${seat}`;
      if (await Appointment.exists({ slotKey: key })) continue;
      let hold = null;
      for (let attempt = 0; attempt < 2 && !hold; attempt++) {
        try {
          hold = await SlotHold.create({ key, branch: branchId, doctor: d.doctor._id, date, start: slot.start, end: slot.end, account: accountId, patient: patient._id, expiresAt: new Date(Date.now() + minutes * 60_000) });
        } catch (e) {
          if (e?.code !== 11000) throw e;
          // an expired lock not yet swept by the TTL monitor → remove it and try once more
          const gone = await SlotHold.deleteOne({ key, expiresAt: { $lte: now() } });
          if (!gone.deletedCount) break;
        }
      }
      if (!hold) continue;
      if (await Appointment.exists({ slotKey: key })) { // booked at the same instant → back off
        await SlotHold.deleteOne({ _id: hold._id });
        continue;
      }
      return hold;
    }
  }
  throw ApiError.conflict('Selected slot was just taken. Please choose another');
}

export const releaseHold = (holdId, accountId) => SlotHold.deleteOne({ _id: holdId, account: accountId });
