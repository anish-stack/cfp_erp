import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { redis } from '../../config/redis.js';
import { Otp } from '../../models/Otp.js';
import { ApiError } from '../../utils/ApiError.js';
import { deliverOtp } from '../../services/otpDelivery.js';

const PURPOSE = 'patient_login';

export async function sendOtp(mobile) {
  // cooldown
  const cd = await redis.set(`otp:cd:${mobile}`, '1', 'EX', env.OTP_RESEND_COOLDOWN_SECONDS, 'NX');
  if (!cd) {
    const ttl = await redis.ttl(`otp:cd:${mobile}`);
    throw new ApiError(429, `Please wait ${ttl > 0 ? ttl : env.OTP_RESEND_COOLDOWN_SECONDS}s before requesting another OTP`);
  }
  // hourly cap
  const hrKey = `otp:hr:${mobile}`;
  const count = await redis.incr(hrKey);
  if (count === 1) await redis.expire(hrKey, 3600);
  if (count > env.OTP_MAX_PER_HOUR) throw ApiError.tooMany('OTP limit reached. Try again in an hour');

  const otp = String(crypto.randomInt(100000, 1000000));
  await Otp.findOneAndUpdate(
    { mobile, purpose: PURPOSE },
    { codeHash: await bcrypt.hash(otp, 8), attempts: 0, expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (env.OTP_DEV_LOG && !env.isProd) logger.warn({ mobile, otp }, 'DEV OTP');
  const { ok, channels } = await deliverOtp(mobile, otp, { resend: count > 1 });
  if (!ok) {
    // let the patient retry immediately; don't burn the hourly quota on a delivery failure
    await redis.del(`otp:cd:${mobile}`);
    await redis.decr(hrKey);
    await Otp.deleteOne({ mobile, purpose: PURPOSE });
    throw new ApiError(503, 'Could not send OTP right now. Please try again in a moment');
  }

  return { expiresIn: env.OTP_TTL_SECONDS, resendIn: env.OTP_RESEND_COOLDOWN_SECONDS, channel: channels.join('+') };
}

export async function verifyOtp(mobile, otp) {
  // atomically consume one attempt
  const rec = await Otp.findOneAndUpdate(
    { mobile, purpose: PURPOSE, expiresAt: { $gt: new Date() }, attempts: { $lt: env.OTP_MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { new: true }
  );
  if (!rec) throw ApiError.badRequest('OTP expired or too many attempts. Request a new one');

  const okay = await bcrypt.compare(otp, rec.codeHash);
  if (!okay) {
    const left = env.OTP_MAX_ATTEMPTS - rec.attempts;
    throw ApiError.badRequest(left > 0 ? `Incorrect OTP. ${left} attempt(s) left` : 'Too many attempts. Request a new OTP');
  }
  await Otp.deleteOne({ _id: rec._id });
  await redis.del(`otp:cd:${mobile}`);
  return true;
}
