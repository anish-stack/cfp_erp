import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { auth } from '../../middleware/auth.js';
import { permit } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { chatJson, aiConfigured, MEDICAL_RULES, providerName } from '../../services/ai.js';
import { cfg } from '../../services/runtimeConfig.js';
import { buildLandingFromAi, AI_ICONS, DEFAULT_DESIGN } from '../../constants/landing.js';
import { CLINIC, BRANCHES } from '../../constants/clinic.js';
import { EnquiryForm } from '../../models/Crm.js';
import { getSettings } from '../../models/Settings.js';

/** AI writing for CMS (Hugging Face). Page creation + per-block rewrite. */
const r = Router();
r.use(auth);
const aiLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 30, keyGenerator: (req) => String(req.user?._id || req.ip), standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many AI requests — wait a few minutes' } });

const LANG = { en: 'English', hi: 'Hindi (Devanagari script)', hinglish: 'Hinglish (Hindi in Roman script mixed with English)' };
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'landing-page';

async function clinicContext() {
  const s = await getSettings().catch(() => null);
  return `Clinic: ${s?.clinic?.name || CLINIC.name}. ${s?.clinic?.tagline || CLINIC.tagline}. Branches in Delhi NCR: ${BRANCHES.map((b) => b.name).join(', ')}. Doctors: Dr. Rakesh Gupta and Dr. Ruchi Gupta (Ayurvedic anorectal surgeons). Treatments offered: Kshar Sutra, Kshar Karma, Laser (piles, fistula, fissure, pilonidal sinus), Infrared Coagulation (IRC), herbal medicines. Free consultation.`;
}

r.get('/status', permit('cms.view'), (_req, res) => ok(res, { configured: aiConfigured(), model: cfg.HF_MODEL, provider: providerName() }));

// ---------------------------------------------------------------- whole landing page from a brief
r.post('/landing', permit('cms.create'), aiLimiter, validate({ body: z.object({ brief: z.string().trim().min(5).max(1500), language: z.enum(['en', 'hi', 'hinglish']).default('en'), tone: z.enum(['caring', 'professional', 'urgent', 'friendly']).default('caring') }) }), asyncHandler(async (req, res) => {
  const { brief, language, tone } = req.body;
  const system = `You write high-converting, compliant landing pages for an Indian clinic. Output ONLY JSON.\n${MEDICAL_RULES}`;
  const user = `${await clinicContext()}

Campaign brief: """${brief}"""
Language: ${LANG[language]}. Tone: ${tone}.

Return JSON with exactly these keys:
{"name":"internal page name (English, max 60 chars)","slug":"url-slug-in-english","seoTitle":"max 60 chars","seoDescription":"max 155 chars",
"hero":{"eyebrow":"short label","title":"headline max 70 chars","subtitle":"max 140 chars","ctaText":"max 25 chars"},
"formTitle":"max 40 chars","formButton":"max 18 chars",
"stats":[{"value":"e.g. 5","label":"Clinics in Delhi NCR"}],
"featuresHeading":"...","features":[{"icon":"one of ${AI_ICONS.join('|')}","title":"max 40 chars","text":"max 110 chars"}],
"galleryHeading":"...",
"about":{"heading":"...","body":"2-4 sentences"},
"conditionsHeading":"...","conditionsIntro":"1 sentence","conditions":[{"title":"...","text":"1-2 sentences"}],
"treatmentsHeading":"...","treatmentsIntro":"1 sentence","treatments":[{"title":"...","text":"1-2 sentences"}],
"faq":[{"q":"...","a":"2-3 sentences"}],
"ctaHeading":"max 90 chars","ctaText":"max 120 chars"}
Use 6-8 features, 3-5 conditions, 3-5 treatments, 4-6 FAQs, 3 stats only from facts given (no invented numbers of patients or success rates). Write all visible text in ${LANG[language]}; name and slug in English.`;
  const ai = await chatJson(system, user, { maxTokens: 2600, temperature: 0.7 });
  let slug = slugify(ai.slug || ai.name || brief);
  if (await EnquiryForm.exists({ slug })) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const out = {
    name: String(ai.name || brief).slice(0, 110),
    slug,
    kind: 'landing_page',
    page: { headline: ai.hero?.title, subheadline: ai.hero?.subtitle, ctaText: ai.hero?.ctaText || 'Book Free Consultation', seoTitle: String(ai.seoTitle || '').slice(0, 120), seoDescription: String(ai.seoDescription || '').slice(0, 300) },
    blocks: buildLandingFromAi(ai),
    design: DEFAULT_DESIGN,
  };
  audit(req, { action: 'cms.ai_generate', entity: 'EnquiryForm', meta: { brief: brief.slice(0, 200), language, model: cfg.HF_MODEL } });
  ok(res, out);
}));

