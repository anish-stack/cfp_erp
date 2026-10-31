/* Smoke check without MongoDB: boots app, verifies guards/validation/catalog. Usage: npm run check */
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:1/none';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(40);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(40);
process.env.JWT_PATIENT_SECRET ||= 'z'.repeat(40);

const assert = (await import('node:assert/strict')).default;
const mongoose = (await import('mongoose')).default;
mongoose.set('bufferCommands', false); // fail fast instead of hanging without DB
const { buildApp } = await import('../app.js');
const { ALL_PERMISSIONS, DEFAULT_ROLES, isValidPermission } = await import('../constants/permissions.js');
const { signPatient } = await import('../utils/tokens.js');

const server = buildApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const t = async (name, fn) => {
  try { await fn(); results.push(['✔', name]); } catch (e) { results.push(['✘', name, e.message]); }
};

await t('permission catalog', () => {
  assert.equal(ALL_PERMISSIONS.length, 26 * 9);
  for (const r of DEFAULT_ROLES) for (const p of r.permissions) assert.ok(isValidPermission(p), `${r.slug}:${p}`);
});
await t('health', async () => assert.equal((await call('GET', '/health')).status, 200));
await t('404 unknown route', async () => assert.equal((await call('GET', '/api/v1/nope')).status, 404));
await t('staff route w/o token → 401', async () => assert.equal((await call('GET', '/api/v1/staff')).status, 401));
await t('roles w/o token → 401', async () => assert.equal((await call('GET', '/api/v1/roles')).status, 401));
await t('bad bearer → 401', async () => assert.equal((await call('GET', '/api/v1/patients', null, { authorization: 'Bearer abc' })).status, 401));
await t('patient token on staff route → 401', async () => {
  const tok = signPatient({ _id: new mongoose.Types.ObjectId(), tokenVersion: 0 });
  assert.equal((await call('GET', '/api/v1/staff/me', null, { authorization: `Bearer ${tok}` })).status, 401);
});
await t('login validation → 400', async () => {
  const r = await call('POST', '/api/v1/auth/staff/login', { login: 'a' });
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.body.details));
});
await t('otp invalid mobile → 400', async () => assert.equal((await call('POST', '/api/v1/auth/patient/otp/send', { mobile: '12345' })).status, 400));
await t('otp verify non-6-digit → 400', async () => assert.equal((await call('POST', '/api/v1/auth/patient/otp/verify', { mobile: '9876543210', otp: '12' })).status, 400));
await t('refresh without cookie → 401', async () => assert.equal((await call('POST', '/api/v1/auth/staff/refresh')).status, 401));

server.close();
for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✘').length;
console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
