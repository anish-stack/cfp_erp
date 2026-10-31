import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { NotificationLog } from '../models/Misc.js';
import { cfg } from './runtimeConfig.js';

/** sms4power WAPP status codes */
export const WAPP_CODES = {
  200: 'success',
  501: 'Invalid API Key',
  502: 'Insufficient Balance',
  504: 'Message must not be blank',
  505: 'No Active WA Number Found',
  506: 'Max 5000 Number Allowed',
  507: 'No Valid Number Found',
};
// configuration / account problems — retrying won't help
const PERMANENT = new Set([501, 502, 504, 505, 506, 507]);

export class WappError extends Error {
  constructor(message, code, permanent) {
    super(message);
    this.code = code;
    this.permanent = permanent;
  }
}

export const wappConfigured = () => Boolean(cfg.WAPP_API_KEY);

const MAX_LEN = 4000;
/** 9000000000–9000009999 is reserved for demo data (seed:demo) and never messaged */
export const isDemoNumber = (ten) => /^900000\d{4}$/.test(ten);

export const normalizeMobile = (m) => {
  const d = String(m || '').replace(/\D/g, '');
  const ten = d.length > 10 ? d.slice(-10) : d;
  return /^[6-9]\d{9}$/.test(ten) && !isDemoNumber(ten) ? ten : null;
};

const log = (entry) => NotificationLog.create({ channel: 'whatsapp', ...entry }).catch((e) => logger.error({ err: e.message }, 'notif log failed'));

/** build request URL (exported for tests). apikey is redacted from anything we log. */
export function buildUrl({ mobile, msg, pdf, img1, img2, scheduleon }) {
  const u = new URL(cfg.WAPP_API_URL);
  u.searchParams.set('apikey', cfg.WAPP_API_KEY);
  u.searchParams.set('mobile', mobile);
  u.searchParams.set('msg', msg.length > MAX_LEN ? `${msg.slice(0, MAX_LEN - 1)}…` : msg);
  if (pdf) u.searchParams.set('pdf', pdf);
  if (img1) u.searchParams.set('img1', img1);
  if (img2) u.searchParams.set('img2', img2);
  if (scheduleon) u.searchParams.set('scheduleon', scheduleon);
  if (cfg.WAPP_COUNTRY) u.searchParams.set('country', cfg.WAPP_COUNTRY);
  return u;
}

/**
 * Send one WhatsApp message.
 * @param {{ to:string, msg:string, pdf?:string, img1?:string, img2?:string, scheduleon?:string, event?:string, refType?:string, refId?:any, sensitive?:boolean }} p
 * sensitive=true (OTP) → message body never stored in logs.
 */
export async function sendWapp({ to, msg, pdf, img1, img2, scheduleon, event, refType, refId, sensitive = false }) {
  const mobile = normalizeMobile(to);
  const ref = { event, refType, refId, template: event };
  if (!mobile) {
    await log({ to: String(to || ''), status: 'skipped', error: 'invalid mobile', ...ref });
    return { skipped: true, reason: 'invalid mobile' };
  }
  if (!msg?.trim()) throw new WappError('Message must not be blank', 504, true);
  if (!wappConfigured()) {
    if (env.isProd) {
      await log({ to: mobile, status: 'failed', error: 'WAPP_API_KEY not set', ...ref });
      throw new WappError('WhatsApp provider not configured', 501, true);
    }
    logger.warn({ to: mobile, event, ...(sensitive ? {} : { msg, pdf }) }, 'WAPP not configured — message not sent (dev)');
    await log({ to: mobile, status: 'skipped', error: 'not configured', ...ref });
    return { skipped: true };
  }

  const url = buildUrl({ mobile, msg, pdf, img1, img2, scheduleon });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let res;
  let body = {};
  try {
    res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    await log({ to: mobile, status: 'failed', error: `network: ${e.message}`, ...ref });
    throw new WappError(`WAPP network error: ${e.message}`, 0, false); // retryable
  } finally {
    clearTimeout(timer);
  }

  const code = Number(body.statuscode ?? res.status);
  if (code === 200 && (body.status || 'success') === 'success') {
    await log({ to: mobile, status: 'sent', providerId: body.requestid ? String(body.requestid) : undefined, ...ref });
    if (typeof body.balance === 'number' && body.balance < 100) logger.warn({ balance: body.balance }, 'WAPP balance low');
    return body;
  }
  const reason = WAPP_CODES[code] || body.msg || `HTTP ${res.status}`;
  await log({ to: mobile, status: 'failed', error: `${code}: ${reason}`, ...ref });
  throw new WappError(`WAPP ${code}: ${reason}`, code, PERMANENT.has(code));
}
