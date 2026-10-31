/** Clinic runs on IST. All dates 'YYYY-MM-DD', times 'HH:mm' in IST, independent of server TZ. */
const IST_OFFSET_MIN = 330;

export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Current IST date + minutes-of-day */
export function nowIST(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  return { date: ist.toISOString().slice(0, 10), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

export const todayIST = () => nowIST().date;

/** weekday 0=Sun for YYYY-MM-DD */
export const weekdayOf = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000);

/** IST date + HH:mm → JS Date (UTC instant) */
export const istToDate = (ymd, hhmm) => new Date(new Date(`${ymd}T${hhmm}:00Z`).getTime() - IST_OFFSET_MIN * 60_000);

export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/** IST day range as UTC Dates for createdAt queries */
export const istDayRange = (ymd) => ({ $gte: istToDate(ymd, '00:00'), $lt: istToDate(addDays(ymd, 1), '00:00') });
