import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { cfg } from './runtimeConfig.js';

/**
 * Exotel v1 API.
 *  - connect(): click-to-call. Exotel rings the AGENT first, then bridges to the CUSTOMER, recording both legs.
 *  - Status callback (terminal event) lands on /public/exotel/status with our Call id in CustomField.
 */
export const exotelConfigured = () => Boolean(cfg.EXOTEL_SID && cfg.EXOTEL_API_KEY && cfg.EXOTEL_API_TOKEN && cfg.EXOTEL_CALLER_ID);

const authHeader = () => `Basic ${Buffer.from(`${cfg.EXOTEL_API_KEY}:${cfg.EXOTEL_API_TOKEN}`).toString('base64')}`;
const base = () => `https://${cfg.EXOTEL_SUBDOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')}/v1/Accounts/${cfg.EXOTEL_SID}`;

/** E.164-ish for Exotel: 0XXXXXXXXXX (Indian convention accepted by Exotel) */
export const toExotelNumber = (n) => {
  const d = String(n || '').replace(/\D/g, '');
  const ten = d.length > 10 ? d.slice(-10) : d;
  return /^\d{10}$/.test(ten) ? `0${ten}` : null;
};
export const tenDigits = (n) => {
  const d = String(n || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

export const webhookUrl = (path) => {
  const u = new URL(`${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/public/exotel/${path}`);
  if (cfg.EXOTEL_WEBHOOK_TOKEN) u.searchParams.set('t', cfg.EXOTEL_WEBHOOK_TOKEN);
  return u.toString();
};

export function verifyWebhookToken(t) {
  if (!cfg.EXOTEL_WEBHOOK_TOKEN) return !env.isProd; // dev convenience; prod requires a token
  const a = Buffer.from(String(t || ''));
  const b = Buffer.from(cfg.EXOTEL_WEBHOOK_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Build form body for Calls/connect (exported for tests) */
export function connectBody({ agentPhone, customerPhone, callId, callerId }) {
  const from = toExotelNumber(agentPhone);
  const to = toExotelNumber(customerPhone);
  if (!from) throw ApiError.badRequest('Your staff profile has no valid mobile number — add it in Staff to place calls');
  if (!to) throw ApiError.badRequest('Invalid customer number');
  if (/^0900000\d{4}$/.test(to) || /^0900000\d{4}$/.test(from)) throw ApiError.badRequest('Demo number (90000xxxxx) — not dialled');
  const p = new URLSearchParams();
  p.set('From', from);
  p.set('To', to);
  p.set('CallerId', callerId || cfg.EXOTEL_CALLER_ID);
  p.set('CallType', 'trans');
  p.set('Record', 'true');
  p.set('RecordingChannels', 'dual');
  p.set('TimeLimit', '3600');
  p.set('TimeOut', '45');
  p.set('CustomField', String(callId));
  p.set('StatusCallback', webhookUrl('status'));
  p.set('StatusCallbackEvents[0]', 'terminal');
  p.set('StatusCallbackContentType', 'application/json');
  return p;
}

export async function connect({ agentPhone, customerPhone, callId, callerId }) {
  if (!exotelConfigured()) throw new ApiError(503, 'Exotel is not configured');
  const body = connectBody({ agentPhone, customerPhone, callId, callerId });
  const res = await fetch(`${base()}/Calls/connect.json`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = json?.RestException?.Message || json?.message || `HTTP ${res.status}`;
    if (/kyc/i.test(msg)) msg += ' → Complete KYC in Exotel dashboard (my.exotel.com → Settings → KYC). Calls work automatically once approved.';
    else if (/whitelist|dnd|not allowed/i.test(msg)) msg += ' → On a trial Exotel account, add this number under "Whitelisted numbers" or complete KYC.';
    else if (res.status === 401) msg += ' → Check EXOTEL_API_KEY / EXOTEL_API_TOKEN / EXOTEL_SID in .env.';
    throw new ApiError(res.status === 401 || res.status === 403 ? 502 : 400, `Exotel: ${msg}`);
  }
  return json.Call || json;
}

/** Fetch call details (used to backfill recording/duration if a callback was missed) */
export async function getCall(sid) {
  if (!exotelConfigured()) throw new ApiError(503, 'Exotel is not configured');
  const res = await fetch(`${base()}/Calls/${encodeURIComponent(sid)}.json`, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(502, `Exotel: ${json?.RestException?.Message || res.status}`);
  return json.Call || json;
}

/** Stream a recording. Exotel recording URLs may need account auth; send it only to Exotel hosts. */
export async function fetchRecording(url, range) {
  const u = new URL(url);
  const headers = {};
  if (/(^|\.)exotel\.(com|in)$/.test(u.hostname) && cfg.EXOTEL_API_KEY) headers.Authorization = authHeader();
  if (range) headers.Range = range;
  return fetch(u, { headers, redirect: 'follow' });
}

/** Map Exotel status → CRM call outcome */
export function outcomeFor(status, durationSec) {
  if (status === 'completed' && durationSec > 0) return 'connected';
  if (status === 'busy') return 'busy';
  if (status === 'no-answer' || status === 'canceled') return 'no_answer';
  if (status === 'failed') return 'switched_off';
  if (status === 'completed') return 'no_answer';
  return null;
}

/** Normalise a terminal status callback payload (JSON or form) — pure, exported for tests */
export function parseStatusCallback(b = {}) {
  const legs = Array.isArray(b.Legs) ? b.Legs : [];
  const talk = Number(b.ConversationDuration ?? legs.reduce((m, l) => Math.max(m, Number(l.OnCallDuration) || 0), 0)) || 0;
  const status = String(b.Status || '').toLowerCase().replace('_', '-');
  return {
    sid: b.CallSid,
    callId: b.CustomField,
    status: ['completed', 'busy', 'no-answer', 'failed', 'canceled', 'in-progress', 'ringing', 'queued'].includes(status) ? status : 'failed',
    durationSec: talk,
    recordingUrl: b.RecordingUrl || null,
    startedAt: b.StartTime ? new Date(b.StartTime) : undefined,
    endedAt: b.EndTime || b.DateUpdated ? new Date(b.EndTime || b.DateUpdated) : new Date(),
  };
}

/** Passthru params (inbound IVR) — Exotel sends digits wrapped in quotes */
export function parsePassthru(q = {}) {
  const digits = String(q.digits ?? q.Digits ?? '').replace(/"/g, '').trim();
  const dialStatus = String(q.DialCallStatus || q.CallType || '').toLowerCase();
  return {
    sid: q.CallSid,
    from: tenDigits(q.CallFrom || q.From),
    to: tenDigits(q.CallTo || q.To),
    digits: digits || null,
    recordingUrl: q.RecordingUrl || null,
    durationSec: Number(q.DialCallDuration || q.ConversationDuration || 0) || 0,
    dialWhom: tenDigits(q.DialWhomNumber || ''),
    ended: Boolean(q.RecordingUrl || q.DialCallStatus || /completed|client-hangup|call-attempt/.test(dialStatus)),
    dialStatus,
  };
}
