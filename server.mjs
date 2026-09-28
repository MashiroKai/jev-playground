// JeV Playground thin backend — zero-dependency Node.js (>=18, global fetch).
//
// Serves the single-page WebUI from public/ and forwards browser requests to a
// decision backend. Three providers are supported, dispatched by lib/provider.mjs:
//
//   official       hosted TypeSafe JeV  (default — POST api.typesafe.ai/v1/systemone)
//   laya           local decision model (POST <baseUrl>/predict; not OpenAI-shaped)
//   openai-compat  any OpenAI-shaped endpoint (POST <baseUrl>/chat/completions)
//
// The API key never reaches the browser: it is resolved at startup (env, then an
// explicit key file, then the project-root config.json) and kept only in this
// process's memory. It can be replaced at runtime via POST /api/config or
// POST /api/config/api-key: write-only channels whose responses and logs carry
// only ok/length/last-4 fingerprint, never the value. Logs carry request and
// response metadata only — provider name and upstream host, never a full URL,
// never the key, with the Authorization header redacted.
//
// Start: node server.mjs   (or: npm start)
// Env: PORT (default 8791), HOST (default 127.0.0.1), JEV_API_KEY (key value),
//      JEV_API_KEY_PATH (explicit key-file override; TYPESAFE_API_KEY_PATH kept
//      as a legacy alias), JEV_MAX_LIFETIME_MS (optional hard self-exit, ms).

import http from 'node:http';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendLog } from './lib/log.mjs';
import {
  DEFAULTS,
  PRESETS,
  ProviderError,
  defaultBaseUrl,
  defaultModel,
  evaluate,
  isProvider,
  normalizeBaseUrl,
  normalizeModel,
  providerNeedsKey,
  redact,
} from './lib/provider.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const LOG_DIR = path.join(ROOT, 'logs');

const PORT = Number(process.env.PORT || 8791);
const HOST = process.env.HOST || '127.0.0.1';

// Settings live in the project root, not in a user-private directory. The file
// is git-ignored, 0600 owner-only, and holds provider/model/baseUrl plus, when
// the user pastes one, the API key. An explicit key-file override replaces it
// for the key only; that path is never a default.
const CONFIG_PATH = path.join(ROOT, 'config.json');
const EXPLICIT_KEY_PATH =
  process.env.JEV_API_KEY_PATH || process.env.TYPESAFE_API_KEY_PATH || null;

const API_KEY_MIN_LEN = 8;
const API_KEY_MAX_LEN = 4096;
const ALLOWED_PROVIDERS = PRESETS.join(' | ');

// --- settings file (config.json) --------------------------------------------

// The parsed file is kept so unknown/foreign keys survive a rewrite.
let settingsFile = {};

function loadSettingsFile() {
  let raw;
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    return { exists: false, parseError: null, missing: err.code === 'ENOENT' };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { exists: true, parseError: 'not a JSON object', missing: false };
    }
    settingsFile = parsed;
    return { exists: true, parseError: null, missing: false };
  } catch (err) {
    return { exists: true, parseError: err.message, missing: false };
  }
}

const fileState = loadSettingsFile();
if (fileState.parseError) {
  console.error(
    `[jev-playground] config.json is not readable as JSON (${fileState.parseError}); using defaults.`
  );
}

// Active provider configuration. A single flat triple is persisted; switching
// provider without an explicit model/baseUrl falls back to that preset's default.
function pickProvider(value) {
  return isProvider(value) ? value : 'official';
}

let config = {
  provider: pickProvider(settingsFile.provider),
  model: '',
  baseUrl: '',
};

if (typeof settingsFile.model === 'string') config.model = settingsFile.model.trim();
if (typeof settingsFile.baseUrl === 'string') {
  config.baseUrl = settingsFile.baseUrl.trim().replace(/\/+$/, '');
}

function resolvedModel(provider = config.provider) {
  return config.provider === provider
    ? config.model || defaultModel(provider)
    : defaultModel(provider);
}

function resolvedBaseUrl(provider = config.provider) {
  return config.provider === provider
    ? config.baseUrl || defaultBaseUrl(provider)
    : defaultBaseUrl(provider);
}

