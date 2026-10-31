import { cfg } from './runtimeConfig.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';

/** AI writer — any OpenAI-compatible chat API: Hugging Face router, Groq, Google Gemini, OpenRouter or a custom URL. */
export const aiConfigured = () => Boolean(cfg.HF_TOKEN);

export const AI_PROVIDERS = {
  huggingface: { name: 'Hugging Face', url: 'https://router.huggingface.co/v1/chat/completions', keys: 'huggingface.co/settings/tokens' },
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', keys: 'console.groq.com/keys' },
  gemini: { name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', keys: 'aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', keys: 'openrouter.ai/keys' },
  custom: { name: 'Custom', url: '' },
};
const provider = () => (AI_PROVIDERS[cfg.AI_PROVIDER] ? cfg.AI_PROVIDER : 'huggingface');
/** effective chat URL: preset for Groq/Gemini/OpenRouter, HF_API_URL for Hugging Face / custom */
export const chatUrl = () => (['groq', 'gemini', 'openrouter'].includes(provider()) ? AI_PROVIDERS[provider()].url : cfg.HF_API_URL || AI_PROVIDERS.huggingface.url);
export const providerName = () => AI_PROVIDERS[provider()].name;

// models tried (in order) when HF_MODEL is "auto" or the chosen model isn't served by your enabled providers
const PREFERRED = ['llama-3.3-70b-versatile', 'meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'openai/gpt-oss-20b', 'meta-llama/Llama-3.1-8B-Instruct', 'Qwen/Qwen3-32B', 'google/gemma-3-27b-it', 'deepseek-ai/DeepSeek-V3-0324', 'mistralai/Mistral-7B-Instruct-v0.3'];
let modelCache = { at: 0, ids: [], url: '' };
let resolved = null; // last working fallback, reused until HF_MODEL changes
let resolvedFor = null;

const modelsUrl = () => String(chatUrl()).replace(/\/chat\/completions\/?$/, '/models');

/** models currently available to this token through Inference Providers */
export async function listModels({ force = false } = {}) {
  if (!force && modelCache.url === modelsUrl() && Date.now() - modelCache.at < 3600_000 && modelCache.ids.length) return modelCache.ids;
  const res = await fetch(modelsUrl(), { headers: { Authorization: `Bearer ${cfg.HF_TOKEN}` } });
  const j = await res.json().catch(() => ({}));
  const ids = (j?.data || j?.models || [])
    .filter((m) => !m.providers || m.providers.some((p) => !p.status || p.status === 'live'))
    .map((m) => String(m.id || m.name || '').replace(/^models\//, ''))
    .filter((id) => id && !/embed|whisper|tts|speech|audio|image|vision-only|guard|moderation|rerank|transcri|imagen|veo|aqa|distil-whisper/i.test(id));
  modelCache = { at: Date.now(), ids, url: modelsUrl() };
  return ids;
}

// generic ranking so "auto" works on any provider's /models list (ids differ per provider)
const RANK = [/llama-3\.3-70b/i, /gpt-oss-120b/i, /gemini-[\d.]+-flash(?!-lite)/i, /qwen.*(72b|32b|27b|30b)/i, /gemma-?\d.*(27b|31b)/i, /deepseek-v3/i, /llama.*70b/i, /gpt-oss/i, /gemini.*flash/i, /mistral|mixtral/i, /llama/i, /qwen/i, /gemma/i, /instruct|chat/i];
const REASONING = /gpt-oss|qwen3|deepseek-r1|qwq|-r1|reason|think/i;
async function pickModel(exclude, { avoidReasoning = false } = {}) {
  let ids = (await listModels().catch(() => [])).filter((m) => m !== exclude);
  if (avoidReasoning && ids.some((m) => !REASONING.test(m))) ids = ids.filter((m) => !REASONING.test(m));
  if (provider() === 'openrouter') ids = ids.filter((m) => m.endsWith(':free'));
  const set = new Set(ids);
  const pref = PREFERRED.find((m) => set.has(m));
  if (pref) return pref;
  for (const rx of RANK) { const hit = ids.find((m) => rx.test(m)); if (hit) return hit; }
  return ids[0] || null;
}

async function call(model, messages, { maxTokens, temperature, signal }) {
  const res = await fetch(chatUrl(), {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${cfg.HF_TOKEN}`, 'Content-Type': 'application/json', ...(provider() === 'openrouter' ? { 'HTTP-Referer': cfg.PUBLIC_API_URL || 'https://centreforpilesandfistula.com', 'X-Title': cfg.APP_NAME || 'CPF ERP' } : {}) },
    body: JSON.stringify({
      model, messages, max_tokens: maxTokens, temperature, stream: false,
      // reasoning models (gpt-oss, qwen3…) spend tokens "thinking" before answering — keep that short
      ...(provider() === 'groq' && /gpt-oss/i.test(model) ? { reasoning_effort: 'low' } : {}),
    }),
  });
  const j = await res.json().catch(() => ({}));
  return { res, j };
}
const errText = (j, res) => { const m = j?.error?.message || j?.error || j?.message || `HTTP ${res.status}`; return typeof m === 'string' ? m : JSON.stringify(m); };
const unsupported = (res, msg) => [400, 404, 422].includes(res.status) && /not supported|model_not_supported|does not exist|not found|no provider/i.test(msg);

export async function chat(messages, { maxTokens = 2000, temperature = 0.6, timeoutMs = 90_000 } = {}) {
  if (!aiConfigured()) throw new ApiError(503, 'AI is not configured — add an API token in Settings → Integrations → AI writer');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const wanted = `${provider()}|${String(cfg.HF_MODEL || 'auto').trim()}`;
    if (resolvedFor !== wanted) { resolved = null; resolvedFor = wanted; }
    const asked = String(cfg.HF_MODEL || 'auto').trim();
    let model = resolved || (asked === 'auto' ? await pickModel() : asked);
    if (!model) throw new ApiError(502, `${providerName()}: no chat model available for this token${provider() === 'huggingface' ? ' — enable an Inference Provider at huggingface.co/settings/inference-providers' : ''}`);
    let { res, j } = await call(model, messages, { maxTokens, temperature, signal: ac.signal });
    if (!res.ok && unsupported(res, errText(j, res))) {
      const alt = await pickModel(model);
      if (alt) {
        logger.warn({ wanted: model, using: alt }, 'HF model not available — falling back');
        model = alt;
        ({ res, j } = await call(model, messages, { maxTokens, temperature, signal: ac.signal }));
        if (res.ok) resolved = model;
      }
    }
    if (!res.ok) {
      const msg = errText(j, res);
      logger.warn({ status: res.status, msg, model, provider: provider() }, 'AI provider error');
      const credits = res.status === 402 || /credit|quota|billing|insufficient/i.test(msg);
      const e = new ApiError(credits || res.status === 429 ? 402 : 502, `${providerName()}: ${msg}${res.status === 401 ? ' (check API token)' : credits ? ' — free credits finished. Switch AI provider to Groq or Google Gemini (free tiers) in Settings → Integrations → AI writer.' : res.status === 429 ? ' — rate limit hit, wait a minute.' : ''}`);
      e.code = credits ? 'AI_NO_CREDITS' : res.status === 429 ? 'AI_RATE_LIMIT' : 'AI_ERROR';
      throw e;
    }
    let text = cleanReply(j?.choices?.[0]?.message?.content);
    // empty answer = the model used its whole budget on reasoning → retry once with more room, then another model
    if (!text) {
      ({ res, j } = await call(model, messages, { maxTokens: Math.max(maxTokens * 3, 1500), temperature, signal: ac.signal }));
      text = res.ok ? cleanReply(j?.choices?.[0]?.message?.content) : '';
    }
    if (!text) {
      const alt = await pickModel(model, { avoidReasoning: true });
      if (alt) {
        ({ res, j } = await call(alt, messages, { maxTokens: Math.max(maxTokens, 800), temperature, signal: ac.signal }));
        text = res.ok ? cleanReply(j?.choices?.[0]?.message?.content) : '';
        if (text) { model = alt; resolved = alt; }
      }
    }
    if (!text) throw new ApiError(502, `${providerName()} returned no text (model ${model}) — set a different Model in Settings → AI writer`);
    lastModel = model;
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new ApiError(504, 'AI took too long — try again or pick a smaller/faster model');
    throw e;
  } finally {
    clearTimeout(t);
  }
}
let lastModel = null;
export const lastUsedModel = () => lastModel;

/** strip <think>…</think> blocks some reasoning models put in content */
const cleanReply = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();

/** pull the first JSON object/array out of a model reply (handles ```json fences and chatter) */
export function extractJson(text) {
  const s = cleanReply(text).replace(/```(?:json)?/gi, '').trim();
  const start = s.search(/[[{]/);
  if (start < 0) throw new ApiError(502, 'AI reply had no JSON — try again');
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      const raw = s.slice(start, i + 1);
      try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); }
    }
  }
  throw new ApiError(502, 'AI reply was cut off — try again');
}

export async function chatJson(system, user, opts) {
  const msgs = [{ role: 'system', content: system }, { role: 'user', content: user }];
  try {
    return extractJson(await chat(msgs, opts));
  } catch (e) {
    if (e.status === 502 && /JSON|cut off/.test(e.message)) {
      // one retry with a firmer instruction
      return extractJson(await chat([...msgs, { role: 'user', content: 'Reply with ONLY valid minified JSON. No markdown, no comments.' }], opts));
    }
    throw e;
  }
}

/** compliance guard-rails for Indian healthcare advertising (DMR Act / NMC / ASCI) */
export const MEDICAL_RULES = `Rules for all medical marketing copy:
- Never promise a cure, guaranteed results, "100%", "permanent", "no recurrence", or success-rate numbers unless given.
- No comparisons that disparage other doctors/hospitals; no fake testimonials, names or statistics.
- Keep claims factual and soft ("helps", "may", "designed to"); encourage consultation with a doctor.
- Plain, warm, patient-friendly language. Short sentences. No emojis.`;