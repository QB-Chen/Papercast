// 自由动画（canvas 的 form:"free"）的校验器。模型自己搭动画，这里负责把关：
// 字段、取值范围、时间锚点、符号来源（必须出自论文公式）、函数表达式、按时间采样查重叠和停住。
// 返回一串中文错误，原样反馈给模型重写。
import { readFileSync } from "node:fs";
const PROP_IDS = new Set(JSON.parse(readFileSync("src/story/props.json", "utf8")).map((p) => p.id));
import { parseExpr, exprVars } from "../src/story/expr.ts";
import { estimateSec } from "./canvas-compile.mjs";

const TYPES = ["shape", "text", "line", "bars", "curve", "ring", "brace", "char", "icon"];
const CHAR_IDS = new Set(JSON.parse(readFileSync("src/story/chars.json", "utf8")).map((c) => c.id));
const ACTS = ["bounce", "shake", "nod", "wiggle", "jump"];
const TONES = ["teal", "orange", "pink", "navy", "gray", "green"];
const SIZE = { s: 30, m: 40, l: 52, xl: 68 };
const PX = 16;
let PY = 5.2; // 百分比 → 逻辑像素（整块画布 1600×520；eqx 的插入演示区是 1600×300，validateFree 开头按 ctx.inset 设置）
let LOGIC_H = 520;
let LANG = "zh"; // validateFree 开头按 ctx.lang 设置：英文版画面文字用英文，字数上限按字符数放宽，英文字母不再限制只能来自公式
const KX = () => (LANG === "en" ? 2.4 : 1);
const len = (s) => [...(s ?? "")].length;
const hasCJK = (s) => /[\u3400-\u9fff]/.test(s);

// LaTeX 希腊字母命令 → 字符，用来从论文公式里收集"出现过的符号"
const GREEK = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Delta: "Δ", Gamma: "Γ", Theta: "Θ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω" };
const OPS = { sum: "∑", prod: "∏", sim: "~", mathbb: "", log: "log", exp: "exp", min: "min", max: "max", sigma: "σ" };

/** 从论文公式（LaTeX）里收集允许出现在画面上的拉丁/希腊符号和函数名 */
export function paperSymbols(paper, formulas = []) {
  const texs = [...(paper?.equations ?? []).map((e) => e.tex ?? ""), ...formulas.flatMap((f) => (f.parts ?? []).map((p) => p.tex ?? ""))];
  const chars = new Set();
  const words = new Set();
  for (const tex of texs) {
    for (const m of tex.matchAll(/\\([A-Za-z]+)/g)) {
      if (GREEK[m[1]]) chars.add(GREEK[m[1]]);
      if (m[1] === "sum") chars.add("∑");
      if (["log", "exp", "min", "max", "softmax", "sigma"].includes(m[1])) words.add(m[1]);
    }
    const stripped = tex.replace(/\\[A-Za-z]+/g, " ").replace(/[{}_^]/g, " ");
    for (const c of stripped) if (/[A-Za-z]/.test(c)) chars.add(c);
  }
  // 字符串里的常见数学写法
  if ((paper?.text ?? "").includes("softmax")) words.add("softmax");
  return { chars, words, any: texs.length > 0 };
}

const normText = (s) => s ?? "";

/** 检查一段上屏文字：长度、数字、英文、符号来源 */
function checkText(txt, where, maxLen, sym, errs) {
  if (!txt) return;
  maxLen = Math.round(maxLen * KX());
  if (len(txt) > maxLen) errs.push(`${where} 太长（${len(txt)} 字，上限 ${maxLen}）：「${txt}」`);
  if (/[0-9０-９]/.test(txt)) { errs.push(`${where} 里出现了数字：「${txt}」。画面是示意图，不写数字，数字只由旁白讲`); return; }
  if (LANG === "en") {
    // 英文版：画面上的词就是英文，不再要求来自公式；只检查希腊字母（口语化英文里不该出现）
    if (/[α-ωΑ-Ω]/.test(txt)) errs.push(`${where} 里不要出现希腊字母，用英文单词：「${txt}」`);
    return;
  }
  // 拉丁字母：连续的字母串必须是论文公式里的函数名，单个字母必须出现在论文公式里
  for (const m of txt.matchAll(/[A-Za-z]+/g)) {
    const w = m[0];
    if (!sym.any) continue;
    if (w.length >= 2) { if (!sym.words.has(w) && ![...w].every((c) => sym.chars.has(c))) errs.push(`${where} 里的「${w}」不是论文公式里的符号或函数名，不能自己造英文：「${txt}」`); }
    else if (!sym.chars.has(w)) errs.push(`${where} 里的符号「${w}」没有在论文公式里出现过：「${txt}」`);
  }
  for (const c of txt) if (/[α-ωΑ-Ω]/.test(c) && sym.any && !sym.chars.has(c)) errs.push(`${where} 里的符号「${c}」没有在论文公式里出现过：「${txt}」`);
}

