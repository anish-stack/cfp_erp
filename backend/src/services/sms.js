import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const configured = () => Boolean(env.MSG91_AUTH_KEY && env.MSG91_OTP_TEMPLATE_ID);

/** MSG91 OTP API (DLT template must contain ##OTP##) */
async function msg91SendOtp(mobile, otp) {
  const url = new URL('https://control.msg91.com/api/v5/otp');
  url.searchParams.set('template_id', env.MSG91_OTP_TEMPLATE_ID);
  url.searchParams.set('mobile', `91${mobile}`);
  url.searchParams.set('otp', otp);
  const res = await fetch(url, { method: 'POST', headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.type === 'error') throw new Error(`MSG91 error: ${body.message || res.status}`);
  return body;
}

export async function sendOtpSms(mobile, otp) {
  if (!configured()) {
    if (env.isProd) throw new Error('SMS provider not configured');
    logger.warn({ mobile }, 'SMS provider not configured — OTP not sent (dev)');
    return { skipped: true };
  }
  return msg91SendOtp(mobile, otp);
}
