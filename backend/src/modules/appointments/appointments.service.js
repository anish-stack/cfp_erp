import { withTransaction } from '../../config/db.js';
import { Appointment, ACTIVE_STATUS } from '../../models/Appointment.js';
import { Branch } from '../../models/Branch.js';
import { Patient } from '../../models/Patient.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextBookingId, nextSeq } from '../../utils/counter.js';
import { nowIST, toHHMM, todayIST } from '../../utils/time.js';
import { availability } from '../scheduling/scheduling.service.js';
import { linkBranch } from '../patients/patients.service.js';
import * as notify from '../../services/notify.js';

const isDupSlot = (e) => e?.code === 11000 && (e.keyPattern?.slotKey || /slotKey/.test(e.message));

/** Insert appointment, trying seats 1..capacity. Unique slotKey index makes this race-safe. */
async function insertWithSeat(data, capacity, branchCode) {
  for (let seat = 1; seat <= capacity; seat++) {
    try {
      return await withTransaction(async (session) => {
        const bookingId = await nextBookingId(branchCode, data.date, session);
        const [appt] = await Appointment.create(
          [{ ...data, bookingId, slotKey: `${data.doctor}|${data.date}|${data.start}|${seat}` }],
          { session }
        );
        return appt;
      });
    } catch (e) {
      if (isDupSlot(e)) continue;
      throw e;
    }
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

  const any = !doctorId || doctorId === 'any';
  const avail = await availability({ branchId, date, doctorId: any ? null : doctorId, staff, onlineOnly: !staff });

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
      branch.code
    );
    if (appt) {
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
