import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export const uploadRoot = path.resolve(env.UPLOAD_DIR);

const ALLOWED = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Private uploads — never served statically; streamed through authenticated routes only. */
export const privateUpload = (sub) => {
  const dir = path.join(uploadRoot, sub);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + ALLOWED[file.mimetype]),
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => (ALLOWED[file.mimetype] ? cb(null, true) : cb(ApiError.badRequest('Only PDF/JPG/PNG/WEBP allowed'))),
  });
};

/** In-memory upload for CSV imports */
export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    /csv|excel|text\/plain/.test(file.mimetype) || file.originalname.endsWith('.csv') ? cb(null, true) : cb(ApiError.badRequest('CSV file required')),
});

export const safeJoin = (sub, name) => {
  const p = path.join(uploadRoot, sub, path.basename(name));
  if (!p.startsWith(uploadRoot)) throw ApiError.badRequest('Bad path');
  return p;
};
