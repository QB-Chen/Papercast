// 文案风格的可量化指标：范例文案 vs 生成的旁白。
//   node scripts/style-metrics.mjs <旁白 json 或 txt> [更多文件…]
// 旁白 json 可以是 { sentences:[{text}] } 或 { scenes:[{sentences}] }；txt 按行当作句子段落。
import { readFileSync } from "node:fs";

export const CONNECTORS = ["那", "当然了", "不过", "所以说", "比如说", "就是", "而且", "但是", "虽然", "其实", "可以说", "换句话说", "也就是说", "像之前", "我觉得", "你想想看", "大家", "对吧", "然后", "因为", "如果", "好了", "回到", "别着急", "注意"];

/** 把一段文字切成"句"：按 。？！ 切，保留问号 */
export function splitSentences(text) {
  return (text.replace(/\s+/g, " ").match(/[^。？！?!]+[。？！?!]?/g) ?? []).map((s) => s.trim()).filter((s) => s.length > 1);
}

export function metricsOf(sentences) {
  const lens = sentences.map((s) => [...s.replace(/[，。？！；：、,.?!\s]/g, "")].length).sort((a, b) => a - b);
  const n = Math.max(sentences.length, 1);
  const q = (p) => lens[Math.min(lens.length - 1, Math.floor(lens.length * p))] ?? 0;
  const commas = sentences.reduce((a, s) => a + (s.match(/[，；：、]/g) ?? []).length, 0);
  const conn = {};
  for (const c of CONNECTORS) {
    const k = sentences.filter((s) => s.includes(c)).length;
    if (k) conn[c] = k;
  }
  const withConn = sentences.filter((s) => CONNECTORS.some((c) => s.startsWith(c) || s.includes("，" + c) || s.includes(c))).length;
  return {
    句数: sentences.length,
    平均字数: +(lens.reduce((a, b) => a + b, 0) / n).toFixed(1),
    中位字数: q(0.5),
    "90%分位字数": q(0.9),
    "超过25字的句子占比": +(lens.filter((x) => x > 25).length / n).toFixed(2),
    "少于10字的句子占比": +(lens.filter((x) => x < 10).length / n).toFixed(2),
    每句平均逗号数: +(commas / n).toFixed(2),
    问句占比: +(sentences.filter((s) => /[？?]$/.test(s)).length / n).toFixed(2),
    "含连接词/口语词的句子占比": +(withConn / n).toFixed(2),
    "以'那/不过/所以说/当然了/比如说'开头的占比": +(sentences.filter((s) => /^(那|不过|所以说|当然了|比如说|而且|但是|其实|就是)/.test(s)).length / n).toFixed(2),
  };
}

// ---- 英文版指标：按"词"算长度，口语特征换成英文的连接词、缩写、自问自答 ----
const EN_OPENERS = /^(so|now|but|and|well|okay|ok|right|think|imagine|here'?s|let'?s|let me|of course|honestly|actually|suppose|that'?s|first|then|notice|remember|look|picture|what|why|how|does|is|can|could|would|do|did|have|has)\b/i;
const EN_COLLOQ = /\b(so|well|okay|honestly|actually|basically|kind of|sort of|a bit|a little|just|really|pretty|you|we|let'?s|here'?s|that'?s|it'?s|don'?t|doesn'?t|can'?t|isn'?t|aren'?t|won'?t|you'?re|we'?re|they'?re|i think|of course|think about|imagine|suppose|say)\b/i;

export function splitSentencesEn(text) {
  return (text.replace(/\s+/g, " ").match(/[^.?!]+[.?!]+["')\]]*|[^.?!]+$/g) ?? []).map((s) => s.trim()).filter((s) => s.length > 1);
}
export const wordsOf = (s) => (s.match(/[A-Za-z0-9][A-Za-z0-9'’\-.%]*/g) ?? []).length;

export function metricsOfEn(sentences) {
  const lens = sentences.map(wordsOf).sort((a, b) => a - b);
  const n = Math.max(sentences.length, 1);
  const q = (p) => lens[Math.min(lens.length - 1, Math.floor(lens.length * p))] ?? 0;
  return {
    sentences: sentences.length,
    avgWords: +(lens.reduce((a, b) => a + b, 0) / n).toFixed(1),
    medianWords: q(0.5),
    p90Words: q(0.9),
    longShare: +(lens.filter((x) => x > 18).length / n).toFixed(2), // 超过 18 词的句子占比
    shortShare: +(lens.filter((x) => x < 6).length / n).toFixed(2),
    commasPerSentence: +(sentences.reduce((a, s) => a + (s.match(/,/g) ?? []).length, 0) / n).toFixed(2),
    questionShare: +(sentences.filter((s) => /\?["')\]]*$/.test(s)).length / n).toFixed(2),
    colloquialShare: +(sentences.filter((s) => EN_COLLOQ.test(s)).length / n).toFixed(2),
    openerShare: +(sentences.filter((s) => EN_OPENERS.test(s)).length / n).toFixed(2),
  };
}

/** 按语言取指标；zh 沿用原来的 */
export const metricsFor = (lang, sentences) => (lang === "en" ? metricsOfEn(sentences) : metricsOf(sentences));

export function loadSentences(file) {
  const raw = readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    const j = JSON.parse(raw);
    const list = j.sentences ?? j.scenes?.flatMap((s) => s.sentences) ?? [];
    return list.map((s) => s.text);
  }
  return splitSentences(raw.replace(/^---$/gm, ""));
}

if (process.argv[1]?.endsWith("style-metrics.mjs")) {
  const files = process.argv.slice(2);
  const rows = files.map((f) => ({ f, m: metricsOf(loadSentences(f)) }));
  const keys = Object.keys(rows[0].m);
  for (const k of keys) console.log(k.padEnd(34, "　") + rows.map((r) => String(r.m[k]).padStart(9)).join(""));
  console.log("\n" + rows.map((r, i) => `[${i + 1}] ${r.f}`).join("\n"));
}