// --- API key: resolved once at startup, kept in memory only. ----------------
// Priority: JEV_API_KEY env value, then an explicit key file (bare single line),
// then `apiKey` inside the project-root config.json. Never logged, echoed or
// embedded anywhere the browser can read.

function readKeyFromExplicitPath() {
  try {
    const raw = readFileSync(EXPLICIT_KEY_PATH, 'utf8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

let API_KEY = null;
let API_KEY_FROM_ENV = false;

function resolveApiKey() {
  const env = String(process.env.JEV_API_KEY || '').trim();
  if (env !== '') {
    API_KEY_FROM_ENV = true;
    return env;
  }
  if (EXPLICIT_KEY_PATH) return readKeyFromExplicitPath();
  const fromFile = typeof settingsFile.apiKey === 'string' ? settingsFile.apiKey.trim() : '';
  return fromFile || null;
}

API_KEY = resolveApiKey();

function apiKeyConfigured() {
  return API_KEY !== null;
}

function apiKeyFingerprint(key) {
  return `…${key.slice(-4)}`;
}

// Ready to serve a request for `provider`: the key is present when the provider
// requires one, and the parameters that cannot be defaulted are filled in.
function providerReady(provider = config.provider) {
  const preset = DEFAULTS[provider] || {};
  if (preset.needsKey && !apiKeyConfigured()) return false;
  if (preset.needsBaseUrl && !resolvedBaseUrl(provider)) return false;
  if (preset.needsModel && !resolvedModel(provider)) return false;
  return true;
}

// --- persistence (0600 owner-only, in-place rewrite keeps the inode) --------

function writeFilePreservingInode(filePath, body) {
  let before = null;
  try {
    before = statSync(filePath);
  } catch {
    before = null; // no file yet: create it below
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (before) {
    const fd = openSync(filePath, 'r+');
    try {
      writeSync(fd, body, 0, body.length, 0);
      ftruncateSync(fd, body.length);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(filePath, 0o600);
    const after = statSync(filePath);
    if (after.ino !== before.ino) {
      console.error(
        `[jev-playground] warning: file inode changed during in-place write (was ${before.ino}, now ${after.ino})`
      );
    }
  } else {
    writeFileSync(filePath, body, { mode: 0o600 });
    chmodSync(filePath, 0o600);
  }
}

// The key target is the explicit override file when one is set (bare single
// line, legacy shape), otherwise the project-root config.json.
function persistApiKey(key) {
  if (EXPLICIT_KEY_PATH && EXPLICIT_KEY_PATH !== CONFIG_PATH) {
    writeFilePreservingInode(EXPLICIT_KEY_PATH, Buffer.from(key, 'utf8'));
    return;
  }
  writeFilePreservingInode(
    CONFIG_PATH,
    Buffer.from(JSON.stringify({ ...settingsFile, apiKey: key }, null, 2) + '\n', 'utf8')
  );
}

function commitSettingsFile(next) {
  writeFilePreservingInode(
    CONFIG_PATH,
    Buffer.from(JSON.stringify(next, null, 2) + '\n', 'utf8')
  );
}

// --- helpers ----------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function logMetadata(entry) {
  // Metadata only — provider name, upstream host, status, latency, model and a
  // redacted auth marker. Never a full URL, never request/response bodies,
  // never the key.
  appendLog(LOG_DIR, entry);
}

// Validate a key string; throws with a stable message when it cannot be stored.
function validateApiKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (key === '') throw new Error('"apiKey" must be a non-empty string');
  if (/[\r\n]/.test(key)) {
    throw new Error('"apiKey" must be a single line (no embedded newlines)');
  }
  if (key.length < API_KEY_MIN_LEN || key.length > API_KEY_MAX_LEN) {
    throw new Error(
      `"apiKey" length must be between ${API_KEY_MIN_LEN} and ${API_KEY_MAX_LEN} characters`
    );
  }
  return key;
}

// --- POST /api/config  ·  GET /api/config ------------------------------------
// GET answers 200 even on a fresh instance with no key: it reports
// { provider, configured:false, presets, model, baseUrl, ... } and never 500.

function configPayload() {
  const provider = config.provider;
  const preset = DEFAULTS[provider] || {};
  return {
    provider,
    configured: providerReady(provider),
    presets: [...PRESETS],
    model: resolvedModel(provider),
    baseUrl: resolvedBaseUrl(provider),
    keyConfigured: apiKeyConfigured(),
    keyRequired: Boolean(preset.needsKey),
    modelRequired: Boolean(preset.needsModel),
    baseUrlRequired: Boolean(preset.needsBaseUrl),
    // Per-preset defaults so the settings panel never has to hardcode them.
    defaults: Object.fromEntries(
      PRESETS.map((id) => [
        id,
        {
          baseUrl: defaultBaseUrl(id),
          model: defaultModel(id),
          keyRequired: Boolean(DEFAULTS[id]?.needsKey),
          modelRequired: Boolean(DEFAULTS[id]?.needsModel),
          baseUrlRequired: Boolean(DEFAULTS[id]?.needsBaseUrl),
        },
      ])
    ),
  };
}

async function handleGetConfig(req, res) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  sendJson(res, 200, configPayload());
  logMetadata({
    time: startedAt,
    route: 'GET /api/config',
    provider: config.provider,
    status: 200,
    latency_ms: Date.now() - t0,
    note: `configured=${configPayload().configured}`,
  });
}

async function handleSetConfig(req, res) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let status = 400;
  let note = null;
  let length = null;
  let fingerprint = null;
  try {
    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      // Fixed message on purpose: JSON.parse errors can quote body fragments.
      throw new Error(
        'request body must be JSON: {"provider":"official|laya|openai-compat","baseUrl":"…","model":"…","apiKey":"…"}'
      );
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('request body must be a JSON object');
    }

    const nextProvider =
      parsed.provider === undefined || parsed.provider === null
        ? config.provider
        : parsed.provider;
    if (!isProvider(nextProvider)) {
      throw new Error(`"provider" must be one of: ${ALLOWED_PROVIDERS}`);
    }

    const switching = nextProvider !== config.provider;
    // A model/baseUrl left out while switching provider falls back to the new
    // preset's default rather than carrying the previous provider's value.
    const baseSeed = switching ? '' : config.baseUrl;
    const modelSeed = switching ? '' : config.model;

    let nextBaseUrl = baseSeed || defaultBaseUrl(nextProvider);
    if (parsed.baseUrl !== undefined && parsed.baseUrl !== null) {
      nextBaseUrl = normalizeBaseUrl(parsed.baseUrl, nextProvider);
    } else if (nextBaseUrl) {
      nextBaseUrl = normalizeBaseUrl(nextBaseUrl, nextProvider);
    }

    let nextModel = normalizeModel(parsed.model, nextProvider, modelSeed);

    const incomingKey =
      parsed.apiKey === undefined || parsed.apiKey === null
        ? null
        : validateApiKey(parsed.apiKey);

    // Persist before committing to memory: a failed write must not change the
    // live state. The key goes to the explicit override file when one is set,
    // otherwise into config.json next to provider/model/baseUrl.
    const separateKeyFile = Boolean(EXPLICIT_KEY_PATH && EXPLICIT_KEY_PATH !== CONFIG_PATH);

    const nextFile = {
      ...settingsFile,
      provider: nextProvider,
      model: nextModel,
      baseUrl: nextBaseUrl,
    };
    if (separateKeyFile || incomingKey === null) {
      // Keep whatever key config.json already holds; it is not ours to drop.
      if (incomingKey === null) nextFile.apiKey = settingsFile.apiKey;
      else delete nextFile.apiKey;
    } else {
      nextFile.apiKey = incomingKey;
    }
    commitSettingsFile(nextFile);
    if (separateKeyFile && incomingKey !== null) {
      writeFilePreservingInode(EXPLICIT_KEY_PATH, Buffer.from(incomingKey, 'utf8'));
    }

    // Commit to memory only after every write succeeded.
    settingsFile = { ...nextFile };
    config = { provider: nextProvider, model: nextModel, baseUrl: nextBaseUrl };
    if (incomingKey !== null) {
      API_KEY = incomingKey;
      API_KEY_FROM_ENV = false;
      length = incomingKey.length;
      fingerprint = apiKeyFingerprint(incomingKey);
    }

    status = 200;
    note = `provider config updated (provider=${nextProvider}, model=${nextModel})`;
    const body = { ok: true, provider: nextProvider, model: nextModel };
    if (length !== null) {
      body.length = length;
      body.fingerprint = fingerprint;
    }
    sendJson(res, 200, body);
  } catch (err) {
    if (note === null) note = `rejected: ${err.message}`;
    sendJson(res, status, { error: err.message });
  } finally {
    logMetadata({
      time: startedAt,
      route: 'POST /api/config',
      provider: config.provider,
      status,
      latency_ms: Date.now() - t0,
      length,
      note,
    });
  }
}

