import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { cfg, onConfigChange } from './runtimeConfig.js';

/**
 * Pluggable public media storage: local disk | AWS S3 | Cloudflare R2 | Cloudinary.
 * put({ buffer, mime, ext, folder }) → { driver, key, url }      del({ driver, key, resourceType })
 */
const LOCAL_DIR = path.resolve(env.UPLOAD_DIR, 'media');
const trimSlash = (s) => String(s || '').replace(/\/+$/, '');

const r2Ready = () => !!(cfg.R2_ACCOUNT_ID && cfg.R2_BUCKET && cfg.R2_ACCESS_KEY_ID && cfg.R2_SECRET_ACCESS_KEY && cfg.R2_PUBLIC_URL);
const s3Ready = () => !!(cfg.S3_BUCKET && cfg.S3_ACCESS_KEY_ID && cfg.S3_SECRET_ACCESS_KEY);
const cldReady = () => !!(cfg.CLOUDINARY_CLOUD_NAME && cfg.CLOUDINARY_API_KEY && cfg.CLOUDINARY_API_SECRET);
const READY = { local: () => true, r2: r2Ready, s3: s3Ready, cloudinary: cldReady };

export function activeDriver() {
  if (cfg.STORAGE_DRIVER !== 'auto') {
    if (!READY[cfg.STORAGE_DRIVER]()) return 'local';
    return cfg.STORAGE_DRIVER;
  }
  if (r2Ready()) return 'r2';
  if (s3Ready()) return 's3';
  if (cldReady()) return 'cloudinary';
  return 'local';
}

export function storageStatus() {
  return { active: activeDriver(), configured: Object.fromEntries(Object.entries(READY).map(([k, f]) => [k, f()])), requested: cfg.STORAGE_DRIVER };
}

// ---------------------------------------------------------------- S3 / R2
const clients = {};
onConfigChange(() => { delete clients.s3; delete clients.r2; });
async function s3Client(kind) {
  if (clients[kind]) return clients[kind];
  const { S3Client } = await import('@aws-sdk/client-s3');
  clients[kind] = kind === 'r2'
    ? new S3Client({ region: 'auto', endpoint: `https://${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: cfg.R2_ACCESS_KEY_ID, secretAccessKey: cfg.R2_SECRET_ACCESS_KEY } })
    : new S3Client({ region: cfg.S3_REGION, ...(cfg.S3_ENDPOINT ? { endpoint: cfg.S3_ENDPOINT, forcePathStyle: true } : {}), credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY } });
  return clients[kind];
}
const bucketOf = (kind) => (kind === 'r2' ? cfg.R2_BUCKET : cfg.S3_BUCKET);
const publicBase = (kind) => (kind === 'r2' ? trimSlash(cfg.R2_PUBLIC_URL) : trimSlash(cfg.S3_PUBLIC_URL) || `https://${cfg.S3_BUCKET}.s3.${cfg.S3_REGION}.amazonaws.com`);

async function s3Put(kind, { buffer, mime, key }) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const c = await s3Client(kind);
  await c.send(new PutObjectCommand({ Bucket: bucketOf(kind), Key: key, Body: buffer, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' }));
  return `${publicBase(kind)}/${key}`;
}
async function s3Del(kind, key) {
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const c = await s3Client(kind);
  await c.send(new DeleteObjectCommand({ Bucket: bucketOf(kind), Key: key }));
}

// ---------------------------------------------------------------- Cloudinary (signed REST upload, no SDK)
const cldSign = (params) => {
  const str = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(str + cfg.CLOUDINARY_API_SECRET).digest('hex');
};
async function cldPut({ buffer, mime, folder }) {
  const resourceType = mime.startsWith('video/') ? 'video' : 'image';
  const params = { folder: [cfg.CLOUDINARY_FOLDER, folder].filter(Boolean).join('/'), timestamp: Math.floor(Date.now() / 1000) };
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mime }));
  Object.entries(params).forEach(([k, v]) => fd.append(k, String(v)));
  fd.append('api_key', cfg.CLOUDINARY_API_KEY);
  fd.append('signature', cldSign(params));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`, { method: 'POST', body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(502, `Cloudinary: ${j?.error?.message || res.status}`);
  return { key: j.public_id, url: j.secure_url, width: j.width, height: j.height, resourceType };
}
async function cldDel(key, resourceType = 'image') {
  const params = { public_id: key, timestamp: Math.floor(Date.now() / 1000) };
  const fd = new FormData();
  Object.entries(params).forEach(([k, v]) => fd.append(k, String(v)));
  fd.append('api_key', cfg.CLOUDINARY_API_KEY);
  fd.append('signature', cldSign(params));
  await fetch(`https://api.cloudinary.com/v1_1/${cfg.CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`, { method: 'POST', body: fd });
}

// ---------------------------------------------------------------- API
export async function put({ buffer, mime, ext, folder = 'cms' }) {
  const driver = activeDriver();
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  if (driver === 'cloudinary') return { driver, ...(await cldPut({ buffer, mime, folder })) };
  const key = `media/${folder}/${name}`;
  if (driver === 's3' || driver === 'r2') return { driver, key, url: await s3Put(driver, { buffer, mime, key }) };
  await fs.mkdir(path.join(LOCAL_DIR, folder), { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, folder, name), buffer);
  return { driver: 'local', key, url: `${trimSlash(env.PUBLIC_API_URL)}/${key}` };
}

export async function del({ driver, key, resourceType }) {
  try {
    if (driver === 'cloudinary') return await cldDel(key, resourceType);
    if (driver === 's3' || driver === 'r2') return await s3Del(driver, key);
    const p = path.resolve(env.UPLOAD_DIR, key);
    if (p.startsWith(LOCAL_DIR)) await fs.unlink(p);
  } catch {
    /* already gone */
  }
}

export const LOCAL_MEDIA_DIR = LOCAL_DIR;
