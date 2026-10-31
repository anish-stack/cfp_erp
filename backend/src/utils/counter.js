import dayjs from 'dayjs';
import { Counter } from '../models/Counter.js';

export async function nextSeq(key, session) {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );
  return doc.seq;
}

const pad = (n, w) => String(n).padStart(w, '0');

/** CPF-000123 — global patient id */
export async function nextPatientId(session) {
  return `CPF-${pad(await nextSeq('patient', session), 6)}`;
}

/** ROH-261031-0007 — booking id per branch per day */
export async function nextBookingId(branchCode, date, session) {
  const d = dayjs(date).format('YYMMDD');
  const seq = await nextSeq(`booking:${branchCode}:${d}`, session);
  return `${branchCode}-${d}-${pad(seq, 4)}`;
}

/** ROH/INV/2627/000045 — invoice no per branch per FY */
export async function nextDocNo(prefix, branchCode, session) {
  const now = dayjs();
  const fyStart = now.month() >= 3 ? now.year() : now.year() - 1;
  const fy = `${String(fyStart).slice(2)}${String(fyStart + 1).slice(2)}`;
  const seq = await nextSeq(`${prefix}:${branchCode}:${fy}`, session);
  return `${branchCode}/${prefix}/${fy}/${pad(seq, 6)}`;
}
