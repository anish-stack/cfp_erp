import { toMin, toHHMM, weekdayOf, overlaps, nowIST } from './time.js';

/**
 * Pure slot generator for ONE doctor at ONE branch on ONE date.
 * @param {object} p
 *  date            'YYYY-MM-DD'
 *  branch          { settings: { slotMinutes, gapMinutes, breaks[], weeklyOff[], minLeadMinutes } }
 *  schedule        DoctorSchedule for weekday or null
 *  exceptions      ScheduleException[] for that date (already filtered to branch/global + doctor)
 *  doctorId        string
 *  booked          { 'HH:mm': count } active appointments
 *  now             Date (for lead-time cut-off)
 *  ignoreLeadTime  staff bookings may skip lead-time
 * @returns {{ closed: boolean, reason?: string, slots: Array<{start,end,capacity,booked,remaining,available}> }}
 */
export function generateSlots({ date, branch, schedule, exceptions = [], doctorId, booked = {}, now = new Date(), ignoreLeadTime = false }) {
  const s = branch.settings || {};
  const weekday = weekdayOf(date);
  const did = doctorId ? String(doctorId) : null;
  const isDoc = (e) => e.doctor && String(e.doctor) === did;
  const isBranchWide = (e) => !e.doctor;

  const holiday = exceptions.find((e) => e.type === 'holiday' && isBranchWide(e));
  if (holiday) return { closed: true, reason: holiday.reason || 'Holiday', slots: [] };

  const fullLeave = exceptions.find((e) => e.type === 'leave' && isDoc(e) && e.status !== 'rejected' && !e.sessions?.length);
  if (fullLeave) return { closed: true, reason: 'Doctor on leave', slots: [] };

  // special day: doctor-specific beats branch-wide
  const special =
    exceptions.find((e) => e.type === 'special_day' && isDoc(e)) || exceptions.find((e) => e.type === 'special_day' && isBranchWide(e));

  let sessions;
  if (special) sessions = special.sessions;
  else {
    if ((s.weeklyOff || []).includes(weekday)) return { closed: true, reason: 'Weekly off', slots: [] };
    if (!schedule || schedule.isActive === false || !schedule.sessions?.length) {
      return { closed: true, reason: 'Doctor not available', slots: [] };
    }
    sessions = schedule.sessions;
  }
  if (!sessions?.length) return { closed: true, reason: 'No sessions', slots: [] };

  const slotMin = schedule?.slotMinutes || s.slotMinutes || 15;
  const gapMin = schedule?.gapMinutes ?? s.gapMinutes ?? 0;
  const capacity = schedule?.capacityPerSlot || 1;

  const blocked = [
    ...(special ? [] : (s.breaks || []).map((b) => [toMin(b.start), toMin(b.end)])),
    ...exceptions
      .filter((e) => (e.type === 'block' && (isBranchWide(e) || isDoc(e))) || (e.type === 'leave' && isDoc(e) && e.status !== 'rejected'))
      .flatMap((e) => e.sessions.map((w) => [toMin(w.start), toMin(w.end)])),
  ];

  const n = nowIST(now);
  const past = date < n.date;
  const isToday = n.date === date;
  // patients: start must be ≥ now + lead time. staff: slot must not have ended yet.
  const tooLateAt = (t) => past || (isToday && (ignoreLeadTime ? t + slotMin <= n.minutes : t < n.minutes + (s.minLeadMinutes ?? 0)));

  const slots = [];
  const seen = new Set();
  for (const sess of [...sessions].sort((a, b) => a.start.localeCompare(b.start))) {
    const end = toMin(sess.end);
    for (let t = toMin(sess.start); t + slotMin <= end; t += slotMin + gapMin) {
      const st = toHHMM(t);
      if (seen.has(st)) continue;
      seen.add(st);
      if (blocked.some(([a, b]) => overlaps(t, t + slotMin, a, b))) continue;
      const b = booked[st] || 0;
      const tooLate = tooLateAt(t);
      slots.push({
        start: st,
        end: toHHMM(t + slotMin),
        capacity,
        booked: b,
        remaining: Math.max(0, capacity - b),
        available: !tooLate && b < capacity,
      });
    }
  }
  return { closed: false, slots, slotMinutes: slotMin, capacity };
}
