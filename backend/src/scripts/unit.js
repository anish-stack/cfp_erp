/* Pure-logic unit tests (no DB). Usage: npm run test:unit */
import assert from 'node:assert/strict';
import { generateSlots } from '../utils/slots.js';
import { computeLine, computeTotals, statusFor } from '../utils/invoiceMath.js';
import { nowIST, istToDate, weekdayOf, addDays } from '../utils/time.js';
import { toCsv } from '../utils/csv.js';

const results = [];
const t = (name, fn) => {
  try {
    fn();
    results.push(['✔', name]);
  } catch (e) {
    results.push(['✘', name, e.message]);
  }
};

const branch = { settings: { slotMinutes: 15, gapMinutes: 0, breaks: [{ start: '14:00', end: '15:00' }], weeklyOff: [0], minLeadMinutes: 30 } };
const sched = { sessions: [{ start: '10:00', end: '12:00' }, { start: '13:30', end: '16:00' }], capacityPerSlot: 1 };
const FUTURE = '2030-01-07'; // Monday
const SUNDAY = '2030-01-06';
const past = new Date('2026-01-01T00:00:00Z');

t('time helpers', () => {
  assert.equal(weekdayOf(FUTURE), 1);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(istToDate('2026-10-31', '10:00').toISOString(), '2026-10-31T04:30:00.000Z');
  assert.deepEqual(nowIST(new Date('2026-10-31T20:00:00Z')), { date: '2026-11-01', minutes: 90 });
});

t('slots: sessions minus break', () => {
  const r = generateSlots({ date: FUTURE, branch, schedule: sched, now: past });
  assert.equal(r.closed, false);
  const starts = r.slots.map((s) => s.start);
  assert.equal(starts[0], '10:00');
  assert.ok(starts.includes('11:45') && !starts.includes('12:00'));
  assert.ok(starts.includes('13:30') && starts.includes('13:45'));
  assert.ok(!starts.includes('14:00') && !starts.includes('14:45'));
  assert.ok(starts.includes('15:00') && starts.includes('15:45'));
  assert.equal(r.slots.length, 8 + 2 + 4);
});

t('slots: gap minutes', () => {
  const r = generateSlots({ date: FUTURE, branch: { settings: { ...branch.settings, breaks: [], gapMinutes: 5 } }, schedule: { sessions: [{ start: '10:00', end: '11:00' }] }, now: past });
  assert.deepEqual(r.slots.map((s) => s.start), ['10:00', '10:20', '10:40']);
});

t('slots: weekly off closes, special day opens', () => {
  assert.equal(generateSlots({ date: SUNDAY, branch, schedule: sched, now: past }).closed, true);
  const r = generateSlots({ date: SUNDAY, branch, schedule: null, exceptions: [{ type: 'special_day', doctor: null, sessions: [{ start: '09:00', end: '10:00' }] }], now: past });
  assert.equal(r.closed, false);
  assert.equal(r.slots.length, 4);
});

t('slots: holiday + full leave + partial leave + block', () => {
  assert.equal(generateSlots({ date: FUTURE, branch, schedule: sched, exceptions: [{ type: 'holiday', doctor: null, sessions: [] }], now: past }).reason, 'Holiday');
  assert.equal(generateSlots({ date: FUTURE, branch, schedule: sched, doctorId: 'D1', exceptions: [{ type: 'leave', doctor: 'D1', sessions: [] }], now: past }).closed, true);
  assert.equal(generateSlots({ date: FUTURE, branch, schedule: sched, doctorId: 'D2', exceptions: [{ type: 'leave', doctor: 'D1', sessions: [] }], now: past }).closed, false);
  const partial = generateSlots({ date: FUTURE, branch, schedule: sched, doctorId: 'D1', exceptions: [{ type: 'leave', doctor: 'D1', sessions: [{ start: '10:00', end: '11:00' }] }], now: past });
  assert.ok(!partial.slots.some((s) => s.start < '11:00' && s.start >= '10:00'));
  const blocked = generateSlots({ date: FUTURE, branch, schedule: sched, doctorId: 'D1', exceptions: [{ type: 'block', doctor: null, sessions: [{ start: '15:00', end: '15:30' }] }], now: past });
  assert.ok(!blocked.slots.some((s) => ['15:00', '15:15'].includes(s.start)));
  const rejected = generateSlots({ date: FUTURE, branch, schedule: sched, doctorId: 'D1', exceptions: [{ type: 'leave', doctor: 'D1', sessions: [], status: 'rejected' }], now: past });
  assert.equal(rejected.closed, false);
});

