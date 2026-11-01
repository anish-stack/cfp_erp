import crypto from 'node:crypto';
import { cfg } from './runtimeConfig.js';
import { ApiError } from '../utils/ApiError.js';

/** Thin Razorpay REST client (keys from Settings → Integrations or .env — never hard-coded). Amounts in RUPEES here, paise on the wire. */
const BASE = 'https://api.razorpay.com/v1';
export const razorpayConfigured = () => Boolean(cfg.RAZORPAY_KEY_ID && cfg.RAZORPAY_KEY_SECRET);
export const publicKey = () => cfg.RAZORPAY_KEY_ID || '';
const paise = (rupees) => Math.round(Number(rupees) * 100);
export const rupees = (p) => Math.round(Number(p || 0)) / 100;

async function call(method, path, body) {
  if (!razorpayConfigured()) throw ApiError.badRequest('Razorpay is not set up — add the keys in Settings → Integrations');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { Authorization: `Basic ${Buffer.from(`${cfg.RAZORPAY_KEY_ID}:${cfg.RAZORPAY_KEY_SECRET}`).toString('base64')}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(502, `Razorpay unreachable: ${e.message}`);
  } finally {
    clearTimeout(t);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status === 401 ? 400 : 502, `Razorpay: ${data?.error?.description || `HTTP ${res.status}`}`);
  return data;
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const notesOf = (n = {}) => Object.fromEntries(Object.entries(n).slice(0, 15).map(([k, v]) => [k, String(v).slice(0, 250)]));

/** Payment link (UPI / card / netbanking page) */
export const createLink = ({ amount, description, customer = {}, referenceId, expireBy, notes, callbackUrl }) => call('POST', '/payment_links', clean({
  amount: paise(amount), currency: 'INR', accept_partial: false, description: description?.slice(0, 2048), reference_id: referenceId?.slice(0, 40),
  expire_by: expireBy ? Math.floor(new Date(expireBy).getTime() / 1000) : undefined,
  customer: clean({ name: customer.name, contact: customer.phone ? `+91${customer.phone}` : undefined, email: customer.email }),
  notify: { sms: false, email: false }, reminder_enable: false, notes: notesOf(notes),
  callback_url: callbackUrl, callback_method: callbackUrl ? 'get' : undefined,
}));
export const fetchLink = (id) => call('GET', `/payment_links/${id}`);
export const cancelLink = (id) => call('POST', `/payment_links/${id}/cancel`);

/** single-use, fixed-amount UPI QR */
export const createQr = ({ amount, name, description, closeBy, notes }) => call('POST', '/payments/qr_codes', clean({
  type: 'upi_qr', name: name?.slice(0, 40), usage: 'single_use', fixed_amount: true, payment_amount: paise(amount), description: description?.slice(0, 200),
  close_by: closeBy ? Math.floor(new Date(closeBy).getTime() / 1000) : undefined, notes: notesOf(notes),
}));
export const fetchQr = (id) => call('GET', `/payments/qr_codes/${id}`);
export const fetchQrPayments = (id) => call('GET', `/payments/qr_codes/${id}/payments`);
export const closeQr = (id) => call('POST', `/payments/qr_codes/${id}/close`);

/** checkout order (booking portal) */
export const createOrder = ({ amount, receipt, notes }) => call('POST', '/orders', clean({ amount: paise(amount), currency: 'INR', receipt: receipt?.slice(0, 40), notes: notesOf(notes) }));
export const fetchOrderPayments = (id) => call('GET', `/orders/${id}/payments`);
export const fetchPayment = (id) => call('GET', `/payments/${id}`);
export const capturePayment = (id, amount) => call('POST', `/payments/${id}/capture`, { amount: paise(amount), currency: 'INR' });
export const refundPayment = (id, amount, notes) => call('POST', `/payments/${id}/refund`, clean({ amount: amount ? paise(amount) : undefined, speed: 'normal', notes: notesOf(notes) }));
export const ping = () => call('GET', '/payments?count=1');

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
/** checkout handler signature: HMAC_SHA256(order_id|payment_id, key_secret) */
export const verifyCheckout = (orderId, paymentId, signature) => safeEq(crypto.createHmac('sha256', cfg.RAZORPAY_KEY_SECRET || '').update(`${orderId}|${paymentId}`).digest('hex'), signature);
/** webhook: HMAC_SHA256(raw body, webhook secret) */
export const verifyWebhook = (raw, signature) => Boolean(cfg.RAZORPAY_WEBHOOK_SECRET) && safeEq(crypto.createHmac('sha256', cfg.RAZORPAY_WEBHOOK_SECRET).update(raw || '').digest('hex'), signature);

/** razorpay method → our payment mode */
export const modeOf = (method) => ({ upi: 'upi', card: 'card', netbanking: 'bank', emandate: 'bank', nach: 'bank', bank_transfer: 'bank' }[method] || 'upi');