// --- POST /api/config/api-key (write-only key channel, kept for compatibility)

async function handleSetApiKey(req, res) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let status = 400; // request-side problems answer 400
  let note = null;
  let length = null;
  try {
    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      // Fixed message on purpose: JSON.parse errors can quote body fragments.
      throw new Error('request body must be JSON: {"apiKey":"..."}');
    }
    const key = validateApiKey(parsed.apiKey);
    try {
      persistApiKey(key);
    } catch (persistErr) {
      status = 500; // disk-level failure: the in-memory key is untouched
      note = `api key persist failed: ${persistErr.message}`;
      throw new Error('failed to store the API key');
    }
    API_KEY = key; // next evaluate uses the new value immediately, no restart
    API_KEY_FROM_ENV = false;
    status = 200;
    length = key.length;
    note = `api key updated via settings endpoint (length ${length})`;
    sendJson(res, 200, {
      ok: true,
      length,
      fingerprint: apiKeyFingerprint(key),
    });
  } catch (err) {
    if (note === null) note = `rejected: ${err.message}`;
    sendJson(res, status, { error: err.message });
  } finally {
    logMetadata({
      time: startedAt,
      route: 'POST /api/config/api-key',
      status,
      latency_ms: Date.now() - t0,
      auth: 'Authorization: Bearer ***',
      length,
      note,
    });
  }
}

