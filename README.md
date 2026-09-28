# JeV Playground

JeV Playground — a minimal JeV tester: type a state, add typed questions, and read the answers with confidence.

[JeV](https://docs.typesafe.ai/introduction) is TypeSafe's JeV model: you hand it a state plus typed questions, and it answers with calibrated confidence. This tool is a thin harness around it: the browser page collects a State and any number of question rows, shows each answer with its confidence, and switches the whole interface between English and 中文; a zero-dependency Node.js backend forwards requests to the provider you select in ⚙ Settings (Official JeV by default). The API key never touches the browser: it lives only in the backend process, and request logs carry metadata only, with the Authorization header redacted.

> Evaluation tool, not for production use.

## Providers

Pick a Provider in ⚙ Settings. The choice, its Model and its Base URL are stored in this project's `config.json`.

| Provider | Endpoint | Model | API key | Verification status |
|---|---|---|---|---|
| Official JeV (default) | `POST https://api.typesafe.ai/v1/systemone` | `jev-1.13.0` by default — editable in ⚙ Settings | required | checked end-to-end against the real hosted endpoint |
| LAYA (local decision model) | `POST <Base URL>/predict` | default `laya` — editable in ⚙ Settings | not required | adapter implemented and self-checked against a mock endpoint; not validated against a real LAYA instance |
| Custom / OpenAI-compatible | `POST <Base URL>/chat/completions` | required — there is no default and nothing is guessed in its place | not required | adapter implemented and self-checked against a mock endpoint; not validated against a real instance |

Verification status: Official JeV is checked end-to-end against the real hosted endpoint, whereas the LAYA (local decision model) adapter is implemented to the documented interface shape and self-checked against a mock endpoint — it is not validated against a real LAYA instance. The Custom / OpenAI-compatible adapter has the same status: mock endpoint only, never validated against a real server.

Confidence is read differently per provider: the hosted JeV endpoint and the local decision model report it in their own response, while a Custom / OpenAI-compatible endpoint usually does not — there the backend derives it from the model's own reply (a parsed value first, then per-token probabilities from logprobs) and labels the answer confidence (derived) when nothing can be read.

## Features

| Feature | What it does |
|---|---|
| State input | free-form text that JeV should evaluate |
| Multiple question rows | three types per row: `noul` (yes/no), `choice` (pick one, 2–255 options), `score` (2–10 ordered levels) |
| Confidence echo | every answer comes back with its confidence; `choice`/`score` also show per-option probabilities, `noul` shows P(yes) |
| Language switch | the "EN / 中文" button in the header switches every label in the page; the choice is remembered in this browser |
| Selectable provider | Official JeV (default), a local decision model, or any Custom / OpenAI-compatible endpoint — set in ⚙ Settings, with a Model per provider |
| Browser-configurable API key | ⚙ settings panel is write-only — the key is never displayed again, never echoed; it hot-switches at runtime, no restart |
| One-command start | `node server.mjs` — zero dependencies, Node.js 18+ |

JeV takes `criteria` for `choice` questions as an object mapping each option label to a description (or `null`), and for `score` questions as an ordered array of level labels.

## Quickstart

```
node server.mjs
```

No dependencies to install; requires Node.js 18+.

1. Open <http://localhost:8791> in your browser.
2. Click ⚙ Settings and pick a Provider; paste an API key if the one you picked needs it. Saving takes effect immediately, no restart. (Official JeV needs a key; the other two presets are usually keyless.)
3. Edit the state text and questions, then click "Ask JeV".
4. Click the "EN / 中文" button in the header to switch the interface language — the choice is remembered in this browser.

### API key

The key is resolved once at startup, in this order:

1. the `JEV_API_KEY` environment variable, when it is set;
2. otherwise the key stored in `config.json` in this project directory — the settings panel creates that file on first save; it is written 0600 owner-only (an in-place rewrite that preserves the inode) and is git-ignored;
3. when neither is present the server still starts and logs `API key: not configured — set it in the WebUI settings`; `GET /api/config` answers 200 with `configured: false`, saving a key in ⚙ Settings takes effect without a restart, and evaluate requests answer `503` with a hint until a key is saved.

An explicit key *file* is available as an override, never as a default: point `JEV_API_KEY_PATH` at a file whose whole content is the key (the legacy alias `TYPESAFE_API_KEY_PATH` is still accepted). Responses and logs carry only ok / length / last-4 fingerprint — the key itself is never echoed.

Optional environment overrides (see `server.mjs`): `PORT` (default 8791), `HOST` (default 127.0.0.1), `JEV_API_KEY` (key value), `JEV_API_KEY_PATH` (explicit key-file override, not a default; the legacy alias `TYPESAFE_API_KEY_PATH` still works), `JEV_MAX_LIFETIME_MS` (hard self-exit deadline, ms).

## Files

- `server.mjs` — zero-dependency backend: serves `public/`, forwards `POST /api/evaluate` to the selected provider, and keeps the settings in `config.json` (the Model comes from there, never hardcoded)
- `lib/provider.mjs` — the provider dispatch layer: three presets with their own defaults and wire protocols, plus confidence derivation for OpenAI-compatible endpoints
- `public/index.html` — the single-page WebUI (state input, question rows, confidence display, language switch, ⚙ settings panel)
- `public/strings.js` — the UI string table: every user-visible label in both languages, one identical key set per language
- `lib/log.mjs` — JSONL metadata logger (time, endpoint, status, latency; auth redacted) → `logs/requests.log`
- `scripts/selfcheck.mjs` — headless end-to-end check: starts the server, makes one real JeV call, stops everything

## License

[MIT](LICENSE) © 2026 MashiroKai

## 中文说明（zh-CN）

**JeV Playground** 是一个极简的 JeV 试用工具：浏览器单页应用——输入一段状态文本（State）、添加若干条问题，即可看到 JeV 的回答与置信度。

[JeV](https://docs.typesafe.ai/introduction) 是 TypeSafe 的 JeV 模型：给它一段状态与若干条带类型的问题，它会以置信度形式回答。本工具是它的一层薄壳：浏览器页面负责收集 State 与任意多条问题行、逐条回显答案及置信度，并可整页切换中英文；零依赖的 Node.js 薄后端把请求转发到你在 ⚙ 设置里选定的 Provider（默认官方 JeV）。API key 绝不进入浏览器：它只存在于后端进程内，请求日志只记元数据，Authorization 头一律打码。

> 仅供测试用途，非生产工具。

### Provider

在 ⚙ 设置里选择 Provider；所选项及其模型与 Base URL 保存在本项目的 `config.json` 中。

| Provider | 端点 | 模型 | API key | 验证状态 |
|---|---|---|---|---|
| 官方 JeV（默认） | `POST https://api.typesafe.ai/v1/systemone` | 默认 `jev-1.13.0`，可在 ⚙ 设置中修改 | 必需 | 已对真实托管端点做过端到端自检 |
| LAYA（本地决策模型） | `POST <Base URL>/predict` | 默认 `laya`，可在 ⚙ 设置中修改 | 不需要 | 适配层已按接口形状实现并经 mock 端点自验；尚未在真实 LAYA 实例上验证 |
| 自定义 / OpenAI 兼容 | `POST <Base URL>/chat/completions` | 必填——没有默认值，也不会猜一个兜底 | 不需要 | 适配层已按接口形状实现并经 mock 端点自验；尚未在真实服务上验证 |

验证状态说明：官方 JeV 有真实托管端点的端到端自检；而 LAYA（本地决策模型）的适配层是按接口形状实现、经 mock 端点自验的——尚未在真实 LAYA 实例上验证。自定义 / OpenAI 兼容的适配层同理：仅经 mock 端点自验，从未在真实服务上验证。

置信度的读法因 Provider 而异：托管 JeV 端点与本地决策模型在自身响应里直接给出，而自定义 / OpenAI 兼容端点通常不给——此时后端从模型自己的回复中派生（先取解析到的值，再取 logprobs 的逐 token 概率），实在读不到就把该答案标注为置信度（派生）。

### 功能一览

| 功能 | 说明 |
|---|---|
| State 输入 | 自由文本，即 JeV 要评估的内容 |
| 多问题行 | 每行三型可选：`noul`（是否）、`choice`（单选，2–255 项）、`score`（评分，2–10 个有序档位） |
| 置信度回显 | 每条答案都带回置信度；`choice`/`score` 另附各选项概率，`noul` 显示 P(yes) |
| 语言切换 | 页头的「EN / 中文」按钮切换整页文案；所选语言记在本浏览器中 |
| 可选 Provider | 官方 JeV（默认）、本地决策模型、自定义 / OpenAI 兼容——在 ⚙ 设置中选择，模型按 Provider 分别设置 |
| 浏览器可配 API key | ⚙ 设置面板只写不回显——key 保存后不再显示、绝不回传；运行时热切换，无需重启 |
| 一条命令启动 | `node server.mjs` —— 零依赖，Node.js 18+ |

JeV 的 `criteria` 字段：`choice` 问题为对象映射（每个选项标签 → 描述或 `null`）；`score` 问题为有序的档位标签数组。

### 快速开始

```
node server.mjs
```

无需安装任何依赖；要求 Node.js 18+。

1. 浏览器打开 <http://localhost:8791>。
2. 点击 ⚙ 设置并选择 Provider；若所选 Provider 需要 key，就粘贴一枚 API key。保存立即生效、无需重启。（官方 JeV 需要 key；另外两种预置通常无需。）
3. 编辑状态文本与问题，点击 "Ask JeV" 提问。
4. 点击页头的「EN / 中文」按钮切换界面语言——所选语言记在本浏览器中。

### API key

key 在启动时解析一次，顺序如下：

1. 环境变量 `JEV_API_KEY`（若已设置）；
2. 否则用本项目目录下 `config.json` 里保存的 key——设置面板首次保存时创建该文件；权限 0600 仅属主可读写（原地改写、保留 inode），且已被 git 忽略；
3. 两者皆无时服务照常启动，并提示 `API key: not configured — set it in the WebUI settings`；`GET /api/config` 返回 200 与 `configured: false`，在 ⚙ 设置中保存 key 立即生效、无需重启，此前提问会得到 `503` 与提示。

显式 key **文件**只作覆盖用途、绝非默认位置：把 `JEV_API_KEY_PATH` 指向一个「整个文件内容就是 key」的文件即可（旧名 `TYPESAFE_API_KEY_PATH` 仍可用）。响应与日志只带 ok / 长度 / 末 4 位指纹——key 本身绝不回显。

可选环境变量覆盖（见 `server.mjs`）：`PORT`（默认 8791）、`HOST`（默认 127.0.0.1）、`JEV_API_KEY`（key 值）、`JEV_API_KEY_PATH`（显式 key 文件覆盖，非默认位置；旧名 `TYPESAFE_API_KEY_PATH` 仍可用）、`JEV_MAX_LIFETIME_MS`（硬性自退时限，毫秒）。

### 文件

- `server.mjs` —— 零依赖后端：托管 `public/`、把 `POST /api/evaluate` 转发给所选 Provider，并把设置存放在 `config.json`（模型来自该文件，不再写死）
- `lib/provider.mjs` —— Provider 分发层：三种预置各自的默认值与线上协议，以及 OpenAI 兼容端点的置信度派生
- `public/index.html` —— 单页 WebUI（State 输入、问题行、置信度展示、语言切换、⚙ 设置面板）
- `public/strings.js` —— UI 字符串表：两种语言的每一处可见文案，每种语言一套完全相同的键
- `lib/log.mjs` —— JSONL 元数据日志（时间、端点、状态、延迟；auth 打码）→ `logs/requests.log`
- `scripts/selfcheck.mjs` —— 无头端到端自检：起服务、发一次真实 JeV 调用、收尾退出

### 许可

[MIT](LICENSE)，版权所有 © 2026 MashiroKai
