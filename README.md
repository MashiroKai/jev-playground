# jev-test2

A minimal local test app for the TypeSafe JeV model: a single-page WebUI where you enter a state plus typed questions and see the answers with confidence, backed by a thin Node.js server that forwards requests to the JeV HTTP API (`https://api.typesafe.ai/v1/systemone`). The API key never touches the browser; it is read once at server startup from `~/.nebflow/secrets/typesafe-api-key` and kept only in the backend process, and request logs carry metadata only with the Authorization header redacted.

Note: JeV takes `criteria` for choice questions as an object mapping each option label to a description (or `null`), and for score questions as an ordered array of level labels.

## Run

```
node server.mjs
```

(No dependencies to install; requires Node.js 18+. Optional overrides: `PORT`, `HOST`, `TYPESAFE_API_KEY_PATH`, `JEV_MAX_LIFETIME_MS`.)

Missing or empty key file? The server still starts and logs `API key: not configured — set it in the WebUI settings`; evaluate requests then answer `503` with a hint until you paste a key in the settings panel — no restart needed.

## Open

Open http://127.0.0.1:8791 in your browser, edit the state text and questions, and click "Ask JeV".

## Files

- `server.mjs` — zero-dependency backend: serves `public/` and forwards `POST /api/evaluate` to JeV
- `public/index.html` — the single-page WebUI (state input, question rows, confidence display, ⚙ settings panel)
- API key settings — the key can be replaced at runtime from the WebUI settings (⚙ button in the header): `POST /api/config/api-key` validates and stores it (0600 owner-only; in-place rewrite that preserves the inode) at `~/.nebflow/secrets/typesafe-api-key` or `$TYPESAFE_API_KEY_PATH`, and the backend switches to it immediately without a restart. Responses and logs carry only ok / length / last-4 fingerprint — the key itself is never echoed; `GET /api/config/api-key/status` reports just `{configured}`
- `lib/log.mjs` — JSONL metadata logger (time, endpoint, status, latency; auth redacted) → `logs/requests.log`
- `scripts/selfcheck.mjs` — headless end-to-end check: starts the server, makes one real JeV call, stops everything
