import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Expiring, unguessable public links for documents that must be fetched by the
 * WhatsApp provider (invoice / prescription PDFs). HMAC-SHA256 over type|id|exp.
 */
export const DOC_TYPES = ['invoice', 'rx'];

const secret = () =>
  env.DOC_LINK_SECRET || crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update('cpf-doc-links').digest('hex');

const sig = (type, id, exp) => crypto.createHmac('sha256', secret()).update(`${type}|${id}|${exp}`).digest('base64url');

export function signDocLink(type, id, days = env.DOC_LINK_TTL_DAYS) {
  if (!DOC_TYPES.includes(type)) throw new Error(`Unknown doc type ${type}`);
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const base = env.PUBLIC_API_URL.replace(/\/$/, '');
  return `${base}/api/v1/public/docs/${type}/${id}.pdf?e=${exp}&s=${sig(type, String(id), exp)}`;
}

/** returns true when signature valid and not expired */
export function verifyDocLink(type, id, e, s) {
  if (!DOC_TYPES.includes(type) || !e || !s) return false;
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sig(type, String(id), exp));
  const given = Buffer.from(String(s));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
