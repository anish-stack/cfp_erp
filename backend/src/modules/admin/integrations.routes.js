import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { IntegrationConfig, INTEGRATION_KEYS, KEY_META, cfg, encrypt, decrypt, loadIntegrations, mask, sourceOf } from '../../services/runtimeConfig.js';
import { env } from '../../config/env.js';

/** Admin → Settings → Integrations: storage, SMTP, Exotel, WhatsApp, app name. Secrets are write-only. */
const r = Router();
r.use(auth);

function view(doc) {
  const saved = Object.fromEntries(doc?.values ? Object.entries(doc.values instanceof Map ? Object.fromEntries(doc.values) : doc.values) : []);
  const out = {};
  for (const [group, keys] of Object.entries(INTEGRATION_KEYS)) {
    out[group] = Object.entries(keys).map(([key, m]) => {
      const raw = saved[key] ? (m.secret ? decrypt(saved[key]) : saved[key]) : '';
      const envVal = env[key] === undefined || env[key] === '' ? '' : String(env[key]);
      return {
        key, secret: !!m.secret, options: m.options, number: !!m.number,
        value: m.secret ? '' : raw, // secrets never leave the server
        masked: m.secret ? mask(raw || (sourceOf(key) === 'env' ? envVal : '')) : undefined,
        saved: !!raw,
        envValue: m.secret ? (envVal ? mask(envVal) : '') : envVal,
        source: sourceOf(key),
      };
    });
  }
  return out;
}

r.get('/', permit('settings.manage_settings'), asyncHandler(async (_req, res) => {
  ok(res, view(await IntegrationConfig.findById('global').lean()));
}));

/** values: { KEY: "new value" | "" (secret: keep · plain: clear) | null (clear → .env fallback) } */
r.put('/', permit('settings.manage_settings'), validate({ body: z.object({ values: z.record(z.string().max(2000).nullable()) }) }), asyncHandler(async (req, res) => {
  const doc = (await IntegrationConfig.findById('global')) || new IntegrationConfig({ _id: 'global' });
  const changed = [];
  for (const [k, v] of Object.entries(req.body.values)) {
    const m = KEY_META[k];
    if (!m) throw ApiError.badRequest(`Unknown key ${k}`);
    if (v === null) { if (doc.values.has(k)) { doc.values.delete(k); changed.push(k); } continue; }
    const val = v.trim();
    if (m.secret && val === '') continue; // keep existing secret
    if (m.options && val && !m.options.includes(val)) throw ApiError.badRequest(`${k}: invalid option`);
    if (m.number && val && !/^\d+$/.test(val)) throw ApiError.badRequest(`${k}: must be a number`);
    if (/_URL$/.test(k) && val && !/^https?:\/\/[^\s]+$/.test(val)) throw ApiError.badRequest(`${k}: must be a URL`);
    if (val === '') { if (doc.values.has(k)) { doc.values.delete(k); changed.push(k); } continue; }
    doc.values.set(k, m.secret ? encrypt(val) : val);
    changed.push(k);
  }
  doc.updatedBy = req.user._id;
  await doc.save();
  await loadIntegrations();
  audit(req, { action: 'settings.integrations', entity: 'Settings', meta: { keys: changed } }); // names only, never values
  ok(res, view(doc.toObject()));
}));

/** chat models this Hugging Face token can use right now (for the Model picker) */
r.get('/ai-models', permit('settings.manage_settings'), asyncHandler(async (_req, res) => {
  const { listModels, aiConfigured } = await import('../../services/ai.js');
  if (!aiConfigured()) return ok(res, []);
  ok(res, (await listModels({ force: true }).catch(() => [])).slice(0, 300));
}));

