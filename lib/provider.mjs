// Provider dispatch layer for JeV Playground.
//
// One entry point, three presets, three genuinely different wire protocols:
//
//   official        hosted TypeSafe JeV       POST https://api.typesafe.ai/v1/systemone
//   laya            local decision model      POST <baseUrl>/predict          (NOT OpenAI-shaped)
//   openai-compat   any OpenAI-shaped server  POST <baseUrl>/chat/completions
//
// `evaluate(provider, cfg, { state, questions })` returns
// `{ status, body, host }`: `status` is the HTTP status the backend relays to the
// browser, `body` is the payload (always carrying `provider`), `host` is the
// upstream host name for the metadata log (never a full URL).
//
// Confidence semantics differ by provider:
//   official        read straight from the upstream answer
//   laya            read from the upstream answer
//   openai-compat   DERIVED from the model's own reply — parsed out of its JSON
//                   answers, or from logprobs when the endpoint returns them.
//                   When it cannot be derived the answer carries confidence null
//                   and confidence_source "derived". `confidence_source` is
//                   echoed per answer and once for the whole response
//                   ("derived" if any answer was underivable, else "logprobs" if
//                   any was logprob-derived, else "parsed").
//
// Discipline: the API key lives only in process memory and in the Authorization
// header; bodies are never logged; upstream error text goes through redact() so
// a full URL never reaches a log line or a response body.

export const OFFICIAL_URL = 'https://api.typesafe.ai/v1/systemone';
export const OFFICIAL_HOST = 'api.typesafe.ai';
export const PRESETS = Object.freeze(['official', 'laya', 'openai-compat']);

// Per-preset defaults. `needsModel` / `needsBaseUrl` mark the parameters that
// must be present before a call can be attempted; `needsKey` marks providers
// that cannot work without a key (only official — LAYA is loopback, and an
// OpenAI-compatible server may be unauthenticated).
export const DEFAULTS = Object.freeze({
  official: Object.freeze({
    baseUrl: '',
    model: 'jev-1.13.0',
    needsBaseUrl: false,
    needsModel: false,
    needsKey: true,
  }),
  laya: Object.freeze({
    baseUrl: 'http://127.0.0.1:8000',
    model: 'laya',
    needsBaseUrl: false,
    needsModel: false,
    needsKey: false,
  }),
  'openai-compat': Object.freeze({
    baseUrl: '',
    model: '',
    needsBaseUrl: true,
    needsModel: true,
    needsKey: false,
  }),
});

const MODEL_MAX_LEN = 200;
const BASE_URL_MAX_LEN = 2048;

export function isProvider(id) {
  return PRESETS.includes(id);
}

export function defaultModel(id) {
  return (DEFAULTS[id] && DEFAULTS[id].model) || '';
}

export function defaultBaseUrl(id) {
  return (DEFAULTS[id] && DEFAULTS[id].baseUrl) || '';
}

export function providerNeedsKey(id) {
  return Boolean(DEFAULTS[id] && DEFAULTS[id].needsKey);
}

// A provider/transport problem worth a specific HTTP status. The backend maps
// `status` onto the browser response; `detail` is already redacted.
export class ProviderError extends Error {
  constructor(message, { status = 502, detail = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.detail = detail === null ? null : redact(detail);
  }
}

// Never let a full URL reach a log line or a response body.
export function redact(text) {
  return String(text).replace(/https?:\/\/[^\s"'<>]+/g, '[url]');
}

export function joinUrl(base, suffix) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  return b + (suffix.startsWith('/') ? suffix : `/${suffix}`);
}

// Host name only (may include a port): the metadata log records this instead of
// a full endpoint URL.
export function hostOf(url) {
  try {
    return new URL(url).host || 'unknown-host';
  } catch {
    return 'invalid-url';
  }
}

// Validate a user-supplied base URL. Returns the normalized value (no trailing
// slash) or throws a 400 ProviderError so the settings endpoint can answer 4xx.
export function normalizeBaseUrl(raw, provider) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (value === '') {
    if (DEFAULTS[provider] && DEFAULTS[provider].needsBaseUrl) {
      throw new ProviderError(`"baseUrl" is required for provider "${provider}"`, {
        status: 400,
      });
    }
    return '';
  }
  if (value.length > BASE_URL_MAX_LEN) {
    throw new ProviderError(`"baseUrl" must be at most ${BASE_URL_MAX_LEN} characters`, {
      status: 400,
    });
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProviderError('"baseUrl" must be an absolute http(s) URL', { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProviderError('"baseUrl" must be an absolute http(s) URL', { status: 400 });
  }
  return value;
}

// Validate a model name. Returns the normalized value or throws a 400.
export function normalizeModel(raw, provider, fallback = '') {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    throw new ProviderError('"model" must be a string', { status: 400 });
  }
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') {
    if (DEFAULTS[provider] && DEFAULTS[provider].needsModel) {
      throw new ProviderError(`"model" is required for provider "${provider}"`, {
        status: 400,
      });
    }
    return fallback || defaultModel(provider);
  }
  if (value.length > MODEL_MAX_LEN) {
    throw new ProviderError(`"model" must be at most ${MODEL_MAX_LEN} characters`, {
      status: 400,
    });
  }
  return value;
}

// --- shared helpers ---------------------------------------------------------

async function readJson(res) {
  const text = await res.text();
  try {
    return { ok: true, payload: JSON.parse(text) };
  } catch {
    return { ok: false, payload: null, text };
  }
}

function withProvider(payload, provider) {
  const base =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : { upstream: payload };
  return { ...base, provider };
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// `confidence` accepts both the bare numeric form and the object form
// ({confidence: 0.8, ...} / {value: 0.8, ...}). A field that does not exist is
// left alone (never invented, never replaced by an empty string).
function coerceConfidence(v) {
  if (typeof v === 'number') return v;
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const inner = num(v.confidence) ?? num(v.value) ?? num(v.score);
    if (inner !== null) return inner;
  }
  return null;
}

function normalizeConfidence(body) {
  const answers = body && body.answers;
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) return;
  for (const answer of Object.values(answers)) {
    if (answer === null || typeof answer !== 'object') continue;
    if (answer.confidence !== undefined && typeof answer.confidence !== 'number') {
      const value = coerceConfidence(answer.confidence);
      if (value !== null) answer.confidence = value;
    }
  }
}