// Optional hard self-exit deadline (belt for supervised verify runs; the
// normal stop path is Ctrl+C / SIGTERM, handled at the bottom).
const maxLifetimeMs = Number(process.env.JEV_MAX_LIFETIME_MS || 0);
if (maxLifetimeMs > 0) {
  setTimeout(() => {
    console.error(
      `[jev-playground] JEV_MAX_LIFETIME_MS=${maxLifetimeMs} reached, exiting.`
    );
    process.exit(0);
  }, maxLifetimeMs).unref();
}

// --- GET: static single page ------------------------------------------------

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  let data;
  try {
    data = readFileSync(filePath);
  } catch {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

// --- POST /api/evaluate: dispatch to the selected provider -------------------
// Browser sends { state, questions, provider? }; a missing provider means
// "official", so an older client keeps behaving exactly as before. The model,
// the endpoint and the credentials are resolved server-side.

async function handleEvaluate(req, res) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let upstreamStatus = null;
  let errorNote = null;
  let provider = config.provider;
  let upstreamHost = null;
  let authUsed = false;

  let state;
  let questions;
  let requested;
  try {
    const parsed = JSON.parse(await readBody(req));
    state = parsed.state;
    questions = parsed.questions;
    requested = parsed.provider;
    if (requested !== undefined && requested !== null) {
      if (typeof requested !== 'string' || !isProvider(requested)) {
        throw new Error(`"provider" must be one of: ${ALLOWED_PROVIDERS}`);
      }
      provider = requested;
    }
    if (typeof state !== 'string' || state.trim() === '') {
      throw new Error('"state" must be a non-empty string');
    }
    if (
      questions === null ||
      typeof questions !== 'object' ||
      Array.isArray(questions) ||
      Object.keys(questions).length === 0
    ) {
      throw new Error('"questions" must be a non-empty object');
    }
    for (const [id, q] of Object.entries(questions)) {
      if (q === null || typeof q !== 'object' || Array.isArray(q)) {
        throw new Error(`question "${id}" must be an object`);
      }
    }
  } catch (err) {
    errorNote = `bad request: ${err.message}`;
    sendJson(res, 400, { error: err.message });
    logMetadata({
      time: startedAt,
      route: 'POST /api/evaluate',
      provider,
      status: 400,
      latency_ms: Date.now() - t0,
      auth: null, // rejected before any upstream call
      note: errorNote,
    });
    return;
  }

  // Unconfigured: answer with a clear, actionable error instead of attempting
  // an upstream call that cannot succeed. No key-shaped string can appear in
  // this response — there is no key yet.
  if (!providerReady(provider)) {
    const missing = providerNeedsKey(provider)
      ? 'no API key'
      : `missing ${resolvedModel(provider) ? 'base URL' : 'model/base URL'}`;
    errorNote = `not configured for provider "${provider}": ${missing}`;
    sendJson(res, 503, {
      error: providerNeedsKey(provider)
        ? 'API key is not configured — open Settings and paste a key first'
        : `provider "${provider}" is not fully configured — open Settings`,
      provider,
    });
    logMetadata({
      time: startedAt,
      route: 'POST /api/evaluate',
      provider,
      status: 503,
      latency_ms: Date.now() - t0,
      auth: null, // no credential was used: the request never left this process
      note: errorNote,
    });
    return;
  }

  const cfg = {
    apiKey: API_KEY,
    baseUrl: resolvedBaseUrl(provider),
    model: resolvedModel(provider),
  };
  authUsed = Boolean(cfg.apiKey);

  try {
    const result = await evaluate(provider, cfg, { state, questions });
    upstreamStatus = result.status;
    upstreamHost = result.host;
    sendJson(res, result.status, result.body);
  } catch (err) {
    if (err instanceof ProviderError) {
      upstreamStatus = err.status;
      errorNote = redact(err.message);
      const body = { error: redact(err.message), provider };
      if (err.detail) body.detail = redact(err.detail);
      sendJson(res, err.status, body);
    } else {
      upstreamStatus = 502;
      errorNote = `upstream fetch failed: ${redact(err.message)}`;
      sendJson(res, 502, {
        error: `failed to reach the "${provider}" provider`,
        detail: redact(err.message),
        provider,
      });
    }
  } finally {
    logMetadata({
      time: startedAt,
      route: 'POST /api/evaluate',
      provider,
      upstream_host: upstreamHost,
      model: cfg.model,
      status: upstreamStatus ?? 502,
      latency_ms: Date.now() - t0,
      auth: authUsed ? 'Authorization: Bearer ***' : null,
      note: errorNote ?? 'ok',
    });
  }
}