// ---------------------------------------------------------------- rewrite one block's text
const NON_TEXT = new Set(['image', 'bgImage', 'video', 'url', 'link', 'ctaLink', 'ctaLink2', 'buttonLink', 'logo', 'photo', 'poster', 'bgColor', 'style', 'layout', 'bg', 'align', 'imageSide', 'columns', 'sticky', 'rounded', 'maxWidth', 'height', 'phone', 'email']);
const textOnly = (v) => {
  if (Array.isArray(v)) return v.map(textOnly);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !NON_TEXT.has(k)).map(([k, x]) => [k, textOnly(x)]).filter(([, x]) => typeof x === 'string' || Array.isArray(x) || (x && typeof x === 'object')));
  return typeof v === 'string' ? v : undefined;
};
/** merge AI text back: only string fields; non-text props (images, links, colours) always kept from the original */
const mergeText = (orig, ai) => {
  if (Array.isArray(ai)) {
    const src = Array.isArray(orig) ? orig : [];
    return ai.slice(0, 20).map((it, i) => mergeText(src[i] ?? src[src.length - 1] ?? {}, it));
  }
  if (ai && typeof ai === 'object') {
    const base = orig && typeof orig === 'object' && !Array.isArray(orig) ? { ...orig } : {};
    for (const [k, v] of Object.entries(ai)) {
      if (NON_TEXT.has(k)) continue;
      if (k === 'icon') { if (AI_ICONS.includes(v)) base[k] = v; continue; }
      if (typeof v === 'string') base[k] = v.slice(0, 1500);
      else if (v && typeof v === 'object') base[k] = mergeText(base[k], v);
    }
    // list items that were new: blank out copied images/links so they don't duplicate
    return base;
  }
  return orig;
};

r.post('/block', permit('cms.edit'), aiLimiter, validate({ body: z.object({ type: z.string().max(30), props: z.record(z.any()), instruction: z.string().trim().min(2).max(500), language: z.enum(['keep', 'en', 'hi', 'hinglish']).default('keep') }) }), asyncHandler(async (req, res) => {
  const { type, props, instruction, language } = req.body;
  if (JSON.stringify(props).length > 20_000) throw ApiError.badRequest('Block too large');
  const text = textOnly(props);
  const system = `You edit text inside one section ("${type}") of a clinic landing page. Output ONLY JSON with the SAME keys and structure as the input (you may add or remove list items if asked). Do not add URLs, phone numbers or prices that are not in the input.${type === 'features' ? ` "icon" must be one of: ${AI_ICONS.join(', ')}.` : ''}\n${MEDICAL_RULES}`;
  const user = `${await clinicContext()}

Instruction: """${instruction}"""
${language === 'keep' ? 'Keep the current language.' : `Write in ${LANG[language]}.`}
Current section JSON:
${JSON.stringify(text)}`;
  const ai = await chatJson(system, user, { maxTokens: 1800, temperature: 0.6 });
  ok(res, { props: mergeText(props, ai) });
}));

// ---------------------------------------------------------------- single field (headline ideas etc.)
r.post('/text', permit('cms.edit'), aiLimiter, validate({ body: z.object({ text: z.string().max(2000).default(''), instruction: z.string().trim().min(2).max(300), field: z.string().max(60).optional() }) }), asyncHandler(async (req, res) => {
  const system = `You improve one text field on a clinic landing page. Return ONLY JSON: {"options":["...","...","..."]} with 3 alternatives.\n${MEDICAL_RULES}`;
  const user = `${await clinicContext()}\nField: ${req.body.field || 'text'}\nCurrent: """${req.body.text}"""\nInstruction: ${req.body.instruction}`;
  const ai = await chatJson(system, user, { maxTokens: 600, temperature: 0.8 });
  ok(res, { options: (Array.isArray(ai.options) ? ai.options : []).filter((x) => typeof x === 'string').slice(0, 5) });
}));

export default r;