function requireAnswers(body, provider) {
  const answers = body && body.answers;
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new ProviderError(`${provider}: upstream response has no "answers" object`, {
      status: 502,
    });
  }
  return answers;
}

// --- official: hosted TypeSafe JeV ------------------------------------------

async function callOfficial(cfg, { state, questions }) {
  const res = await fetch(OFFICIAL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`, // stays inside this process
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state, model: cfg.model, questions }),
  });
  const parsed = await readJson(res);
  // A non-JSON body keeps its upstream status and the historical placeholder
  // error object; nothing is fabricated from it.
  const payload = parsed.ok ? parsed.payload : { error: 'upstream returned non-JSON response' };
  const body = withProvider(payload, 'official');
  if (res.status === 200) requireAnswers(body, 'official');
  normalizeConfidence(body);
  if (!body.model) body.model = cfg.model;
  return { status: res.status, body, host: OFFICIAL_HOST };
}

// --- laya: local decision-model server (predict(state, questions)) ----------

async function callLaya(cfg, { state, questions }) {
  const base = cfg.baseUrl || defaultBaseUrl('laya');
  const url = joinUrl(base, '/predict');
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`; // loopback servers usually need none
  const res = await fetch(url, {
    method: 'POST',
    headers,
    // Questions are forwarded verbatim (no criteria array -> dict rewriting).
    body: JSON.stringify({ state, model: cfg.model, questions }),
  });
  const parsed = await readJson(res);
  if (!parsed.ok) {
    throw new ProviderError('LAYA returned a non-JSON response', {
      status: 502,
      detail: `HTTP ${res.status} from ${hostOf(url)}`,
    });
  }
  const body = withProvider(parsed.payload, 'laya');
  if (res.status === 200) requireAnswers(body, 'laya');
  normalizeConfidence(body);
  if (!body.model) body.model = cfg.model;
  return { status: res.status, body, host: hostOf(url) };
}

// --- openai-compat: any OpenAI-shaped endpoint ------------------------------

const OAI_SYSTEM = [
  'You answer typed questions about a state.',
  'Reply with one JSON object and nothing else, shaped exactly like:',
  '{"answers":{"<question id>":{"confidence":<number 0..1>}}}',
  'One entry per question id given in the input, never fewer.',
  'For a "noul" question add "noul" (probability the statement is true, 0..1).',
  'For a "choice" question add "choice" (one of the criteria labels) and, if you can,',
  '"probabilities" mapping every criteria label to a probability.',
  'For a "score" question add "score" (a level taken from the criteria array) and,',
  'if you can, "probabilities" keyed by level.',
  'Always include "confidence" (your calibrated probability that your answer is right)',
  'for choice and score questions.',
].join(' ');

function parseJsonObject(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const attempts = [text];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

// Probability of the token span that spells `needle` inside the reply, derived
// from the endpoint's logprobs. Returns null when the span cannot be located or
// any token in it has no logprob — a guess is never substituted for a reading.
function spanProbability(tokens, needle) {
  if (!needle || !Array.isArray(tokens) || tokens.length === 0) return null;
  const spans = [];
  let text = '';
  for (const token of tokens) {
    const value = typeof token?.token === 'string' ? token.token : '';
    spans.push({
      start: text.length,
      end: text.length + value.length,
      logprob: num(token?.logprob),
    });
    text += value;
  }
  const at = text.indexOf(needle);
  if (at < 0) return null;
  const end = at + needle.length;
  let product = 1;
  let counted = 0;
  for (const span of spans) {
    if (span.end <= at || span.start >= end) continue;
    if (span.logprob === null) return null;
    product *= Math.exp(span.logprob);
    counted += 1;
  }
  if (counted === 0) return null;
  return Math.min(1, Math.max(0, product));
}

function answerValue(entry, type) {
  if (type === 'noul') {
    const p = num(entry.noul) ?? num(entry.p_yes);
    return p === null ? null : p;
  }
  if (type === 'choice') return typeof entry.choice === 'string' ? entry.choice : null;
  if (type === 'score') {
    const s = num(entry.score);
    return s === null ? null : String(entry.score);
  }
  return null;
}

// Derive one answer's confidence: model-reported value first, then its own
// probability distribution, then the token logprobs. Never invents a number.
function deriveAnswer(id, question, entry, tokens) {
  const type = typeof entry.type === 'string' && entry.type ? entry.type : question.type;
  const answer = { ...entry, type, id };
  delete answer.confidence_source;

  let value = num(entry.confidence);
  let source = value === null ? null : 'parsed';

  if (value === null && type === 'noul') {
    const p = num(entry.noul) ?? num(entry.p_yes);
    if (p !== null) {
      answer.noul = p;
      value = p;
      source = 'parsed';
    }
  }

  if (value === null && entry.probabilities !== null && typeof entry.probabilities === 'object') {
    const label = answerValue(entry, type);
    if (label !== null) {
      const p = num(entry.probabilities[label]);
      if (p !== null) {
        value = p;
        source = 'parsed';
      }
    }
  }

  if (value === null && tokens) {
    const label = answerValue(entry, type);
    const p = spanProbability(tokens, label);
    if (p !== null) {
      value = p;
      source = 'logprobs';
    }
  }

  if (value === null) {
    // Explicit null plus the marker: an underivable confidence is stated on the
    // wire rather than left as a silently missing field.
    answer.confidence = null;
    answer.confidence_source = 'derived';
    return { answer, source: 'derived' };
  }
  answer.confidence = value;
  answer.confidence_source = source;
  return { answer, source };
}

async function callOpenAICompat(cfg, { state, questions }) {
  if (!cfg.baseUrl) {
    throw new ProviderError('openai-compat needs a base URL — save one in Settings', {
      status: 400,
    });
  }
  if (!cfg.model) {
    throw new ProviderError('openai-compat needs a model name — save one in Settings', {
      status: 400,
    });
  }
  const url = joinUrl(cfg.baseUrl, '/chat/completions');
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const messages = [
    { role: 'system', content: OAI_SYSTEM },
    { role: 'user', content: JSON.stringify({ state, questions }, null, 2) },
  ];

  let res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0,
      logprobs: true,
      top_logprobs: 3,
      response_format: { type: 'json_object' },
    }),
  });
  let parsed = await readJson(res);
  if (res.status === 400) {
    // Some self-hosted servers reject the optional JSON-mode / logprob knobs —
    // retry once with the minimal OpenAI body before reporting a failure.
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0 }),
    });
    parsed = await readJson(res);
  }

  if (!parsed.ok) {
    throw new ProviderError('OpenAI-compatible endpoint returned a non-JSON response', {
      status: 502,
      detail: `HTTP ${res.status} from ${hostOf(url)}`,
    });
  }
  if (res.status !== 200) {
    return { status: res.status, body: withProvider(parsed.payload, 'openai-compat'), host: hostOf(url) };
  }

  const choice = Array.isArray(parsed.payload?.choices) ? parsed.payload.choices[0] : null;
  const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const reply = parseJsonObject(content);
  if (!reply || reply.answers === null || typeof reply.answers !== 'object' || Array.isArray(reply.answers)) {
    throw new ProviderError('the model reply did not contain a JSON answers object', {
      status: 502,
      detail: `upstream host ${hostOf(url)}`,
    });
  }

  const tokens = Array.isArray(choice?.logprobs?.content) ? choice.logprobs.content : null;
  const answers = {};
  const missing = [];
  const sources = [];
  for (const [id, question] of Object.entries(questions)) {
    const entry = reply.answers[id];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      missing.push(id);
      continue;
    }
    const derived = deriveAnswer(id, question, entry, tokens);
    answers[id] = derived.answer;
    sources.push(derived.source);
  }
  if (missing.length > 0) {
    throw new ProviderError(`the model reply is missing answers for: ${missing.join(', ')}`, {
      status: 502,
    });
  }

  const confidenceSource = sources.includes('derived')
    ? 'derived'
    : sources.includes('logprobs')
      ? 'logprobs'
      : 'parsed';

  const body = {
    provider: 'openai-compat',
    model: parsed.payload?.model || cfg.model,
    answers,
    confidence_source: confidenceSource,
  };
  const usage = parsed.payload?.usage;
  if (usage !== null && typeof usage === 'object') {
    body.usage = {
      input_tokens: num(usage.prompt_tokens) ?? num(usage.input_tokens),
      output_tokens: num(usage.completion_tokens) ?? num(usage.output_tokens),
    };
  }
  return { status: 200, body, host: hostOf(url) };
}

// --- dispatcher -------------------------------------------------------------

export async function evaluate(provider, cfg, { state, questions }) {
  switch (provider) {
    case 'official':
      return callOfficial(cfg, { state, questions });
    case 'laya':
      return callLaya(cfg, { state, questions });
    case 'openai-compat':
      return callOpenAICompat(cfg, { state, questions });
    default:
      throw new ProviderError(`unknown provider "${provider}"`, { status: 400 });
  }
}