t('slots: capacity + booked', () => {
  const r = generateSlots({ date: FUTURE, branch, schedule: { ...sched, capacityPerSlot: 2 }, booked: { '10:00': 2, '10:15': 1 }, now: past });
  const a = r.slots.find((s) => s.start === '10:00');
  const b = r.slots.find((s) => s.start === '10:15');
  assert.equal(a.available, false);
  assert.equal(b.available, true);
  assert.equal(b.remaining, 1);
});

t('slots: lead time today (patient vs staff)', () => {
  // 10:20 IST on FUTURE date
  const now = istToDate(FUTURE, '10:20');
  const pat = generateSlots({ date: FUTURE, branch, schedule: sched, now });
  assert.equal(pat.slots.find((s) => s.start === '10:45').available, false); // < 10:50
  assert.equal(pat.slots.find((s) => s.start === '11:00').available, true);
  const staff = generateSlots({ date: FUTURE, branch, schedule: sched, now, ignoreLeadTime: true });
  assert.equal(staff.slots.find((s) => s.start === '10:15').available, true); // ends 10:30 > now
  assert.equal(staff.slots.find((s) => s.start === '10:00').available, false); // ended 10:15
});

t('slots: past date unavailable', () => {
  const r = generateSlots({ date: FUTURE, branch, schedule: sched, now: new Date('2031-01-01T00:00:00Z') });
  assert.ok(r.slots.every((s) => !s.available));
});

t('invoice: GST inclusive', () => {
  const l = computeLine({ qty: 1, rate: 112, gstRate: 12 }, true);
  assert.equal(l.taxable, 100);
  assert.equal(l.cgst, 6);
  assert.equal(l.sgst, 6);
  assert.equal(l.total, 112);
});

t('invoice: GST exclusive + discount', () => {
  const l = computeLine({ qty: 2, rate: 100, discountPct: 10, gstRate: 18 }, false);
  assert.equal(l.discountAmt, 20);
  assert.equal(l.taxable, 180);
  assert.equal(l.cgst, 16.2);
  assert.equal(l.total, 212.4);
});

t('invoice: totals rounding', () => {
  const lines = [computeLine({ qty: 1, rate: 99.5, gstRate: 5 }, true), computeLine({ qty: 3, rate: 33.33, gstRate: 12 }, true), { ...computeLine({ qty: 1, rate: 500, gstRate: 0 }, true) }];
  const tot = computeTotals(lines);
  assert.equal(Number.isInteger(tot.grandTotal), true);
  assert.ok(Math.abs(tot.roundOff) <= 0.5);
  assert.equal(tot.grandTotal, Math.round(99.5 + 99.99 + 500));
});

t('invoice: status', () => {
  assert.equal(statusFor({ grandTotal: 100, paid: 0 }), 'unpaid');
  assert.equal(statusFor({ grandTotal: 100, paid: 40 }), 'partial');
  assert.equal(statusFor({ grandTotal: 100, paid: 100 }), 'paid');
  assert.equal(statusFor({ grandTotal: 100, paid: 100, refunded: 30 }), 'partially_refunded');
  assert.equal(statusFor({ grandTotal: 100, paid: 100, refunded: 100 }), 'refunded');
});

t('csv: escaping + injection guard', () => {
  const out = toCsv([{ a: 'x,y', b: '=SUM(A1)', c: { d: 'q"r' } }], [['A', 'a'], ['B', 'b'], ['C', 'c.d']]);
  assert.ok(out.includes('"x,y"'));
  assert.ok(out.includes("'=SUM(A1)"));
  assert.ok(out.includes('"q""r"'));
});

for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✘').length;
console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
