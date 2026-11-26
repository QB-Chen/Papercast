// 数字审计：旁白里出现的每个数字，必须能在本场景的"论文事实"里找到；找不到又没说"假设/举个例子"的，标出来给人看。
//   node scripts/audit-numbers.mjs <arXiv 编号>
// 读 projects/<id>/plan.json 和 projects/<id>/narration/<场景>.revised.json(或 .final.json)，输出 projects/<id>/audit-numbers.md
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { numbersIn } from "./storyboard-schema.mjs";

const id = process.argv[2];
if (!id) throw new Error("用法：node scripts/audit-numbers.mjs <arXiv 编号>");
const root = `projects/${id}`;
const plan = JSON.parse(readFileSync(`${root}/plan.json`, "utf8"));
const HEDGE = /假设|举个例子|比方|比如|假如|如果|打个比方|想象|就当|设想|例如/;

const UNIT = { 十: 10, 百: 100, 千: 1000 };
const DIG = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 中文整数（不含万/亿单位）→ 数字。认不出来返回 null */
function cnInt(t) {
  if (!t) return null;
  let total = 0;
  let cur = 0;
  let seen = false;
  for (const ch of t) {
    if (ch in DIG) {
      cur = DIG[ch];
      seen = true;
    } else if (ch in UNIT) {
      total += (cur || 1) * UNIT[ch];
      cur = 0;
      seen = true;
    } else return null;
  }
  return seen ? total + cur : null;
}
/** 取出旁白里的中文整数（"四十亿"→40，"三百五十亿"→350，"十五亿"→15；单个"一二三"不算） */
function intsIn(text) {
  const out = [];
  // 先去掉小数（"零点三六"）和"X分之Y"，它们由 numbersIn 负责，不能再被当成整数
  text = String(text).replace(/[零〇一二三四五六七八九十]*点[零〇一二三四五六七八九]+/g, "").replace(/[千百万]分之[零〇一二三四五六七八九十]+/g, "");
  for (const m of String(text).matchAll(/([零〇一二三四五六七八九十百千两]+)(亿|万)?/g)) {
    const tok = m[1];
    if (tok.length < 2 && !m[2]) continue; // 单个数字（"一个""两种"）不审
    const v = cnInt(tok);
    if (v != null) out.push(m[2] === "万" ? v * 1e4 : m[2] === "亿" ? v * 1e8 : v); // 一百万 = 1000000，不是 100
  }
  return out;
}
/** 事实文本里出现过的所有数字：阿拉伯数字（含小数、百分号）+ 中文数字 */
function factNumbers(text) {
  const set = new Set(numbersIn(text).map((v) => +v.toFixed(8)));
  for (const m of String(text).matchAll(/\d+(?:\.\d+)?/g)) set.add(+m[0]);
  for (const v of intsIn(text)) set.add(v);
  // 事实里的 1M / 4K / 45T / 16B / 1 million / 100万 这类写法，换算成数值再比
  const SC = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, 千: 1e3, 万: 1e4, 亿: 1e8 };
  for (const m of String(text).matchAll(/(\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion|[kKmMbBtT万亿千])(?![A-Za-z])/g)) set.add(+(parseFloat(m[1]) * SC[m[2].toLowerCase()]).toFixed(8));
  return set;
}
const close = (a, b) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 0.01);