/** connectivity tests */
r.post('/test/:kind', permit('settings.manage_settings'), validate({ params: z.object({ kind: z.enum(['storage', 'smtp', 'exotel', 'whatsapp', 'ai']) }), body: z.object({ to: z.string().max(120).optional() }) }), asyncHandler(async (req, res) => {
  const { kind } = req.params;
  try {
    if (kind === 'storage') {
      const storage = await import('../../services/storage.js');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const s = await storage.put({ buffer: png, mime: 'image/png', ext: '.png', folder: 'test' });
      const head = await fetch(s.url, { method: 'HEAD' }).then((x) => x.status).catch(() => 0);
      await storage.del(s);
      return ok(res, { ok: true, message: `Uploaded to ${s.driver} and deleted. Public URL ${head && head < 400 ? 'reachable' : `NOT publicly reachable (HTTP ${head || 'error'}) — check bucket public access / PUBLIC URL`}.`, driver: s.driver });
    }
    if (kind === 'smtp') {
      const { getMailer, sendEmail } = await import('../../services/channels.js');
      const t = getMailer();
      if (!t) throw new Error('SMTP_HOST not set');
      await t.verify();
      if (req.body.to) await sendEmail({ to: req.body.to, subject: `${cfg.APP_NAME} — SMTP test`, html: '<p>SMTP is working ✅</p>' });
      return ok(res, { ok: true, message: req.body.to ? `Connected and test mail sent to ${req.body.to}` : 'SMTP login OK' });
    }
    if (kind === 'exotel') {
      if (!(cfg.EXOTEL_SID && cfg.EXOTEL_API_KEY && cfg.EXOTEL_API_TOKEN)) throw new Error('SID / API key / API token missing');
      const host = String(cfg.EXOTEL_SUBDOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, '');
      const x = await fetch(`https://${host}/v1/Accounts/${cfg.EXOTEL_SID}.json`, { headers: { Authorization: `Basic ${Buffer.from(`${cfg.EXOTEL_API_KEY}:${cfg.EXOTEL_API_TOKEN}`).toString('base64')}`, Accept: 'application/json' } });
      const j = await x.json().catch(() => ({}));
      if (!x.ok) throw new Error(j?.RestException?.Message || `HTTP ${x.status}`);
      const a = j.Account || j;
      return ok(res, { ok: true, message: `Connected: ${a.FriendlyName || a.Sid || cfg.EXOTEL_SID}${a.Status ? ` (${a.Status})` : ''}${cfg.EXOTEL_CALLER_ID ? '' : ' — set Caller ID (ExoPhone) to place calls'}` });
    }
    if (kind === 'ai') {
      const { chat, lastUsedModel, providerName } = await import('../../services/ai.js');
      const t0 = Date.now();
      const reply = await chat([{ role: 'user', content: 'Reply with the single word: OK' }], { maxTokens: 300, timeoutMs: 45_000 });
      const used = lastUsedModel();
      const note = cfg.HF_MODEL !== 'auto' && used !== cfg.HF_MODEL ? ` (your model "${cfg.HF_MODEL}" is not served by your providers — save "${used}" or "auto" as Model)` : '';
      return ok(res, { ok: true, message: `${providerName()} OK — ${used} replied "${reply.trim().slice(0, 30)}" in ${((Date.now() - t0) / 1000).toFixed(1)}s${note}` });
    }
    if (kind === 'whatsapp') {
      const { sendWapp, wappConfigured, normalizeMobile } = await import('../../services/wapp.js');
      if (!wappConfigured()) throw new Error('WAPP_API_KEY not set');
      const to = normalizeMobile(req.body.to || '');
      if (!to) throw new Error('Enter a 10-digit mobile number to send a test message');
      await sendWapp({ to, msg: `${cfg.APP_NAME}: WhatsApp test message ✅`, event: 'test' });
      return ok(res, { ok: true, message: `Test message sent to ${to}` });
    }
  } catch (e) {
    return ok(res, { ok: false, message: e.message });
  }
  return ok(res, { ok: false, message: 'Unknown test' });
}));

export default r;