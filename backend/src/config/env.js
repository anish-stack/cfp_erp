import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  APP_NAME: z.string().default('Centre for Piles & Fistula'),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET min 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET min 32 chars'),
  JWT_PATIENT_SECRET: z.string().min(32, 'JWT_PATIENT_SECRET min 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  JWT_PATIENT_TTL: z.string().default('30d'),
  CORS_ORIGINS: z.string().default(''),
  COOKIE_DOMAIN: z.string().optional().default(''),
  OTP_TTL_SECONDS: z.coerce.number().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().default(30),
  OTP_MAX_PER_HOUR: z.coerce.number().default(5),
  OTP_DEV_LOG: bool.default(false),
  SMS_PROVIDER: z.string().default('msg91'),
  MSG91_AUTH_KEY: z.string().optional().default(''),
  MSG91_OTP_TEMPLATE_ID: z.string().optional().default(''),
  MSG91_SENDER_ID: z.string().optional().default(''),
  UPLOAD_DIR: z.string().default('./uploads'),
  PUBLIC_API_URL: z.string().default('http://localhost:5000'),
  BOOKING_URL: z.string().default('http://localhost:5173'),
  WEBSITE_API_KEY: z.string().optional().default(''),
  // WhatsApp — sms4power WAPP API (plain text + optional PDF/image URL)
  WAPP_API_URL: z.string().url().default('https://api.wtap.sms4power.com/wapp/v2/api/send'),
  WAPP_API_KEY: z.string().optional().default(''),
  WAPP_COUNTRY: z.string().default('IN'),
  // OTP delivery: whatsapp | sms | both (sms = MSG91 OTP API)
  OTP_CHANNEL: z.enum(['whatsapp', 'sms', 'both']).default('whatsapp'),
  // signed public PDF links (invoice / prescription) handed to WhatsApp
  DOC_LINK_SECRET: z.string().optional().default(''),
  DOC_LINK_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // Exotel (click-to-call, IVR, recordings). Region host: api.exotel.com (SG) | api.in.exotel.com (Mumbai)
  EXOTEL_SID: z.string().optional().default(''),
  EXOTEL_API_KEY: z.string().optional().default(''),
  EXOTEL_API_TOKEN: z.string().optional().default(''),
  EXOTEL_SUBDOMAIN: z.string().default('api.exotel.com'),
  EXOTEL_CALLER_ID: z.string().optional().default(''), // ExoPhone shown to customers
  EXOTEL_WEBHOOK_TOKEN: z.string().optional().default(''), // secret in callback URLs
  // MSG91 transactional flows (DLT)
  MSG91_FLOW_APPT: z.string().optional().default(''),
  MSG91_FLOW_REMINDER: z.string().optional().default(''),
  // SMTP
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default(''),
  ALERT_EMAILS: z.string().optional().default(''),
  SEED_ADMIN_NAME: z.string().default('Super Admin'),
  SEED_ADMIN_EMAIL: z.string().optional().default(''),
  SEED_ADMIN_PHONE: z.string().optional().default(''),
  SEED_ADMIN_PASSWORD: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
};