/** 角色台词：不超过 14 字，不含数字、英文、符号（台词是演出来的，不承载论文里的事实） */
function checkSay(txt, where, errs) {
  if (!txt) return;
  if (LANG === "en") {
    if (len(txt) > 34) errs.push(`${where} 太长（${len(txt)} 个字符，上限 34）：「${txt}」`);
    if (/[0-9０-９]/.test(txt)) errs.push(`${where}「${txt}」不能含数字，请用口语英文（台词不承载论文里的数字）`);
    if (/[\u4e00-\u9fff]/.test(txt)) errs.push(`${where}「${txt}」含中文，请用英文`);
    return;
  }
  if (len(txt) > 14) errs.push(`${where} 太长（${len(txt)} 字，上限 14）：「${txt}」`);
  if (/[0-9０-９A-Za-z]/.test(txt)) errs.push(`${where}「${txt}」不能含数字和英文，请用中文口语`);
}

/** 对象在 t 秒（估算）时的几何状态。缓动用平滑曲线近似 */
function stateAt(o, t, ctx) {
  const st = { x: o.x ?? 50, y: o.y ?? 50, w: o.w ?? 0, h: o.h ?? 0, r: o.r ?? 0, s: o.s ?? 1 };
  const keys = (o.keys ?? []).map((k) => ({ k, t0: ctx.sec(k.at) })).filter((x) => x.t0 !== null).sort((a, b) => a.t0 - b.t0);
  for (const { k, t0 } of keys) {
    const q = Math.min(1, Math.max(0, (t - t0) / ((k.dur ?? 24) / 30)));
    const p = q * q * (3 - 2 * q);
    for (const n of ["x", "y", "w", "h", "r", "s"]) if (k[n] !== undefined) st[n] += (k[n] - st[n]) * p;
  }
  return st;
}

function boxOf(o, st) {
  const cx = st.x * PX, cy = st.y * PY;
  if (o.type === "text") {
    const fs = SIZE[o.size ?? "m"], w = len(o.text ?? "") * fs * (hasCJK(o.text ?? "") ? 1 : 0.62);
    return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - fs * 0.65, y1: cy + fs * 0.65 };
  }
  if (o.type === "char" || o.type === "icon") { const sz = (st.w || (o.type === "char" ? 150 : 90)) * st.s; return { x0: cx - sz / 2, x1: cx + sz / 2, y0: cy - sz / 2, y1: cy + sz / 2 }; }
  if (o.type === "shape" && o.shape === "circle") { const r = st.r * st.s; return { x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r }; }
  if (o.type === "shape") { const w = st.w * st.s, h = st.h * st.s; return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 }; }
  if (o.type === "bars") return { x0: cx - st.w / 2, x1: cx + st.w / 2, y0: cy - st.h / 2, y1: cy + st.h / 2 + 60 };
  if (o.type === "curve") return { x0: cx - st.w / 2 - 6, x1: cx + st.w / 2, y0: cy - st.h / 2 - (o.text ? 50 : 6), y1: cy + st.h / 2 + 6 };
  return null;
}

const inter = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 6 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 6;
const inside = (a, b) => a.x0 >= b.x0 - 4 && a.x1 <= b.x1 + 4 && a.y0 >= b.y0 - 4 && a.y1 <= b.y1 + 4;

