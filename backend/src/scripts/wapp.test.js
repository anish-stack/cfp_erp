/* WhatsApp (sms4power WAPP) client + messages + signed links. No DB needed. Usage: npm run test:wapp */
import http from 'node:http';
import assert from 'node:assert/strict';

const calls = [];
let mode = 'ok';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  calls.push(Object.fromEntries(u.searchParams));
  if (mode === 'drop') return req.socket.destroy();
  const code = { ok: 200, badkey: 501, balance: 502, nowa: 505 }[mode];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(code === 200
    ? { status: 'success', msg: 'submitted successfully', statuscode: 200, requestid: 'REQ123', msgcount: 1, msgcost: 1, balance: 500 }
    : { status: 'error', msg: 'error', statuscode: code }));
});
await new Promise((r) => server.listen(0, r));

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URI: 'mongodb://127.0.0.1:1/none',
  JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), JWT_PATIENT_SECRET: 'c'.repeat(40),
  WAPP_API_URL: `http://127.0.0.1:${server.address().port}/wapp/v2/api/send`,
  WAPP_API_KEY: 'TESTKEY',
  PUBLIC_API_URL: 'https://api.example.com',
  DOC_LINK_SECRET: 'z'.repeat(48),
});
const mongoose = (await import('mongoose')).default;
mongoose.set('bufferCommands', false); // NotificationLog writes fail fast (caught)
const { sendWapp, buildUrl, normalizeMobile } = await import('../services/wapp.js');
const { M } = await import('../services/messages.js');
const { signDocLink, verifyDocLink } = await import('../utils/signedLink.js');

const results = [];
const t = async (name, fn) => {
  try { await fn(); results.push(['✔', name]); } catch (e) { results.push(['✘', name, e.message]); }
};
const ctx = { clinic: { name: 'Centre for Piles & Fistula' }, bookingUrl: 'https://appointment.example.com' };
const branch = { name: 'Rohini', phone: '01145678900', address: { line1: 'Sector 7', city: 'Delhi', mapUrl: 'https://maps.app/x' } };
const appt = { bookingId: 'ROH-261101-0001', date: '2026-11-01', start: '17:30', tokenNo: 7, patient: { name: 'Ramesh Kumar', mobile: '9876543210' }, doctor: { name: 'Dr. Anil' }, branch };

await t('normalizeMobile', () => {
  assert.equal(normalizeMobile('+91 98765-43210'), '9876543210');
  assert.equal(normalizeMobile('919876543210'), '9876543210');
  assert.equal(normalizeMobile('12345'), null);
  assert.equal(normalizeMobile('5876543210'), null);
});

await t('buildUrl params', () => {
  const u = buildUrl({ mobile: '9876543210', msg: 'hi & bye', pdf: 'https://x/y.pdf' });
  assert.equal(u.searchParams.get('apikey'), 'TESTKEY');
  assert.equal(u.searchParams.get('mobile'), '9876543210');
  assert.equal(u.searchParams.get('msg'), 'hi & bye');
  assert.equal(u.searchParams.get('pdf'), 'https://x/y.pdf');
  assert.equal(u.searchParams.get('country'), 'IN');
  assert.equal(buildUrl({ mobile: '9876543210', msg: 'x'.repeat(5000) }).searchParams.get('msg').length, 4000);
});

await t('send success', async () => {
  mode = 'ok';
  const r = await sendWapp({ to: '+91 9876543210', msg: M.booked({ a: appt }, ctx), event: 'appointment.booked' });
  assert.equal(r.requestid, 'REQ123');
  const c = calls.at(-1);
  assert.equal(c.mobile, '9876543210');
  assert.ok(c.msg.includes('ROH-261101-0001') && c.msg.includes('5:30 PM'));
});

await t('send with PDF link', async () => {
  const link = signDocLink('invoice', '64b7f0c2a1b2c3d4e5f60718');
  await sendWapp({ to: '9876543210', msg: 'invoice', pdf: link });
  assert.equal(calls.at(-1).pdf, link);
});

await t('invalid mobile skipped (no API call)', async () => {
  const n = calls.length;
  const r = await sendWapp({ to: '12345', msg: 'x' });
  assert.equal(r.skipped, true);
  assert.equal(calls.length, n);
});

await t('501/502/505 → permanent errors', async () => {
  for (const [m, code] of [['badkey', 501], ['balance', 502], ['nowa', 505]]) {
    mode = m;
    await assert.rejects(sendWapp({ to: '9876543210', msg: 'x' }), (e) => e.code === code && e.permanent === true);
  }
});

await t('network failure → retryable error', async () => {
  mode = 'drop';
  await assert.rejects(sendWapp({ to: '9876543210', msg: 'x' }), (e) => e.permanent === false);
  mode = 'ok';
});

await t('blank message rejected', async () => {
  await assert.rejects(sendWapp({ to: '9876543210', msg: '  ' }), (e) => e.code === 504);
});

await t('signed links verify + tamper + expiry', () => {
  const id = '64b7f0c2a1b2c3d4e5f60718';
  const u = new URL(signDocLink('rx', id));
  assert.ok(u.pathname.endsWith(`/public/docs/rx/${id}.pdf`));
  const e = u.searchParams.get('e');
  const s = u.searchParams.get('s');
  assert.equal(verifyDocLink('rx', id, e, s), true);
  assert.equal(verifyDocLink('invoice', id, e, s), false); // type swapped
  assert.equal(verifyDocLink('rx', '64b7f0c2a1b2c3d4e5f60719', e, s), false); // id swapped
  assert.equal(verifyDocLink('rx', id, String(Number(e) + 10), s), false); // expiry extended
  assert.equal(verifyDocLink('rx', id, String(Math.floor(Date.now() / 1000) - 5), s), false);
});

await t('messages render key facts', () => {
  assert.ok(M.otp({ otp: '123456', minutes: 5 }, ctx).includes('*123456*'));
  assert.ok(M.checkedIn({ a: appt }, ctx).includes('*7*'));
  assert.ok(M.reminder({ a: appt, label: '2h' }, ctx).includes('in 2 hours'));
  assert.ok(M.cancelled({ a: { ...appt, cancelReason: 'Patient request' } }, ctx).includes('Patient request'));
  const rx = M.prescription({ rx: { rxNo: 'ROH/RX/2627/000001', patient: { name: 'Ramesh' }, doctor: { name: 'Dr. Anil' }, items: [{ name: 'Tab X', dose: '1 tab', frequency: '1-0-1', duration: '5 days' }], followUpDate: '2026-11-10' } }, ctx);
  assert.ok(rx.includes('Tab X — 1 tab, 1-0-1, × 5 days') && rx.includes('Follow-up'));
  const inv = M.invoice({ inv: { invoiceNo: 'ROH/INV/2627/000009', grandTotal: 860, paid: 500, balance: 360, patient: { name: 'Ramesh' }, branch } }, ctx);
  assert.ok(inv.includes('₹860') && inv.includes('Balance due: *₹360*'));
  assert.ok(!M.welcome({ patient: { name: 'Sita', patientId: 'CPF-000002', relation: 'self' } }, ctx).includes('(self)'));
  assert.ok(M.stockAlert({ branch, low: [{ product: { name: 'Gel', reorderLevel: 10 }, qty: 2 }], expiring: [] }).includes('Gel: 2'));
});

server.close();
for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✘').length;
console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
