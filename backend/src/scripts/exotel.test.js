/* Exotel client + webhook parsers + logo/PDF branding. No DB. Usage: npm run test:exotel */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: new URLSearchParams(body) });
    if (req.url.includes('/Calls/connect.json')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ Call: { Sid: 'abc123sid', Status: 'in-progress' } }));
    }
    if (req.url.includes('/Calls/bad')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ RestException: { Message: 'Authentication failed' } }));
    }
    res.writeHead(404).end();
  });
});
await new Promise((r) => server.listen(0, r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpf-'));

Object.assign(process.env, {
  NODE_ENV: 'test', MONGO_URI: 'mongodb://127.0.0.1:1/none',
  JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), JWT_PATIENT_SECRET: 'c'.repeat(40),
  EXOTEL_SID: 'cpfclinic', EXOTEL_API_KEY: 'KEY', EXOTEL_API_TOKEN: 'TOKEN', EXOTEL_CALLER_ID: '01141234567',
  EXOTEL_SUBDOMAIN: `127.0.0.1:${server.address().port}`, EXOTEL_WEBHOOK_TOKEN: 'w'.repeat(32),
  PUBLIC_API_URL: 'https://api.example.com', UPLOAD_DIR: tmp,
});
// the client always uses https:// — point fetch at our http mock for this test
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(String(u).replace(/^https:\/\/127\.0\.0\.1/, 'http://127.0.0.1'), o);

const ex = await import('../services/exotel.js');
const { detectImage, saveLogo, logoPath } = await import('../services/branding.js');
const { renderInvoicePdf } = await import('../services/pdf.js');
const { computeLine, computeTotals } = await import('../utils/invoiceMath.js');

const results = [];
const t = async (name, fn) => {
  try { await fn(); results.push(['✔', name]); } catch (e) { results.push(['✘', name, e.message]); }
};

await t('number formatting', () => {
  assert.equal(ex.toExotelNumber('+91 98765 43210'), '09876543210');
  assert.equal(ex.toExotelNumber('123'), null);
  assert.equal(ex.tenDigits('09876543210'), '9876543210');
});

await t('connect body (agent first, recorded, status callback with token)', () => {
  const b = ex.connectBody({ agentPhone: '9811111111', customerPhone: '9822222222', callId: '64b7f0c2a1b2c3d4e5f60718' });
  assert.equal(b.get('From'), '09811111111');
  assert.equal(b.get('To'), '09822222222');
  assert.equal(b.get('CallerId'), '01141234567');
  assert.equal(b.get('Record'), 'true');
  assert.equal(b.get('CustomField'), '64b7f0c2a1b2c3d4e5f60718');
  assert.equal(b.get('StatusCallback'), `https://api.example.com/api/v1/public/exotel/status?t=${'w'.repeat(32)}`);
  assert.equal(b.get('StatusCallbackEvents[0]'), 'terminal');
});

await t('connect body rejects missing agent phone / demo numbers', () => {
  assert.throws(() => ex.connectBody({ agentPhone: '', customerPhone: '9822222222', callId: 'x' }), /no valid mobile/);
  assert.throws(() => ex.connectBody({ agentPhone: '9811111111', customerPhone: '9000005001', callId: 'x' }), /Demo number/);
});

await t('connect() hits Calls/connect.json with Basic auth', async () => {
  const call = await ex.connect({ agentPhone: '9811111111', customerPhone: '9822222222', callId: 'abc' });
  assert.equal(call.Sid, 'abc123sid');
  const req = seen.at(-1);
  assert.equal(req.method, 'POST');
  assert.ok(req.url.endsWith('/v1/Accounts/cpfclinic/Calls/connect.json'));
  assert.equal(req.auth, `Basic ${Buffer.from('KEY:TOKEN').toString('base64')}`);
  assert.equal(req.body.get('To'), '09822222222');
});

await t('webhook token check (timing-safe)', () => {
  assert.equal(ex.verifyWebhookToken('w'.repeat(32)), true);
  assert.equal(ex.verifyWebhookToken('w'.repeat(31)), false);
  assert.equal(ex.verifyWebhookToken(undefined), false);
});

await t('status callback parse + outcome', () => {
  const p = ex.parseStatusCallback({ CallSid: 's1', Status: 'completed', ConversationDuration: '95', RecordingUrl: 'https://recordings.exotel.com/x.mp3', CustomField: 'id1' });
  assert.deepEqual([p.sid, p.status, p.durationSec, p.callId], ['s1', 'completed', 95, 'id1']);
  assert.equal(ex.outcomeFor(p.status, p.durationSec), 'connected');
  const legs = ex.parseStatusCallback({ CallSid: 's2', Status: 'completed', Legs: [{ OnCallDuration: 0 }, { OnCallDuration: 42 }] });
  assert.equal(legs.durationSec, 42);
  assert.equal(ex.outcomeFor('completed', 0), 'no_answer');
  assert.equal(ex.outcomeFor('busy', 0), 'busy');
  assert.equal(ex.outcomeFor('no-answer', 0), 'no_answer');
  assert.equal(ex.parseStatusCallback({ Status: 'weird' }).status, 'failed');
});

await t('passthru parse (quoted digits, end detection)', () => {
  const start = ex.parsePassthru({ CallSid: 'in1', CallFrom: '09876543210', CallTo: '01141234567', digits: '"2"' });
  assert.deepEqual([start.from, start.digits, start.ended], ['9876543210', '2', false]);
  const end = ex.parsePassthru({ CallSid: 'in1', CallFrom: '09876543210', DialCallStatus: 'completed', DialCallDuration: '61', RecordingUrl: 'https://r/x.mp3', DialWhomNumber: '09811111111' });
  assert.deepEqual([end.ended, end.durationSec, end.dialWhom], [true, 61, '9811111111']);
});

// ---- logo + PDF
const crc32 = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function makePng(w, h) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const inCross = Math.abs(x - w / 2) < w / 8 || Math.abs(y - h / 2) < h / 8; raw[o] = inCross ? 255 : 19; raw[o + 1] = inCross ? 255 : 122; raw[o + 2] = inCross ? 255 : 111; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const png = makePng(64, 64);

await t('logo type detection + save', () => {
  assert.equal(detectImage(png), 'png');
  assert.equal(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(detectImage(Buffer.from('<svg></svg>')), null);
  const name = saveLogo(png);
  assert.ok(logoPath(name));
  assert.throws(() => saveLogo(Buffer.from('GIF89a')), /PNG or JPG/);
});

await t('invoice PDF renders with logo', async () => {
  const items = [{ description: 'Kshar Sutra Therapy', qty: 1, rate: 18000, gstRate: 0 }, { description: 'Jatyadi Taila 100 ml', qty: 2, rate: 210, gstRate: 12 }].map((i) => ({ ...i, ...computeLine(i, true) }));
  const inv = { invoiceNo: 'ROH/INV/2627/000001', status: 'paid', createdAt: new Date(), items, ...computeTotals(items), paid: 18420, refunded: 0, balance: 0, taxInclusive: true, branch: { name: 'Rohini', phone: '9870365644', address: { line1: 'A1/30, Sector-15', city: 'Rohini, Delhi' } }, patient: { name: 'Demo Patient', patientId: 'CPF-000001', mobile: '9000001000', gender: 'male', ageYears: 40 }, createdBy: { name: 'Reception' } };
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => out.on('end', r));
  renderInvoicePdf(inv, { clinic: { name: 'Centre For Piles & Fistula', tagline: 'Ayurvedic Kshar Sutra & Laser care' }, footer: 'Get well soon', logo: png, color: '#137a6f' }, out);
  await done;
  const pdf = Buffer.concat(chunks);
  fs.writeFileSync(path.join(tmp, 'invoice-logo.pdf'), pdf);
  assert.ok(pdf.subarray(0, 4).toString() === '%PDF');
  assert.ok(pdf.includes('/Subtype /Image'), 'logo image embedded');
  process.env.CPF_TEST_PDF = path.join(tmp, 'invoice-logo.pdf');
});

server.close();
for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✘').length;
console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
if (process.env.CPF_TEST_PDF) console.log(`sample PDF: ${process.env.CPF_TEST_PDF}`);
process.exit(failed ? 1 : 0);
