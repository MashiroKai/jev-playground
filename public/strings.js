// JeV Playground UI string table — every user-visible chrome string lives here.
// Keys are identical in both packs (en / zh-CN); `t()` falls back to `en`, then
// echoes the key name so a missing key is loud instead of a silent empty string.

export const LANGS = ["en", "zh-CN"];
export const LANG_STORAGE_KEY = "jev.lang";

export const STRINGS = {
  en: {
    "title": "JeV Playground · JeV console",
    "hero.sub": "Type content, ask typed questions, see JeV's answers with confidence. The API key stays on the backend; the browser only talks to this local server.",
    "settings.open": "⚙ Settings",
    "settings.title": "Settings",
    "lang.toggle": "中文",
    "lang.toggle.title": "EN / 中文",
    "settings.apiKey": "API key",
    "key.status.checking": "Checking…",
    "key.status.configured": "Configured · click to replace",
    "key.status.missing": "Not configured",
    "key.hint.configured": "A key is stored on the backend (0600 owner-only, never displayed). Click above to paste a replacement — it takes effect immediately, no restart.",
    "key.hint.missing": "No key yet: create one in your TypeSafe JeV account, then paste it below. It is stored on this machine only and never shown again.",
    "key.input.placeholder": "Paste a new key here",
    "key.save": "Save",
    "key.save.note": "The key is sent once to the local backend and never shown again.",
    "state.label": "State",
    "state.hint": "(text JeV should evaluate)",
    "state.placeholder": "e.g. Help! My payouts have been failing for 3 days.",
    "questions.label": "Questions",
    "questions.add": "+ Add question",
    "ask.idle": "Ask JeV",
    "ask.busy": "Asking JeV…",
    "qtype.noul": "noul (yes/no)",
    "qtype.choice": "choice (pick one)",
    "qtype.score": "score (2-10 levels)",
    "q.instr.placeholder": "instructions, e.g. Does this convey urgency?",
    "q.crit.placeholder": "criteria (comma-separated labels)",
    "q.critdesc.placeholder": "criteria descriptions (comma-separated, optional)",
    "q.hint.choice": "Options (2-255, comma-separated) + optional per-option descriptions",
    "q.hint.score": "Levels from low to high (2-10, comma-separated; descriptions ignored)",
    "q.remove": "Remove",
    "err.criteria.required": "A {type} question needs criteria (comma-separated).",
    "err.choice.range": "choice needs between 2 and 255 options.",
    "err.score.range": "score needs between 2 and 10 levels.",
    "answer.noConfidence": "no confidence field (noul shows P(yes))",
    "answer.confidence": "confidence {conf}",
    "answer.yes": "yes",
    "answer.no": "no",
    "answer.pYes": "P(yes) = {p}",
    "err.stateEmpty": "State is empty.",
    "err.noQuestions": "Add at least one question with instructions.",
    "err.http": "HTTP {status}: {error}",
    "err.http.fallback": "request failed",
    "err.generic": "Error: {msg}",
    "key.err.empty": "Paste a key first.",
    "key.saving": "Saving…",
    "key.saved": "Saved (len {len}, {fp}).",
    "key.save.failed": "Save failed: {msg}",
    "resp.meta": "model {model} · usage in {in} / out {out} tokens · {ms} ms round-trip",
    "aria.newKey": "new API key",
    "aria.qtype": "question type",
    "aria.instr": "instructions",
    "aria.crit": "criteria",
    "aria.critdesc": "criteria descriptions",
  },

  "zh-CN": {
    "title": "JeV Playground · JeV 控制台",
    "hero.sub": "输入内容、提出带类型的问题，查看带置信度的 JeV 回答。API key 只留在后端，浏览器只与本机服务通信。",
    "settings.open": "⚙ 设置",
    "settings.title": "设置",
    "lang.toggle": "EN",
    "lang.toggle.title": "EN / 中文",
    "settings.apiKey": "API key",
    "key.status.checking": "检查中…",
    "key.status.configured": "已配置 · 点击可替换",
    "key.status.missing": "未配置",
    "key.hint.configured": "后端已存有一枚 key（0600 仅属主可读写，永不显示）。点击上方可粘贴替换——立即生效，无需重启。",
    "key.hint.missing": "还没有 key：请先在 TypeSafe JeV 账号中创建一枚，再粘贴到下方。它只保存在本机，之后不再显示。",
    "key.input.placeholder": "在此粘贴新的 key",
    "key.save": "保存",
    "key.save.note": "key 仅发送一次到本机后端，之后不再显示。",
    "state.label": "State",
    "state.hint": "（JeV 要评估的文本）",
    "state.placeholder": "例如：救命！我的提现已经连续 3 天失败了。",
    "questions.label": "问题",
    "questions.add": "+ 添加问题",
    "ask.idle": "问 JeV",
    "ask.busy": "正在问 JeV…",
    "qtype.noul": "noul（是/否）",
    "qtype.choice": "choice（单选）",
    "qtype.score": "score（2–10 档）",
    "q.instr.placeholder": "指令，例如：这段内容是否传达了紧迫感？",
    "q.crit.placeholder": "criteria（逗号分隔的标签）",
    "q.critdesc.placeholder": "criteria 描述（逗号分隔，可空）",
    "q.hint.choice": "选项（2–255 个，逗号分隔）+ 每项可选的描述",
    "q.hint.score": "档位从低到高（2–10 个，逗号分隔；描述忽略）",
    "q.remove": "移除",
    "err.criteria.required": "{type} 问题需要 criteria（逗号分隔）。",
    "err.choice.range": "choice 需要 2–255 个选项。",
    "err.score.range": "score 需要 2–10 个档位。",
    "answer.noConfidence": "无 confidence 字段（noul 显示 P(yes)）",
    "answer.confidence": "置信度 {conf}",
    "answer.yes": "是",
    "answer.no": "否",
    "answer.pYes": "P(是) = {p}",
    "err.stateEmpty": "State 为空。",
    "err.noQuestions": "至少添加一个带指令的问题。",
    "err.http": "HTTP {status}：{error}",
    "err.http.fallback": "请求失败",
    "err.generic": "错误：{msg}",
    "key.err.empty": "请先粘贴 key。",
    "key.saving": "保存中…",
    "key.saved": "已保存（长度 {len}，{fp}）。",
    "key.save.failed": "保存失败：{msg}",
    "resp.meta": "模型 {model} · 输入 {in} / 输出 {out} tokens · 往返 {ms} ms",
    "aria.newKey": "新的 API key",
    "aria.qtype": "问题类型",
    "aria.instr": "指令",
    "aria.crit": "criteria",
    "aria.critdesc": "criteria 描述",
  },
};

// t(lang, key, vars): look up `key`, falling back to `en` and then to the key
// name itself (fail-loud — a missing key must never render as an empty string).
// `vars` interpolates {name} placeholders; 0 and "" are substituted, not skipped.
export function t(lang, key, vars) {
  const pack = STRINGS[lang] || STRINGS.en;
  let s = pack[key];
  if (s === undefined) s = STRINGS.en[key];
  if (s === undefined) s = key;
  if (vars) {
    s = String(s).replace(/\{(\w+)\}/g, (m, name) =>
      vars[name] === undefined || vars[name] === null ? m : String(vars[name]));
  }
  return s;
}
