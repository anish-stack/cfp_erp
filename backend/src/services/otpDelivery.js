import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getSettings } from '../models/Settings.js';
import { sendWapp } from './wapp.js';
import { sendOtpSms } from './sms.js';
import { M } from './messages.js';

/**
 * Deliver OTP synchronously (patient is waiting on the screen).
 * OTP_CHANNEL: whatsapp | sms | both. Succeeds if ANY channel succeeds.
 * One quick retry on WhatsApp network errors.
 */
export async function deliverOtp(mobile, otp, { resend = false } = {}) {
  const s = await getSettings();
  const ctx = { clinic: s.clinic };
  const minutes = Math.round(env.OTP_TTL_SECONDS / 60);
  const channels = env.OTP_CHANNEL === 'both' ? ['whatsapp', 'sms'] : [env.OTP_CHANNEL];
  const results = [];

  for (const ch of channels) {
    try {
      if (ch === 'whatsapp') {
        const send = () => sendWapp({ to: mobile, msg: M.otp({ otp, minutes }, ctx), event: resend ? 'otp.resend' : 'otp.send', refType: 'Otp', sensitive: true });
        try {
          results.push(await send());
        } catch (e) {
          if (e.permanent) throw e;
          results.push(await send()); // one retry on transient errors
        }
      } else {
        results.push(await sendOtpSms(mobile, otp));
      }
    } catch (e) {
      logger.error({ mobile, channel: ch, err: e.message }, 'OTP delivery failed');
      results.push({ error: e.message });
    }
  }
  const ok = results.some((r) => r && !r.error);
  return { ok, channels };
}
