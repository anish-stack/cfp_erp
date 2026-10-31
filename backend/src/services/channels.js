import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { NotificationLog } from '../models/Misc.js';

const log = (entry) => NotificationLog.create(entry).catch((e) => logger.error({ err: e.message }, 'notif log failed'));

// WhatsApp lives in ./wapp.js (sms4power WAPP API)

// ---------- SMS (MSG91 Flow API, DLT approved templates) ----------
export async function sendSmsFlow({ to, flowId, vars = {}, ref = {} }) {
  if (!env.MSG91_AUTH_KEY || !flowId) {
    await log({ channel: 'sms', to, template: flowId || 'none', status: 'skipped', error: 'not configured', ...ref });
    return { skipped: true };
  }
  const res = await fetch('https://control.msg91.com/api/v5/flow', {
    method: 'POST',
    headers: { authkey: env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: flowId, short_url: '0', recipients: [{ mobiles: `91${to}`, ...vars }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.type === 'error') {
    await log({ channel: 'sms', to, template: flowId, status: 'failed', error: body.message || String(res.status), ...ref });
    throw new Error(`MSG91: ${body.message || res.status}`);
  }
  await log({ channel: 'sms', to, template: flowId, status: 'sent', ...ref });
  return body;
}

// ---------- Email (SMTP) ----------
let transporter;
const mailer = () => {
  if (!env.SMTP_HOST) return null;
  transporter ||= nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined });
  return transporter;
};

export async function sendEmail({ to, subject, html, ref = {} }) {
  const t = mailer();
  const list = [].concat(to).filter(Boolean);
  if (!t || !list.length) {
    await log({ channel: 'email', to: list.join(','), template: subject, status: 'skipped', error: 'not configured', ...ref });
    return { skipped: true };
  }
  try {
    const info = await t.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to: list.join(','), subject, html });
    await log({ channel: 'email', to: list.join(','), template: subject, status: 'sent', providerId: info.messageId, ...ref });
    return info;
  } catch (e) {
    await log({ channel: 'email', to: list.join(','), template: subject, status: 'failed', error: e.message, ...ref });
    throw e;
  }
}

// ---------- Webhook delivery ----------
export async function deliverWebhook(hook, event, payload) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data: payload });
  const sig = crypto.createHmac('sha256', hook.secret).update(`${ts}.${body}`).digest('hex');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CPF-Event': event, 'X-CPF-Timestamp': String(ts), 'X-CPF-Signature': `sha256=${sig}` },
      body,
      signal: ctrl.signal,
    });
    await log({ channel: 'webhook', to: hook.url, event, status: res.ok ? 'sent' : 'failed', error: res.ok ? undefined : `HTTP ${res.status}` });
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}