// ---- 英文版：阿拉伯数字（含 1,000 / 3.5 / 16B / 45T / 50%）和英文数词（forty five、two hundred、one million）----
const EN = (plan.lang ?? process.env.VIDEO_LANG ?? "zh") === "en";
const EN_UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const EN_SCALE = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const SUF = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
function enNumsIn(text) {
  const out = [];
  const t = String(text ?? "").replace(/,(?=\d{3}\b)/g, "").toLowerCase();
  // 阿拉伯数字：不取紧贴字母的（FP4、CSA2、V4.1 这类名字里的数字），后面可以跟 k/m/b/t 或 thousand/million/billion/trillion/percent/%
  for (const m of t.matchAll(/(?<![a-z\-_.\d])(\d+(?:\.\d+)?)\s*(%|percent\b|thousand\b|million\b|billion\b|trillion\b|[kmbt]\b)?/g)) {
    let v = parseFloat(m[1]);
    const u = m[2];
    if (u && SUF[u]) v *= SUF[u];
    else if (u && EN_SCALE[u]) v *= EN_SCALE[u];
    out.push(v);
  }
  // 英文数词：连续的数词合成一个数；单独的 one~nine 太常见（"one idea"），不审
  const toks = t.match(/[a-z]+(?:-[a-z]+)?/g) ?? [];
  for (let i = 0; i < toks.length; ) {
    let j = i;
    let total = 0;
    let cur = 0;
    let seen = false;
    let strong = false;
    while (j < toks.length) {
      const w = toks[j].split("-");
      if (w.length === 2 && w[0] in EN_UNITS && w[1] in EN_UNITS) {
        cur += EN_UNITS[w[0]] + EN_UNITS[w[1]];
        seen = true;
        strong = true;
      } else if (toks[j] in EN_UNITS) {
        cur += EN_UNITS[toks[j]];
        seen = true;
        if (EN_UNITS[toks[j]] >= 10) strong = true;
      } else if (toks[j] in EN_SCALE) {
        if (!seen) break;
        if (toks[j] === "hundred") cur = (cur || 1) * 100;
        else {
          total += (cur || 1) * EN_SCALE[toks[j]];
          cur = 0;
        }
        strong = true;
      } else if (toks[j] === "and" && seen && j + 1 < toks.length && (toks[j + 1] in EN_UNITS)) {
        // "one hundred and five"
      } else break;
      j++;
    }
    if (seen && strong) out.push(total + cur);
    i = Math.max(j, i + 1);
  }
  return out;
}
const enFactNumbers = (text) => new Set(enNumsIn(text).map((v) => +v.toFixed(8)));
const numsOfSentence = (text) => (EN ? enNumsIn(text) : [...numbersIn(text), ...intsIn(text)]);
const factNumbersFor = (text) => (EN ? enFactNumbers(text) : factNumbers(text));
const HEDGE_EN = /\b(suppose|say|imagine|for example|for instance|let'?s say|picture|pretend|assume|assuming|if|what if|think of|like|such as|something like|roughly|about)\b/i;

let out = `# 数字审计\n\n规则：旁白里的数字必须能在本场景的「论文事实」或「举例」里找到；找不到、又没有说"假设/举个例子"的，列在下面请人工确认。\n\n`;
let flagged = 0;
let checked = 0;
for (const sc of plan.scenes) {
  const file = [`${root}/narration/${sc.id}.final.json`, `${root}/narration/${sc.id}.revised.json`].find(existsSync);
  if (!file) continue;
  const sents = JSON.parse(readFileSync(file, "utf8")).sentences;
  const known = factNumbersFor([...sc.facts.map((f) => f.zh), ...(sc.examples ?? [])].join("\n"));
  const all = factNumbersFor(plan.scenes.flatMap((s) => s.facts.map((f) => f.zh)).join("\n")); // 全片事实里出现过，但不是本场景的
  const rows = [];
  for (const s of sents) {
    const nums = numsOfSentence(s.text);
    if (!nums.length) continue;
    checked++;
    const unknown = nums.filter((n) => ![...known].some((k) => close(k, n)));
    if (!unknown.length || (EN ? HEDGE_EN : HEDGE).test(s.text)) continue;
    const elsewhere = unknown.every((n) => [...all].some((k) => close(k, n)));
    rows.push(`- **${s.id}**「${s.text}」 未在本场景事实里找到：${unknown.join("、")}${elsewhere ? "（别的场景的事实里有）" : "（全片事实里都没有）"}`);
  }
  flagged += rows.length;
  out += `## ${sc.id}：${sc.title}\n${rows.length ? rows.join("\n") : "没有发现问题。"}\n\n`;
}
out += `\n共检查 ${checked} 句含数字的旁白，需要人工确认 ${flagged} 句。\n`;
writeFileSync(`${root}/audit-numbers.md`, out);
console.log(`检查 ${checked} 句含数字的旁白，需要人工确认 ${flagged} 句 → ${root}/audit-numbers.md`);