export function validateFree(b, sentenceIds, texts, ctx = {}) {
  LOGIC_H = ctx.inset ? 300 : 520;
  PY = LOGIC_H / 100;
  LANG = ctx.lang === "en" ? "en" : "zh";
  const errs = [];
  const objs = b.objs ?? [];
  if (objs.length < 3 || objs.length > 24) return [`objs 需要 3 到 24 个对象（现在 ${objs.length}）`];
  const sym = paperSymbols(ctx.paper, ctx.formulas);
  const ids = new Set(sentenceIds);
  const startI = sentenceIds.indexOf(b.at);
  const sec = (ref) => estimateSec(ref, sentenceIds, texts);
  const anchor = (ref, where) => {
    const m = typeof ref === "string" ? ref.match(/^([^+#@]+)(?:([+#@])(.*))?$/) : null;
    if (!m || !ids.has(m[1])) { errs.push(`${where} 的时间锚点「${ref}」不对：要写成 句子id、id+帧数、id#段号 或 id@句中短语`); return null; }
    if (m[2] === "@") {
      const ph = m[3].replace(/\+\d+$/, "");
      if (/[，。？！、：；,.?!;:"“”‘’（）()「」『』]/.test(ph)) { errs.push(`${where} 的锚点短语「${ph}」含标点。短语只能是句子里连续的几个字，不能跨逗号、句号，请改成逗号之间的一小段（比如只取逗号前或后的几个字）`); return null; }
      if (texts[m[1]] && !texts[m[1]].includes(ph)) { errs.push(`${where} 的锚点短语「${ph}」不在句子 ${m[1]} 的原文里（必须是原文里的连续字）`); return null; }
    }
    return sentenceIds.indexOf(m[1]);
  };
  const byId = new Map();
  const range = (v, lo, hi, where, name) => { if (v !== undefined && !(typeof v === "number" && v >= lo && v <= hi)) errs.push(`${where}.${name} 必须是 ${lo} 到 ${hi} 之间的数（现在 ${JSON.stringify(v)}）`); };

  for (const [i, o] of objs.entries()) {
    const w = `objs[${i}]（${o.id}）`;
    if (!o.id || byId.has(o.id)) errs.push(`${w} 的 id 缺失或重复`);
    byId.set(o.id, o);
    if (!TYPES.includes(o.type)) { errs.push(`${w}.type 必须是 ${TYPES.join("/")}`); continue; }
    const a = anchor(o.at, `${w}.at`);
    if (a !== null && startI >= 0 && a < startI) errs.push(`${w}.at 早于画布开始的句子 ${b.at}`);
    if (o.until) { const u = anchor(o.until, `${w}.until`); if (u !== null && a !== null && u < a) errs.push(`${w}.until 早于 at`); }
    if (o.tone && !TONES.includes(o.tone)) errs.push(`${w}.tone 不合法：${o.tone}`);
    range(o.x, 0, 100, w, "x"); range(o.y, 0, 100, w, "y");
    range(o.w, 0, 1600, w, "w"); range(o.h, 0, LOGIC_H, w, "h"); range(o.r, 0, 260, w, "r");
    range(o.o, 0, 1, w, "o"); range(o.s, 0.2, 3, w, "s"); range(o.rot, -360, 360, w, "rot");
    for (const [j, p] of (o.pulse ?? []).entries()) anchor(p, `${w}.pulse[${j}]`);
    for (const [j, k] of (o.keys ?? []).entries()) {
      const kw = `${w}.keys[${j}]`;
      const ki = anchor(k.at, `${kw}.at`);
      if (ki !== null && a !== null && ki < a) errs.push(`${kw}.at 早于对象出现的时间`);
      range(k.x, 0, 100, kw, "x"); range(k.y, 0, 100, kw, "y"); range(k.w, 0, 1600, kw, "w"); range(k.h, 0, 520, kw, "h"); range(k.r, 0, 260, kw, "r");
      range(k.o, 0, 1, kw, "o"); range(k.s, 0.2, 3, kw, "s"); range(k.rot, -360, 360, kw, "rot"); range(k.mark, 0, 1, kw, "mark");
      if (typeof k.rot === "number" && Math.abs(k.rot) > 45 && (o.text || k.text !== undefined || o.type === "text")) errs.push(`${kw}.rot=${k.rot} 会把带文字的元素转歪甚至倒过来（最后停在倒着的状态，观众读不了）。带字的元素最多转 45°；想表现"翻转/变成相反"，请让旧标签退场（until），再在同一位置放一个新标签`);
      if (k.dur !== undefined) range(k.dur, 4, 120, kw, "dur");
      if (k.tone && !TONES.includes(k.tone)) errs.push(`${kw}.tone 不合法：${k.tone}`);
      if (k.text !== undefined) checkText(k.text, `${kw}.text`, 10, sym, errs);
      if (k.look !== undefined && !CHAR_IDS.has(k.look)) errs.push(`${kw}.look「${k.look}」不是可用的角色。可用：${[...CHAR_IDS].join("、")}`);
      if (k.say !== undefined) checkSay(k.say, `${kw}.say`, errs);
      if (k.mood !== undefined && !PROP_IDS.has(k.mood) && !(ctx.stickers ?? []).includes(k.mood)) errs.push(`${kw}.mood「${k.mood}」不是可用的表情（用道具清单里的表情，如 face-savoring-food、thinking-face）`);
      if (k.act !== undefined && !ACTS.includes(k.act)) errs.push(`${kw}.act 必须是 ${ACTS.join("/")}`);
      if (k.vals && (!Array.isArray(k.vals) || k.vals.some((v) => typeof v !== "number" || v < 0 || v > 100))) errs.push(`${kw}.vals 必须是 0 到 100 的数组`);
    }
    // 各类型必填项
    if (o.type === "shape") {
      if (!["circle", "rect", "pill"].includes(o.shape)) errs.push(`${w}.shape 必须是 circle/rect/pill`);
      else if (o.shape === "circle" ? !(o.r > 0) : !(o.w > 0 && o.h > 0)) errs.push(`${w}：${o.shape === "circle" ? "circle 需要 r" : "rect/pill 需要 w 和 h"}`);
      checkText(o.text, `${w}.text`, 10, sym, errs);
    }
    if (o.type === "text") { if (!o.text) errs.push(`${w}：text 需要 text`); checkText(o.text, `${w}.text`, 12, sym, errs); }
    if (o.type === "line") {
      for (const side of ["from", "to"]) {
        const r = o[side];
        if (r === undefined) errs.push(`${w}：line 需要 ${side}`);
        else if (typeof r === "string") { if (!objs.some((x) => x.id === r)) errs.push(`${w}.${side} 引用了不存在的对象「${r}」`); }
        else if (!(typeof r.x === "number" && typeof r.y === "number")) errs.push(`${w}.${side} 要么是对象 id，要么是 {x,y} 百分比坐标`);
      }
      checkText(o.text, `${w}.text`, 6, sym, errs);
    }
    if (o.type === "bars" && (o.w < 480 || o.h < (ctx.inset ? 110 : 170))) errs.push(`${w}：柱子画得太小（w=${o.w}，h=${o.h}），观众看不清。w 至少 480，h 至少 ${ctx.inset ? 110 : 170}（整组柱子占的区域，像素）`);
    if (o.type === "curve" && (o.w < 480 || o.h < (ctx.inset ? 110 : 170))) errs.push(`${w}：曲线图画得太小（w=${o.w}，h=${o.h}），观众看不清。w 至少 480，h 至少 ${ctx.inset ? 110 : 170}`);
    if (o.type === "bars") {
      if (!Array.isArray(o.vals) || o.vals.length < 2 || o.vals.length > 8 || o.vals.some((v) => typeof v !== "number" || v < 0 || v > 100)) errs.push(`${w}.vals 需要 2 到 8 个 0~100 的数`);
      if (!(o.w > 0 && o.h > 0)) errs.push(`${w}：bars 需要 w 和 h（整组柱子占的区域）`);
      for (const [j, l] of (o.labels ?? []).entries()) checkText(l, `${w}.labels[${j}]`, 6, sym, errs);
      for (const [j, k] of (o.keys ?? []).entries()) if (k.vals && Array.isArray(o.vals) && k.vals.length !== o.vals.length) errs.push(`${w}.keys[${j}].vals 个数（${k.vals.length}）必须和 vals（${o.vals.length}）一致`);
    }
    if (o.type === "curve") {
      if (!(o.w > 0 && o.h > 0)) errs.push(`${w}：curve 需要 w 和 h（绘图区大小）`);
      for (const [nm, hi] of [["xmin", "xmax"], ["ymin", "ymax"]]) if (!(typeof o[nm] === "number" && typeof o[hi] === "number" && o[nm] < o[hi])) errs.push(`${w}：需要 ${nm} < ${hi}（数）`);
      const params = o.params ?? {};
      for (const [nm, src] of [["fn", o.fn], ["fn2", o.fn2]]) {
        if (!src) { if (nm === "fn") errs.push(`${w}：curve 需要 fn（x 的表达式）`); continue; }
        try {
          const vars = exprVars(parseExpr(src));
          for (const v of vars) if (v !== "x" && !(v in params)) errs.push(`${w}.${nm}「${src}」里的变量「${v}」没有在 params 里给初值`);
        } catch (e) { errs.push(`${w}.${nm}：${e.message}`); }
      }
      for (const [j, k] of (o.keys ?? []).entries()) for (const nm of Object.keys(k.params ?? {})) if (!(nm in params)) errs.push(`${w}.keys[${j}].params 里的「${nm}」不在 params 里`);
      if (o.markOn && typeof o.mark !== "number" && !(o.keys ?? []).some((k) => k.mark !== undefined)) errs.push(`${w}：markOn 需要给 mark（0~1，横轴位置）`);
      checkText(o.text, `${w}.text`, 10, sym, errs);
    }
    if (o.type === "char") {
      if (!CHAR_IDS.has(o.look)) errs.push(`${w}.look「${o.look}」不是可用的角色。可用：${[...CHAR_IDS].join("、")}`);
      if (typeof o.x !== "number" || typeof o.y !== "number") errs.push(`${w}：char 需要 x 和 y`);
      if (o.w !== undefined && !(o.w >= 90 && o.w <= 320)) errs.push(`${w}.w 角色大小必须在 90 到 320 像素之间`);
      if (o.tag) { if (len(o.tag) > Math.round(5 * KX())) errs.push(`${w}.tag 不超过 ${Math.round(5 * KX())} 个字符`); if (LANG === "en" ? /[0-9\u4e00-\u9fff]/.test(o.tag) : /[0-9A-Za-z]/.test(o.tag)) errs.push(`${w}.tag「${o.tag}」${LANG === "en" ? "不能含数字和中文，请用英文" : "不能含数字和英文"}`); }
      if (typeof o.y === "number" && o.w !== undefined) { const sz = o.w, H0 = ctx.inset ? 300 : 520, cy0 = (o.y / 100) * H0, hasSay = !!o.say || (o.keys ?? []).some((k) => k.say), hasMood = !!o.mood || (o.keys ?? []).some((k) => k.mood); const top0 = cy0 - sz / 2 - (hasSay ? 98 : hasMood ? 38 : 0), bot0 = cy0 + sz / 2 + (o.tag ? 34 : 0); if (ctx.strictLayout && (top0 < -6 || bot0 > H0 + 6)) errs.push(`${w}：角色（含头顶气泡/表情、脚下标签）要整个留在舞台里，现在上沿 ${Math.round(top0)}、下沿 ${Math.round(bot0)}，舞台高度 ${H0}。请把 y 往${bot0 > H0 + 6 ? "上" : "下"}挪，或把 w 调小（插入演示的舞台只有 ${ctx.inset ? 300 : 520} 高，角色宽 ${ctx.inset ? "110 到 140" : "150 到 220"} 比较合适）`); }
      if (o.say) checkSay(o.say, `${w}.say`, errs);
      if (o.mood && !PROP_IDS.has(o.mood) && !(ctx.stickers ?? []).includes(o.mood)) errs.push(`${w}.mood「${o.mood}」不是可用的表情`);
    }
    if (o.type === "icon") {
      if (!(o.prop && PROP_IDS.has(o.prop)) && !(o.sticker && ctx.stickers?.includes(o.sticker))) errs.push(`${w}：icon 需要 prop（道具/表情的 id，见清单，用来表示菜、钱、文件、车等东西），现在 prop=「${o.prop ?? ""}」 sticker=「${o.sticker ?? ""}」不可用`);
      if (typeof o.x !== "number" || typeof o.y !== "number") errs.push(`${w}：icon 需要 x 和 y`);
      if (o.w !== undefined && !(o.w >= 40 && o.w <= 240)) errs.push(`${w}.w 道具大小必须在 40 到 240 像素之间`);
    }
    if (o.type === "ring" && (!o.of || !objs.some((x) => x.id === o.of))) errs.push(`${w}：ring 需要 of（要圈的对象 id，必须存在）`);
    if (o.type === "brace") {
      for (const side of ["from", "to"]) if (typeof o[side] !== "string" || !objs.some((x) => x.id === o[side])) errs.push(`${w}.${side} 必须是存在的对象 id`);
      checkText(o.text, `${w}.text`, 8, sym, errs);
    }
  }
  if (errs.length) return errs;

  // 引用的对象在引用那一刻必须已经在场
  for (const o of objs) {
    const refs = o.type === "line" ? [o.from, o.to].filter((r) => typeof r === "string") : o.type === "ring" ? [o.of] : o.type === "brace" ? [o.from, o.to] : [];
    for (const r of refs) {
      const t = byId.get(r);
      if (t && sec(t.at) > sec(o.at) + 0.05) errs.push(`对象「${o.id}」引用了「${r}」，但「${r}」要到 ${t.at} 才出现，比它晚。请让被引用的对象先出现`);
    }
  }
  if (errs.length) return errs;

  // 画布的时间范围：从 b.at 到下一个中央镜头开始（或场景结束）
  const later = (ctx.otherCenterAts ?? []).map((id) => sentenceIds.indexOf(id)).filter((i) => i > startI);
  const lastId = sentenceIds[sentenceIds.length - 1];
  const t0 = sec(b.at);
  const tEnd = later.length ? sec(sentenceIds[Math.min(...later)]) : sec(lastId) + len(texts[lastId]) / 5;
  const ctxS = { sec };

  // 1) 画面不能停住：出现、关键帧、弹跳之间最多隔 6.5 秒
  const evs = new Set();
  for (const o of objs) {
    evs.add(sec(o.at));
    for (const k of o.keys ?? []) evs.add(sec(k.at));
    for (const p of o.pulse ?? []) evs.add(sec(p));
    if (o.until) evs.add(sec(o.until));
  }
  const times = [t0, ...[...evs].filter((x) => x !== null && x > t0 && x < tEnd).sort((a, c) => a - c), tEnd];
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > 6.5) {
      errs.push(`画布在大约 ${times[i - 1].toFixed(0)} 到 ${times[i].toFixed(0)} 秒之间（${(times[i] - times[i - 1]).toFixed(0)} 秒）画面完全没有变化，最多 6 秒。请在这段话的关键词处让对象出现、移动、变化，或用 pulse 让它弹一下；如果内容已经讲完，就让画布提前结束`);
      break;
    }
  }
  // 至少要有"动"：关键帧总数
  const nKeys = objs.reduce((s, o) => s + (o.keys?.length ?? 0), 0);
  const nPulse = objs.reduce((s, o) => s + (o.pulse?.length ?? 0), 0);
  if (nKeys < 1 || nKeys + nPulse < 4) errs.push(`整个画布只有 ${nKeys} 个关键帧（keys）和 ${nPulse} 次弹跳（pulse），基本是静止的。要让东西随旁白移动、变大变小、数值变化、曲线参数变化：至少 1 个关键帧，关键帧加弹跳合计至少 4 次`);

  // 2) 几何：按 0.4 秒采样，持续 1.2 秒以上的部分重叠、出画布都报
  const runs = new Map();
  const outs = new Map();
  for (let t = t0 + 0.2; t < tEnd; t += 0.4) {
    const live = [];
    for (const o of objs) {
      if (!["shape", "text", "bars", "curve", "char", "icon"].includes(o.type)) continue;
      const a0 = sec(o.at), u = o.until ? sec(o.until) : Infinity;
      if (t < a0 + 0.5 || t >= u) continue;
      const bx = boxOf(o, stateAt(o, t, ctxS));
      if (bx) live.push({ o, bx });
    }
    const hit = new Set();
    for (const { o, bx } of live) if (bx.x0 < -6 || bx.x1 > 1606 || bx.y0 < -6 || bx.y1 > LOGIC_H + 6) outs.set(o.id, (outs.get(o.id) ?? 0) + 1);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const A = live[i], B = live[j];
      if (!inter(A.bx, B.bx)) continue;
      // 一个完全在另一个里面（文字写在图形上当标签）是允许的
      // 道具可以拿在角色手里（压在角色身上），道具和道具也可以靠在一起
      if ((A.o.type === "icon" && (B.o.type === "char" || B.o.type === "icon")) || (B.o.type === "icon" && A.o.type === "char")) continue;
      if ((B.o.type === "shape" && A.o.type === "text" && inside(A.bx, B.bx)) || (A.o.type === "shape" && B.o.type === "text" && inside(B.bx, A.bx))) continue;
      const key = [A.o.id, B.o.id].sort().join(" 和 ");
      hit.add(key);
      const r = runs.get(key) ?? { run: 0, best: 0, first: t };
      if (r.run === 0) r.first = t;
      r.run++; r.best = Math.max(r.best, r.run);
      runs.set(key, r);
    }
    for (const [k, r] of runs) if (!hit.has(k)) r.run = 0;
  }
  // 角色说话的气泡在头顶上方约 100px：任何时刻有话的角色，头顶不能超出画布上沿
  for (const o of objs.filter((x) => x.type === "char")) {
    const saysAt = [o.say ? sec(o.at) : null, ...(o.keys ?? []).filter((k) => k.say).map((k) => sec(k.at))].filter((x) => x !== null);
    for (const ts of saysAt) {
      const st = stateAt(o, ts + 0.4, ctxS);
      const top = st.y * PY - ((o.w ?? 150) * st.s) / 2 - 100;
      if (top < -4) { errs.push(`角色「${o.id}」说话时头顶的气泡会伸出画布上沿（它的 y 太小）。请把 y 调大（至少约 ${Math.ceil((((o.w ?? 150) * st.s) / 2 + 104) / PY)}）`); break; }
    }
  }
  // 圈：目标的范围 + 留白（手绘会再大一点）不能伸出画布
  for (const o of objs.filter((x) => x.type === "ring")) {
    const tg = byId.get(o.of);
    const tt = Math.min(tEnd - 0.3, sec(o.at) + 1);
    const bx = tg && boxOf(tg, stateAt(tg, tt, ctxS));
    if (bx) {
      const pad = (o.pad ?? 18) + 12;
      if (bx.x0 - pad < 0 || bx.x1 + pad > 1600 || bx.y0 - pad < 0 || bx.y1 + pad > LOGIC_H) errs.push(`手绘圈「${o.id}」圈住「${o.of}」时会伸出画布边缘（被圈的对象太靠边或太大）。请把「${o.of}」往画布里挪、缩小，或不要用圈`);
      // 圈会压住别的对象的字
      for (const q of objs) {
        if (q.id === o.of || !["shape", "text", "bars", "curve"].includes(q.type)) continue;
        const qb = boxOf(q, stateAt(q, tt, ctxS));
        if (!qb || sec(q.at) > tt || (q.until && sec(q.until) <= tt)) continue;
        const ring = { x0: bx.x0 - pad, x1: bx.x1 + pad, y0: bx.y0 - pad, y1: bx.y1 + pad };
        if (inter(ring, qb) && !(qb.x0 >= ring.x0 && qb.x1 <= ring.x1 && qb.y0 >= ring.y0 && qb.y1 <= ring.y1 && inter(bx, qb) === false && q.type !== "text")) {
          if (inter(bx, qb) || inter(ring, qb)) errs.push(`手绘圈「${o.id}」圈「${o.of}」时会压到「${q.id}」（它们离得太近）。请把「${q.id}」挪远，或换一种强调方式`);
        }
      }
    }
  }
  // 连线：两端对象的边缘离得太近，画不出箭头
  for (const o of objs.filter((x) => x.type === "line" && typeof x.from === "string" && typeof x.to === "string")) {
    const A0 = byId.get(o.from), B0 = byId.get(o.to);
    const tt = Math.min(tEnd - 0.3, sec(o.at) + 1.2);
    const A = boxOf(A0, stateAt(A0, tt, ctxS)), B = boxOf(B0, stateAt(B0, tt, ctxS));
    if (A && B) {
      const gapX = Math.max(A.x0 - B.x1, B.x0 - A.x1), gapY = Math.max(A.y0 - B.y1, B.y0 - A.y1);
      if (Math.max(gapX, gapY) < 50) errs.push(`连线「${o.id}」（${o.from}→${o.to}）两端的对象离得太近（边缘间隔 ${Math.round(Math.max(gapX, gapY))}px），画不出箭头。请把它们拉开到至少 50px`);
    }
  }
  for (const [k, r] of runs) if (r.best >= 3) errs.push(`「${k}」在约 ${r.first.toFixed(0)} 秒起有 ${(r.best * 0.4).toFixed(1)} 秒部分重叠（互相盖住一部分）。请调整它们的位置或大小，让它们分开；文字要写在图形里面，就把文字放到那个图形的 text 里，不要另外放一个 text 对象压在柱子或曲线上`);
  for (const [id, n] of outs) if (n >= 3) errs.push(`对象「${id}」有 ${(n * 0.4).toFixed(1)} 秒伸出了画布边缘，请把位置往里挪或缩小尺寸（x 0~100、y 0~100 是对象中心点，w/h 是像素）`);
  return errs;
}
