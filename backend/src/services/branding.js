import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { uploadRoot } from '../middleware/upload.js';
import { getSettings } from '../models/Settings.js';
import { ApiError } from '../utils/ApiError.js';

const DIR = path.join(uploadRoot, 'branding');
fs.mkdirSync(DIR, { recursive: true });

/** PDFKit embeds only PNG/JPEG → verify magic bytes, not just the mime header */
export function detectImage(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}

export function logoPath(file) {
  if (!file) return null;
  const p = path.join(DIR, path.basename(file));
  return fs.existsSync(p) ? p : null;
}

export function saveLogo(buf) {
  const ext = detectImage(buf);
  if (!ext) throw ApiError.badRequest('Logo must be a PNG or JPG image');
  const name = `logo-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)}.${ext}`;
  fs.writeFileSync(path.join(DIR, name), buf);
  return name;
}

export function removeLogoFile(file) {
  const p = logoPath(file);
  if (p) fs.unlink(p, () => {});
}

let cache = { file: null, buf: null };
function logoBuffer(file) {
  if (!file) return null;
  if (cache.file === file && cache.buf) return cache.buf;
  const p = logoPath(file);
  if (!p) return null;
  cache = { file, buf: fs.readFileSync(p) };
  return cache.buf;
}

/** Everything the PDF renderers need, honouring Settings → Billing → "Show logo on PDFs" */
export async function pdfBranding() {
  const s = await getSettings();
  const showLogo = s.billing?.showLogoOnPdf !== false;
  const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : null);
  return {
    clinic: s.clinic || {},
    footer: s.billing?.invoiceFooter,
    logo: showLogo ? logoBuffer(s.clinic?.logoFile) : null,
    color: hex(s.theme?.pdf) || hex(s.theme?.console?.primary) || '#e21f26',
    rxFooter: s.pdf?.rxFooter,
    showSignature: s.pdf?.showSignature !== false,
  };
}
