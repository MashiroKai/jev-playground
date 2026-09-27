// Append-only JSONL metadata logger for requests.
// Every entry is metadata only: time, route, upstream endpoint, HTTP status,
// latency, redacted auth header, short note. Values are produced by
// server.mjs, which never includes the API key or request/response bodies.

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function appendLog(logDir, entry) {
  try {
    mkdirSync(logDir, { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(path.join(logDir, 'requests.log'), line);
  } catch (err) {
    // Logging must never take the request path down.
    console.error(`[jev-test2] failed to append log entry: ${err.message}`);
  }
}
