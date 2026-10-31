import { sendWapp } from './wapp.js';
import { signDocLink, docLinksPublic } from '../utils/signedLink.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Send a WhatsApp message with a PDF attached.
 *  - PUBLIC_API_URL not public (localhost / LAN) → provider can't download → text only (+ portal hint)
 *  - provider rejects the PDF ("invalid pdf", 5xx) → resend as text with the download link inline
 * so the patient always gets the message.
 */
export async function sendWappWithDoc({ to, msg, docType, docId, docName, event, refType, refId }) {
  if (!docLinksPublic()) {
    if (!env.isProd) logger.warn({ url: env.PUBLIC_API_URL }, 'PUBLIC_API_URL is not public — WhatsApp sent without PDF');
    const hint = env.BOOKING_URL ? `\n\nDownload anytime: ${env.BOOKING_URL.replace(/\/$/, '')}/profile` : '';
    return sendWapp({ to, msg: msg.replace(/\n?(PDF attached\.?|Invoice PDF attached\.?)/g, '') + hint, event, refType, refId });
  }
  const link = signDocLink(docType, docId, undefined, docName);
  try {
    return await sendWapp({ to, msg, pdf: link, event, refType, refId });
  } catch (e) {
    if (e.code === 0 || [501, 502, 505, 507].includes(e.code)) throw e; // network / account problems: normal handling
    logger.warn({ err: e.message, event }, 'WAPP rejected PDF — sending link in text');
    return sendWapp({ to, msg: `${msg.replace(/\n?(PDF attached\.?|Invoice PDF attached\.?)/g, '')}\n\n📄 Download: ${link}`, event: `${event}.link`, refType, refId });
  }
}
