// jev-test2 thin backend — zero-dependency Node.js (>=18, global fetch).
//
// Serves the single-page WebUI from public/ and exposes one forwarding
// endpoint (POST /api/evaluate) that relays browser requests to the TypeSafe
// JeV API. The API key never reaches the browser: it is read once at startup
// from the file below and kept only in this process's memory. Logs carry
// request/response metadata only, with the Authorization header redacted.
//
// Start: node server.mjs   (or: npm start)
// Env overrides: PORT (default 8791), HOST (default 127.0.0.1),
//                TYPESAFE_API_KEY_PATH (default ~/.nebflow/secrets/typesafe-api-key),
//                JEV_MAX_LIFETIME_MS (optional hard self-exit deadline, ms).

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendLog } from './lib/log.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const LOG_DIR = path.join(ROOT, 'logs');

const PORT = Number(process.env.PORT || 8791);
const HOST = process.env.HOST || '127.0.0.1';
const API_URL = 'https://api.typesafe.ai/v1/systemone';
const API_KEY_PATH =
  process.env.TYPESAFE_API_KEY_PATH ||
  path.join(homedir(), '.nebflow', 'secrets', 'typesafe-api-key');

// --- API key: read once at startup, kept in memory only. --------------------
// The file holds one bare key line. Never log, echo or embed its value.
function loadApiKey() {
  return readFileSync(API_KEY_PATH, 'utf8').trim();
}

let API_KEY;
try {
  API_KEY = loadApiKey();
} catch (err) {
  console.error(
    `[jev-test2] cannot read API key file at ${API_KEY_PATH}: ${err.message}`
  );
  console.error('[jev-test2] put one bare key line in that file and restart.');
  process.exit(1);
}

// Optional hard self-exit deadline (belt for supervised verify runs; the
// normal stop path is Ctrl+C / SIGTERM, handled at the bottom).
const maxLifetimeMs = Number(process.env.JEV_MAX_LIFETIME_MS || 0);
if (maxLifetimeMs > 0) {
  setTimeout(() => {
    console.error(
      `[jev-test2] JEV_MAX_LIFETIME_MS=${maxLifetimeMs} reached, exiting.`
    );
    process.exit(0);
  }, maxLifetimeMs).unref();
}

// --- Tiny helpers -----------------------------------------------------------

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
  // Metadata only: time, route, upstream endpoint, HTTP status, latency,
  // redacted auth header. Never request/response bodies, never the key.
  appendLog(LOG_DIR, entry);
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

// --- POST /api/evaluate: thin forward to the JeV API ------------------------
// Browser sends { state, questions }; we add model:"jev-latest" and the
// Authorization header server-side, then relay the upstream JSON response.

async function handleEvaluate(req, res) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let upstreamStatus = null;
  let errorNote = null;

  let state;
  let questions;
  try {
    const parsed = JSON.parse(await readBody(req));
    state = parsed.state;
    questions = parsed.questions;
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
      upstream: API_URL,
      status: 400,
      latency_ms: Date.now() - t0,
      auth: 'Authorization: Bearer ***',
      note: errorNote,
    });
    return;
  }

  try {
    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`, // stays inside this process
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state, model: 'jev-latest', questions }),
    });
    upstreamStatus = upstream.status;
    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: 'upstream returned non-JSON response' };
    }
    sendJson(res, upstream.status, payload);
  } catch (err) {
    errorNote = `upstream fetch failed: ${err.message}`;
    sendJson(res, 502, { error: 'failed to reach the JeV API', detail: err.message });
  } finally {
    logMetadata({
      time: startedAt,
      route: 'POST /api/evaluate',
      upstream: API_URL,
      status: upstreamStatus ?? 502,
      latency_ms: Date.now() - t0,
      auth: 'Authorization: Bearer ***',
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
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[jev-test2] listening on http://${HOST}:${PORT}`);
  console.log('[jev-test2] API key loaded from file (kept in memory only).');
});

// Stop paths: Ctrl+C (SIGINT), kill (SIGTERM), JEV_MAX_LIFETIME_MS deadline.
// Closing the server clears the listen handle so the process can exit.
function shutdown(signal) {
  console.log(`[jev-test2] ${signal} received, closing server.`);
  server.close(() => process.exit(0));
  // Failsafe: do not hang on keep-alive sockets.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
