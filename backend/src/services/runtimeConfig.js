import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Integration settings editable from Admin → Settings → Integrations.
 * Values saved in Mongo override .env; empty → .env fallback. Secrets are AES-256-GCM encrypted at rest
 * and never sent back to the browser. `cfg.X` is synchronous (in-memory, refreshed every 30 s + on save).
 */
export const INTEGRATION_KEYS = {
  general: { APP_NAME: {} },
  storage: {
    STORAGE_DRIVER: { options: ['auto', 'local', 's3', 'r2', 'cloudinary'] },
    S3_BUCKET: {}, S3_REGION: {}, S3_ACCESS_KEY_ID: { secret: true }, S3_SECRET_ACCESS_KEY: { secret: true }, S3_ENDPOINT: {}, S3_PUBLIC_URL: {},
    R2_ACCOUNT_ID: {}, R2_BUCKET: {}, R2_ACCESS_KEY_ID: { secret: true }, R2_SECRET_ACCESS_KEY: { secret: true }, R2_PUBLIC_URL: {},
    CLOUDINARY_CLOUD_NAME: {}, CLOUDINARY_API_KEY: { secret: true }, CLOUDINARY_API_SECRET: { secret: true }, CLOUDINARY_FOLDER: {},
  },
  smtp: { SMTP_HOST: {}, SMTP_PORT: { number: true }, SMTP_USER: {}, SMTP_PASS: { secret: true }, SMTP_FROM: {}, ALERT_EMAILS: {} },
  exotel: { EXOTEL_SID: {}, EXOTEL_API_KEY: { secret: true }, EXOTEL_API_TOKEN: { secret: true }, EXOTEL_SUBDOMAIN: { options: ['api.exotel.com', 'api.in.exotel.com'] }, EXOTEL_CALLER_ID: {}, EXOTEL_WEBHOOK_TOKEN: { secret: true } },
  whatsapp: { WAPP_API_URL: {}, WAPP_API_KEY: { secret: true }, WAPP_COUNTRY: {} },
  razorpay: { RAZORPAY_KEY_ID: {}, RAZORPAY_KEY_SECRET: { secret: true }, RAZORPAY_WEBHOOK_SECRET: { secret: true } },
  ai: { AI_PROVIDER: { options: ['huggingface', 'groq', 'gemini', 'openrouter', 'custom'] }, HF_TOKEN: { secret: true }, HF_MODEL: {}, HF_API_URL: {} },
};
export const KEY_META = Object.fromEntries(Object.entries(INTEGRATION_KEYS).flatMap(([group, keys]) => Object.entries(keys).map(([k, m]) => [k, { ...m, group }])));

// ---------------------------------------------------------------- storage model
const schema = new mongoose.Schema({ _id: { type: String, default: 'global' }, values: { type: Map, of: String, default: {} }, updatedBy: mongoose.Schema.Types.ObjectId }, { timestamps: true });
export const IntegrationConfig = mongoose.models.IntegrationConfig || mongoose.model('IntegrationConfig', schema);

// ---------------------------------------------------------------- crypto
const KEY = crypto.createHash('sha256').update(env.CONFIG_SECRET || env.JWT_REFRESH_SECRET).digest();
export const encrypt = (plain) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
};
export const decrypt = (v) => {
  if (!String(v).startsWith('enc:v1:')) return v;
  try {
    const [, , iv, tag, data] = v.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    logger.error('Integration secret could not be decrypted (CONFIG_SECRET / JWT_REFRESH_SECRET changed?) — re-enter it in Settings');
    return '';
  }
};

// ---------------------------------------------------------------- live values
let overrides = {};
const listeners = new Set();
export const onConfigChange = (fn) => listeners.add(fn);

export const cfg = new Proxy({}, {
  get: (_t, k) => {
    const o = overrides[k];
    if (o !== undefined && o !== '') return KEY_META[k]?.number ? Number(o) : o;
    return env[k];
  },
});
/** where a key's effective value comes from */
export const sourceOf = (k) => (overrides[k] ? 'settings' : env[k] !== undefined && env[k] !== '' ? 'env' : 'none');

export async function loadIntegrations() {
  if (mongoose.connection.readyState !== 1) return;
  const doc = await IntegrationConfig.findById('global').lean();
  const next = {};
  for (const [k, v] of Object.entries(doc?.values || {})) if (KEY_META[k] && v) next[k] = KEY_META[k].secret ? decrypt(v) : v;
  const changed = JSON.stringify(next) !== JSON.stringify(overrides);
  overrides = next;
  if (changed) listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}

let timer;
export async function startConfigRefresh() {
  await loadIntegrations().catch((e) => logger.error({ err: e.message }, 'integration config load failed'));
  timer ||= setInterval(() => loadIntegrations().catch(() => {}), 30_000);
  timer.unref?.();
}

export const mask = (v) => (!v ? '' : v.length <= 6 ? '••••' : `••••${v.slice(-4)}`);
