import "dotenv/config";
import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(5000),
  APP_NAME: z.string().default("Centre for Piles & Fistula"),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET min 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET min 32 chars"),
  // encrypts integration secrets saved from Admin → Settings (falls back to JWT_REFRESH_SECRET). Never change after saving secrets.
  CONFIG_SECRET: z.string().optional().default(""),
  JWT_PATIENT_SECRET: z.string().min(32, "JWT_PATIENT_SECRET min 32 chars"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  JWT_PATIENT_TTL: z.string().default("30d"),
  CORS_ORIGINS: z.string().default(""),
  COOKIE_DOMAIN: z.string().optional().default(""),
  OTP_TTL_SECONDS: z.coerce.number().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().default(30),
  OTP_MAX_PER_HOUR: z.coerce.number().default(5),
  OTP_DEV_LOG: bool.default(false),
  SMS_PROVIDER: z.string().default("msg91"),
  MSG91_AUTH_KEY: z.string().optional().default(""),
  MSG91_OTP_TEMPLATE_ID: z.string().optional().default(""),
  MSG91_SENDER_ID: z.string().optional().default(""),
  UPLOAD_DIR: z.string().default("./uploads"),
  // Media storage for CMS images: auto picks the first configured of r2 → s3 → cloudinary, else local disk
  STORAGE_DRIVER: z
    .enum(["auto", "local", "s3", "r2", "cloudinary"])
    .default("auto"),
  S3_BUCKET: z.string().optional().default(""),
  S3_REGION: z.string().optional().default("ap-south-1"),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  S3_ENDPOINT: z.string().optional().default(""), // optional (MinIO / DigitalOcean Spaces)
  S3_PUBLIC_URL: z.string().optional().default(""), // CDN / CloudFront base; default https://<bucket>.s3.<region>.amazonaws.com
  R2_ACCOUNT_ID: z.string().optional().default(""),
  R2_BUCKET: z.string().optional().default(""),
  R2_ACCESS_KEY_ID: z.string().optional().default(""),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(""),
  R2_PUBLIC_URL: z.string().optional().default(""), // r2.dev URL or custom domain (required for R2)
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(""),
  CLOUDINARY_API_KEY: z.string().optional().default(""),
  CLOUDINARY_API_SECRET: z.string().optional().default(""),
  CLOUDINARY_FOLDER: z.string().optional().default("cpf"),
  // AI writer for CMS (any OpenAI-compatible chat API). AI_PROVIDER picks the URL; token/model/url keys keep the HF_ names
  AI_PROVIDER: z
    .enum(["huggingface", "groq", "gemini", "openrouter", "custom"])
    .default("huggingface"),
  HF_TOKEN: z.string().optional().default(""),
  HF_MODEL: z.string().optional().default("auto"), // auto = best available chat model for your enabled providers
  HF_API_URL: z
    .string()
    .optional()
    .default("https://router.huggingface.co/v1/chat/completions"),
  PUBLIC_API_URL: z.string().default("http://localhost:5000"),
  BOOKING_URL: z.string().default("http://localhost:5173"),
  WEBSITE_API_KEY: z.string().optional().default(""),
  // WhatsApp — sms4power WAPP API (plain text + optional PDF/image URL)
  WAPP_API_URL: z
    .string()
    .url()
    .default("https://api.wtap.sms4power.com/wapp/v2/api/send"),
  WAPP_API_KEY: z.string().optional().default(""),
  WAPP_COUNTRY: z.string().default("IN"),
  // Razorpay (payment links, UPI QR, online booking payments) — also editable in Settings → Integrations
  RAZORPAY_KEY_ID: z.string().optional().default(""),
  RAZORPAY_KEY_SECRET: z.string().optional().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(""),
  // OTP delivery: whatsapp | sms | both (sms = MSG91 OTP API)
  OTP_CHANNEL: z.enum(["whatsapp", "sms", "both"]).default("whatsapp"),
  // signed public PDF links (invoice / prescription) handed to WhatsApp
  DOC_LINK_SECRET: z.string().optional().default(""),
  DOC_LINK_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // Exotel (click-to-call, IVR, recordings). Region host: api.exotel.com (SG) | api.in.exotel.com (Mumbai)
  EXOTEL_SID: z.string().optional().default(""),
  EXOTEL_API_KEY: z.string().optional().default(""),
  EXOTEL_API_TOKEN: z.string().optional().default(""),
  EXOTEL_SUBDOMAIN: z.string().default("api.exotel.com"),
  EXOTEL_CALLER_ID: z.string().optional().default(""), // ExoPhone shown to customers
  EXOTEL_WEBHOOK_TOKEN: z.string().optional().default(""), // secret in callback URLs
  // MSG91 transactional flows (DLT)
  MSG91_FLOW_APPT: z.string().optional().default(""),
  MSG91_FLOW_REMINDER: z.string().optional().default(""),
  // SMTP
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default(""),
  ALERT_EMAILS: z.string().optional().default(""),
  SEED_ADMIN_NAME: z.string().default("Super Admin"),
  SEED_ADMIN_EMAIL: z.string().optional().default(""),
  SEED_ADMIN_PHONE: z.string().optional().default(""),
  SEED_ADMIN_PASSWORD: z.string().optional().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  corsOrigins: parsed.data.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
