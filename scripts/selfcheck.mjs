// Headless end-to-end self-check for JeV Playground (batch-form, self-exiting).
//
// D-2 compliance: one independent invocation per round; every sample is
// written to disk as its own file; the script starts the server as a child
// process with a hard kill timer and always tears it down, so the exit code
// is guaranteed by the script and the whole run self-exits well under 120s.
//
// Usage: node scripts/selfcheck.mjs
// Evidence: logs/selfcheck-request.json, logs/selfcheck-response.json,
//           logs/selfcheck-summary.json (+ server JSONL in logs/requests.log)

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, 'logs');
const PORT = Number(process.env.PORT || 8791);
const BASE = `http://127.0.0.1:${PORT}`;

mkdirSync(LOG_DIR, { recursive: true });

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, JEV_MAX_LIFETIME_MS: '60000' }, // server-side belt
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

function stopServer() {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
  }
}

function finish(code, note) {
  stopServer();
  // Failsafe: never let a stuck child hang this script.
  setTimeout(() => process.exit(code), 4000).unref();
  server.once('exit', () => process.exit(code));
  console.log(`[selfcheck] ${note}`);
}

// Hard deadline for the whole check: self-exit inside 120s no matter what.
const deadline = setTimeout(() => finish(1, 'deadline hit, exiting'), 90_000);
deadline.unref();

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  const up = await waitForServer();
  if (!up) throw new Error(`server did not become healthy. Log:\n${serverLog}`);

  const requestPayload = {
    state: 'Help! My payouts have been failing for 3 days and I need this fixed today.',
    questions: {
      q1: { type: 'noul', instructions: 'Does this convey urgency?' },
      q2: {
        type: 'choice',
        instructions: "What is the customer's tone?",
        criteria: { calm: null, frustrated: 'annoyed but civil', angry: 'hostile or cursing' },
      },
      q3: {
        type: 'score',
        instructions: 'How urgent is this ticket?',
        criteria: ['can wait', 'this week', 'today'],
      },
    },
  };
  writeFileSync(
    path.join(LOG_DIR, 'selfcheck-request.json'),
    JSON.stringify(requestPayload, null, 2) + '\n'
  );

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload),
  });
  const latencyMs = Date.now() - t0;
  const data = await res.json();
  writeFileSync(
    path.join(LOG_DIR, 'selfcheck-response.json'),
    JSON.stringify(data, null, 2) + '\n'
  );

  const answerIds = Object.keys(data.answers || {});
  const confidence = {};
  for (const [id, a] of Object.entries(data.answers || {})) {
    confidence[id] = a.type === 'noul'
      ? { type: 'noul', p_yes: a.noul, confidence: null }
      : { type: a.type, confidence: a.confidence };
  }
  const summary = {
    http_status: res.status,
    latency_ms: latencyMs,
    model: data.model ?? null,
    answer_ids: answerIds,
    answers: confidence,
    usage: data.usage ?? null,
    confidence_fields_present: Object.values(confidence).some(
      (a) => typeof a.confidence === 'number'
    ),
  };
  writeFileSync(
    path.join(LOG_DIR, 'selfcheck-summary.json'),
    JSON.stringify(summary, null, 2) + '\n'
  );

  if (res.status !== 200) {
    throw new Error(`expected HTTP 200, got ${res.status}: ${JSON.stringify(data)}`);
  }
  if (!summary.confidence_fields_present) {
    throw new Error('no confidence field found in choice/score answers');
  }

  console.log('[selfcheck] PASS', JSON.stringify(summary));
  finish(0, 'self-check finished, server stopped');
} catch (err) {
  console.error('[selfcheck] FAIL:', err.message);
  finish(1, 'self-check failed, server stopped');
}
