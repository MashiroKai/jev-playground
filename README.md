# jev-test

A minimal JeV tester — a local, single-page web app for trying out the TypeSafe JeV model: type a state, add a few typed questions, and read the answers with confidence.

[JeV](https://docs.typesafe.ai/introduction) is TypeSafe's JeV model: you hand it a state plus typed questions, and it answers with calibrated confidence. This tool is a thin harness around it: the browser page collects a State and any number of question rows and shows each answer with its confidence, while a zero-dependency Node.js backend forwards requests to the JeV HTTP API (`https://api.typesafe.ai/v1/systemone`). The API key never touches the browser: it lives only in the backend process, and request logs carry metadata only, with the Authorization header redacted.

> Testing tool, not for production use.

## Features

| Feature | What it does |
|---|---|
| State input | free-form text that JeV should evaluate |
| Multiple question rows | three types per row: `noul` (yes/no), `choice` (pick one, 2–255 options), `score` (2–10 ordered levels) |
| Confidence echo | every answer comes back with its confidence; `choice`/`score` also show per-option probabilities, `noul` shows P(yes) |
| Browser-configurable API key | ⚙ settings panel is write-only — the key is never displayed again, never echoed; it hot-switches at runtime, no restart |
| One-command start | `node server.mjs` — zero dependencies, Node.js 18+ |

JeV takes `criteria` for `choice` questions as an object mapping each option label to a description (or `null`), and for `score` questions as an ordered array of level labels.

## Quickstart

```
node server.mjs
```

No dependencies to install; requires Node.js 18+.

1. Open <http://localhost:8791> in your browser.
2. Click ⚙ Settings, paste your TypeSafe JeV API key, and save — it takes effect immediately, no restart.
3. Edit the state text and questions, then click "Ask JeV".

Prefer a key file? The backend reads one at startup from the generic path `~/.nebflow/secrets/<name>` (default name `typesafe-api-key`); a key pasted in the settings panel is stored at that same path with 0600 owner-only permissions (in-place rewrite that preserves the inode). Responses and logs carry only ok / length / last-4 fingerprint — the key itself is never echoed.

Missing or empty key file? The server still starts and logs `API key: not configured — set it in the WebUI settings`; evaluate requests then answer `503` with a hint until you paste a key in the settings panel — no restart needed.

Optional environment overrides (see `server.mjs`): `PORT` (default 8791), `HOST`, `TYPESAFE_API_KEY_PATH`, `JEV_MAX_LIFETIME_MS`.

## Files

- `server.mjs` — zero-dependency backend: serves `public/` and forwards `POST /api/evaluate` to the JeV API (model `jev-latest`)
- `public/index.html` — the single-page WebUI (state input, question rows, confidence display, ⚙ settings panel)
- `lib/log.mjs` — JSONL metadata logger (time, endpoint, status, latency; auth redacted) → `logs/requests.log`
- `scripts/selfcheck.mjs` — headless end-to-end check: starts the server, makes one real JeV call, stops everything

## License

[MIT](LICENSE) © 2026 MashiroKai

## 中文说明（zh-CN）

**jev-test** 是一个极简的 JeV 测试工具：浏览器单页应用——输入一段状态文本（State）、添加若干条问题，即可看到 JeV 的回答与置信度。

[JeV](https://docs.typesafe.ai/introduction) 是 TypeSafe 的 JeV 模型：给它一段状态与若干条带类型的问题，它会以置信度形式回答。本工具是它的一层薄壳：浏览器页面负责收集 State 与任意多条问题行、逐条回显答案及置信度；零依赖的 Node.js 薄后端把请求转发到 JeV HTTP API（`https://api.typesafe.ai/v1/systemone`）。API key 绝不进入浏览器：它只存在于后端进程内，请求日志只记元数据，Authorization 头一律打码。

> 仅供测试用途，非生产工具。

### 功能一览

| 功能 | 说明 |
|---|---|
| State 输入 | 自由文本，即 JeV 要评估的内容 |
| 多问题行 | 每行三型可选：`noul`（是否）、`choice`（单选，2–255 项）、`score`（评分，2–10 个有序档位） |
| 置信度回显 | 每条答案都带回置信度；`choice`/`score` 另附各选项概率，`noul` 显示 P(yes) |
| 浏览器可配 API key | ⚙ 设置面板只写不回显——key 保存后不再显示、绝不回传；运行时热切换，无需重启 |
| 一条命令启动 | `node server.mjs` —— 零依赖，Node.js 18+ |

JeV 的 `criteria` 字段：`choice` 问题为对象映射（每个选项标签 → 描述或 `null`）；`score` 问题为有序的档位标签数组。

### 快速开始

```
node server.mjs
```

无需安装任何依赖；要求 Node.js 18+。

1. 浏览器打开 <http://localhost:8791>。
2. 点击 ⚙ 设置，粘贴 TypeSafe JeV 的 API key 并保存——立即生效，无需重启。
3. 编辑状态文本与问题，点击 "Ask JeV" 提问。

也可以用 key 文件：后端启动时从通用路径 `~/.nebflow/secrets/<name>`（默认名 `typesafe-api-key`）读取；在设置面板保存的 key 也会写在该路径，权限 0600 仅属主可读写（原地改写、保留 inode）。响应与日志只带 ok / 长度 / 末 4 位指纹——key 本身绝不回显。

缺少或为空的 key 文件不影响启动：服务照常启动并提示 `API key: not configured — set it in the WebUI settings`；此时提问会得到 `503` 与提示，直到在设置面板粘贴 key——无需重启。

可选环境变量覆盖（见 `server.mjs`）：`PORT`（默认 8791）、`HOST`、`TYPESAFE_API_KEY_PATH`、`JEV_MAX_LIFETIME_MS`。

### 文件

- `server.mjs` —— 零依赖后端：托管 `public/` 并把 `POST /api/evaluate` 转发给 JeV API（模型 `jev-latest`）
- `public/index.html` —— 单页 WebUI（State 输入、问题行、置信度展示、⚙ 设置面板）
- `lib/log.mjs` —— JSONL 元数据日志（时间、端点、状态、延迟；auth 打码）→ `logs/requests.log`
- `scripts/selfcheck.mjs` —— 无头端到端自检：起服务、发一次真实 JeV 调用、收尾退出

### 许可

[MIT](LICENSE)，版权所有 © 2026 MashiroKai
