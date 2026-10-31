import { cfg } from './runtimeConfig.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';

/** Hugging Face Inference Providers (OpenAI-compatible chat completions). */
export const aiConfigured = () => Boolean(cfg.HF_TOKEN);

// models tried (in order) when HF_MODEL is "auto" or the chosen model isn't served by your enabled providers
const PREFERRED = ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'openai/gpt-oss-20b', 'meta-llama/Llama-3.1-8B-Instruct', 'Qwen/Qwen3-32B', 'google/gemma-3-27b-it', 'deepseek-ai/DeepSeek-V3-0324', 'mistralai/Mistral-7B-Instruct-v0.3'];
let modelCache = { at: 0, ids: [] };
let resolved = null; // last working fallback, reused until HF_MODEL changes
let resolvedFor = null;

const modelsUrl = () => String(cfg.HF_API_URL).replace(/\/chat\/completions\/?$/, '/models');

/** models currently available to this token through Inference Providers */
export async function listModels({ force = false } = {}) {
  if (!force && Date.now() - modelCache.at < 3600_000 && modelCache.ids.length) return modelCache.ids;
  const res = await fetch(modelsUrl(), { headers: { Authorization: `Bearer ${cfg.HF_TOKEN}` } });
  const j = await res.json().catch(() => ({}));
  const ids = (j?.data || []).filter((m) => !m.providers || m.providers.some((p) => !p.status || p.status === 'live')).map((m) => m.id);
  modelCache = { at: Date.now(), ids };
  return ids;
}

async function pickModel(exclude) {
  const ids = await listModels().catch(() => []);
  const set = new Set(ids);
  return PREFERRED.find((m) => set.has(m) && m !== exclude) || ids.find((m) => m !== exclude && /instruct|chat|-it$|gpt-oss|llama|qwen/i.test(m)) || null;
}

async function call(model, messages, { maxTokens, temperature, signal }) {
  const res = await fetch(cfg.HF_API_URL, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${cfg.HF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: false }),
  });
  const j = await res.json().catch(() => ({}));
  return { res, j };
}
const errText = (j, res) => { const m = j?.error?.message || j?.error || j?.message || `HTTP ${res.status}`; return typeof m === 'string' ? m : JSON.stringify(m); };
const unsupported = (res, msg) => [400, 404, 422].includes(res.status) && /not supported|model_not_supported|does not exist|not found|no provider/i.test(msg);

export async function chat(messages, { maxTokens = 2000, temperature = 0.6, timeoutMs = 90_000 } = {}) {
  if (!aiConfigured()) throw new ApiError(503, 'AI is not configured — add a Hugging Face token in Settings → Integrations');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const wanted = String(cfg.HF_MODEL || 'auto').trim();
    if (resolvedFor !== wanted) { resolved = null; resolvedFor = wanted; }
    let model = resolved || (wanted === 'auto' ? await pickModel() : wanted);
    if (!model) throw new ApiError(502, 'Hugging Face: no chat model is available for your token — enable an Inference Provider at huggingface.co/settings/inference-providers');
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
      logger.warn({ status: res.status, msg, model }, 'Hugging Face error');
      throw new ApiError(502, `Hugging Face: ${msg}${res.status === 401 ? ' (check token — needs "Make calls to Inference Providers")' : res.status === 402 ? ' (free credits used up)' : ''}`);
    }
    const text = j?.choices?.[0]?.message?.content;
    if (!text) throw new ApiError(502, 'Hugging Face returned no text');
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

/** pull the first JSON object/array out of a model reply (handles ```json fences and chatter) */
export function extractJson(text) {
  const s = String(text).replace(/```(?:json)?/gi, '').trim();
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