// --- Server wiring ----------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    .pathname;
  if (req.method === 'GET' && (pathname === '/' || !pathname.startsWith('/api'))) {
    serveStatic(req, res, pathname);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/evaluate') {
    await handleEvaluate(req, res);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/config') {
    await handleGetConfig(req, res);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/config') {
    await handleSetConfig(req, res);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/config/api-key') {
    await handleSetApiKey(req, res);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/config/api-key/status') {
    sendJson(res, 200, { configured: apiKeyConfigured() });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[jev-playground] listening on http://${HOST}:${PORT}`);
  console.log(`[jev-playground] provider: ${config.provider} · model ${resolvedModel()}`);
  if (apiKeyConfigured()) {
    console.log(
      `[jev-playground] API key loaded${API_KEY_FROM_ENV ? ' from the environment' : ''} (kept in memory only).`
    );
  } else {
    console.log(
      '[jev-playground] API key: not configured — set it in the WebUI settings.'
    );
    if (!fileState.exists && !EXPLICIT_KEY_PATH) {
      console.log(
        '[jev-playground] first run: the settings panel will create config.json in this project'
          + ' (0600, git-ignored) when you paste a key; alternatively set JEV_API_KEY.'
      );
    }
  }
});

// Stop paths: Ctrl+C (SIGINT), kill (SIGTERM), JEV_MAX_LIFETIME_MS deadline.
// Closing the server clears the listen handle so the process can exit.
function shutdown(signal) {
  console.log(`[jev-playground] ${signal} received, closing server.`);
  server.close(() => process.exit(0));
  // Failsafe: do not hang on keep-alive sockets.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
