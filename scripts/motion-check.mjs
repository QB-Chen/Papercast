// 用真浏览器检查模型写的动画代码（HTML + CSS + GSAP）。
//   import { checkMotion, shotMotion } from "./motion-check.mjs"
// 做法：生成一页自包含的 HTML，Edge 无头模式加载，页面里用和渲染相同的运行时（src/story/motion-runtime.mjs）搭好时间线，
// 每 0.25 秒 seek 一次，量每个元素真实的位置、尺寸、有效透明度，然后在 Node 里分析：
//   报错、出界、重叠、画面停住、旁白动作那一刻有没有变化、文字内容（数字/英文/符号来源）、素材是否存在。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { checkScript, sanitizeHtml, scopeCss } from "../src/story/motion-runtime.mjs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ROOT = resolve(".");
const toUrl = (p) => "file:///" + resolve(p).replace(/\\/g, "/");
const STEP = 0.25;

function pageHtml({ html, css, script, W, H, dur, cues, mode, t }) {
  const rt = readFileSync("src/story/motion-runtime.mjs", "utf8").replace(/^export /gm, "");
  const plug = ["MotionPathPlugin", "DrawSVGPlugin", "MorphSVGPlugin"].map((p) => `<script src="${toUrl(`node_modules/gsap/dist/${p}.min.js`)}"></script>`).join("\n");
  const payload = JSON.stringify({ html, css, script, W, H, dur, cues, mode, t, step: STEP, publicDir: toUrl("public") });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#EEF4F4;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#1F3A5F}
#stage{position:relative;width:${W}px;height:${H}px;overflow:visible;background:rgba(255,255,255,.55)}
</style>
<script src="${toUrl("node_modules/gsap/dist/gsap.min.js")}"></script>${plug}
</head><body><div id="stage"></div><pre id="out" style="display:none"></pre>
<script>
${rt}
gsap.registerPlugin(MotionPathPlugin, DrawSVGPlugin, MorphSVGPlugin);
const P = ${payload};
const report = { ok: false, err: null, samples: [], duration: 0, texts: [] };
try {
  const m = buildMotion({ root: document.getElementById("stage"), html: P.html, css: P.css, script: P.script, gsap,
    cue: (r) => (r in P.cues ? P.cues[r] : NaN), assetUrl: (p) => P.publicDir + "/" + p, W: P.W, H: P.H, dur: P.dur });
  report.duration = m.tl.duration();
  const stage = document.getElementById("stage");
  const sr = stage.getBoundingClientRect();
  const all = Array.from(stage.querySelectorAll("*")).filter((e) => !["STYLE", "SCRIPT", "defs", "stop", "linearGradient", "title", "desc"].includes(e.tagName) && !/^(path|circle|rect|line|polyline|polygon|ellipse|g|use|clipPath|mask|tspan)$/i.test(e.tagName) || e.tagName === "svg");
  const desc = (e) => (e.id ? "#" + e.id : e.className && typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/)[0] : e.tagName.toLowerCase()) + (e.tagName === "IMG" ? "(" + (e.getAttribute("src") || "").split("/").pop() + ")" : "");
  const effOpacity = (e) => { let o = 1; for (let n = e; n && n !== stage.parentNode; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return 0; o *= parseFloat(cs.opacity); } return o; };
  const isContent = (e) => { if (["IMG", "svg", "CANVAS"].includes(e.tagName)) return true; for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; const cs = getComputedStyle(e); if (!e.children.length && (parseFloat(cs.borderTopWidth) > 0 || cs.backgroundColor !== "rgba(0, 0, 0, 0)")) return true; return false; };
  const content = all.filter(isContent);
  const subSig = (e) => { if (e.tagName !== 'svg') return ''; const ds = Array.from(e.querySelectorAll('g,path,circle,rect,ellipse,line,polygon,polyline,text')).slice(0, 80); return ds.map((d) => { const r = d.getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height) + ',' + Math.round(parseFloat(getComputedStyle(d).opacity) * 100); }).join(';'); };
  report.texts = Array.from(new Set(content.flatMap((e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()))));
  report.names = content.map(desc);
  report.srcs = content.map((e) => (e.tagName === "IMG" ? (e.getAttribute("src") || "") : ""));
  const times = [];
  if (P.mode === "shot") times.push(P.t);
  else for (let t = 0; t <= Math.max(P.dur, report.duration) + 1e-6; t += P.step) times.push(Math.round(t * 1000) / 1000);
  for (const t of times) {
    m.seek(t);
    if (P.mode === "shot") break;
    const els = content.map((e, i) => { const r = e.getBoundingClientRect(); return { i, x0: Math.round(r.left - sr.left), y0: Math.round(r.top - sr.top), x1: Math.round(r.right - sr.left), y1: Math.round(r.bottom - sr.top), o: Math.round(effOpacity(e) * 100) / 100, hold: !!e.closest("[data-hold]"), person: e.tagName === 'svg' && e.classList.contains('person'), sub: subSig(e), fs: Math.round(parseFloat(getComputedStyle(e).fontSize)), txt: Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()), src: e.tagName === "IMG" ? (e.getAttribute("src") || "") : "" }; });
    report.samples.push({ t, els });
  }
  report.anc = content.map((e) => content.map((f, j) => (e !== f && (e.contains(f) || f.contains(e)) ? j : -1)).filter((j) => j >= 0));
  report.ok = true;
} catch (e) { report.err = String((e && e.message) || e); }
document.getElementById("out").textContent = JSON.stringify(report);
document.title = "done";
</script></body></html>`;
}

function runEdge(file, extra = []) {
  const r = spawnSync(EDGE, ["--headless=new", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files", "--hide-scrollbars", "--virtual-time-budget=8000", ...extra], { encoding: "utf8", timeout: 60_000, maxBuffer: 1 << 28 });
  return r;
}

/** 校验一段动画代码。返回 { errs, stats, report }。errs 是中文，原样反馈给模型。 */
export function checkMotion({ html, css = "", script, W = 1600, H = 520, dur = 10, cues = {}, beatCues = [], texts = {}, sym = null, minBeatHit = 0.75, tag = "m", lang = "zh" }) {
  const errs = [];
  // 静态检查（不用浏览器就能发现的）
  const s = sanitizeHtml(html, (p) => p);
  const c = scopeCss(css, "stage");
  errs.push(...s.errs, ...c.errs, ...checkScript(script));
  for (const m of String(html).matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) if (/^(props|chars|stickers[\w-]*)\//.test(m[1]) && !existsSync(join("public", m[1]))) errs.push(`素材「${m[1]}」不存在，请从素材清单里选`);
  // cue 的参数必须是字符串字面量，并且解析得出来
  const used = [...String(script).matchAll(/cue\(\s*(["'`])([^"'`]*?)\1\s*\)/g)].map((m) => m[2]);
  const nonLit = (String(script).match(/cue\(/g) ?? []).length - used.length;
  if (nonLit > 0) errs.push(`有 ${nonLit} 处 cue() 的参数不是纯字符串（如 cue("h2@端出来")）。cue 的参数必须直接写字符串，不能拼接或用变量`);
  for (const u of new Set(used)) if (!(u in cues) || !Number.isFinite(cues[u])) errs.push(`cue("${u}") 解析不了：句子 id 不对，或「@」后面的短语不在这句旁白原文里（必须是原文里连续的几个字，不含标点）`);
  if (errs.length) return { errs, stats: null, report: null };

  mkdirSync("llm-test/mc", { recursive: true });
  const file = `llm-test/mc/${tag}.html`;
  writeFileSync(file, pageHtml({ html, css, script, W, H, dur, cues, mode: "check", t: 0 }));
  const r = runEdge(file, ["--dump-dom", toUrl(file)]);
  const dom = r.stdout ?? "";
  const mm = dom.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/);
  if (!mm) return { errs: ["页面没有跑出结果（脚本可能死循环或页面崩溃）"], stats: null, report: null };
  let rep;
  try { rep = JSON.parse(mm[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")); } catch { return { errs: ["页面输出解析失败"], stats: null, report: null }; }
  if (!rep.ok) return { errs: [`脚本运行出错：${rep.err}`], stats: null, report: rep };

  const S = rep.samples, names = rep.names;
  const rep0 = rep.srcs.map((s) => (/\/chars\/[\w-]+\.svg$/.test(s) ? s : ""));
  const nS = S.length;
  const vis = (e) => e.o > 0.2 && e.x1 > e.x0 && e.y1 > e.y0;
  const stats = { duration: rep.duration, elements: names.length };

  // 1) 时间线时长：要覆盖这段旁白（至少 70%），也不能超出太多
  if (rep.duration < dur * 0.7) errs.push(`动画时间线只有 ${rep.duration.toFixed(1)} 秒，这段旁白有 ${dur.toFixed(1)} 秒，后面 ${(dur - rep.duration).toFixed(1)} 秒画面会定格不动。请让动作一直铺到旁白讲完（用 cue 把动作放到旁白后半段的词上）`);

  // 2) 出界：有效透明度 >0.2 的元素跑出舞台（容许 12px），持续 ≥ 1 秒
  const outRun = new Map();
  for (let k = 0; k < nS; k++) for (const e of S[k].els) {
    if (!vis(e)) { outRun.set(e.i, 0); continue; }
    const out = e.x0 < -12 || e.y0 < -12 || e.x1 > W + 12 || e.y1 > H + 12;
    outRun.set(e.i, out ? (outRun.get(e.i) ?? 0) + 1 : 0);
    if (outRun.get(e.i) === Math.ceil(1 / STEP)) errs.push(`「${names[e.i]}」在约 ${S[k].t.toFixed(1)} 秒伸出了舞台（舞台是 ${W}×${H}，它的范围是 ${e.x0},${e.y0} 到 ${e.x1},${e.y1}）。请把它挪进来或缩小`);
  }

  // 3) 重叠：两个内容元素（不是祖先后代）互相盖住超过较小者的 30%，持续 ≥ 1.25 秒；完全包在里面的不算
  const pairRun = new Map();
  const anc = rep.anc.map((a) => new Set(a));
  for (let k = 0; k < nS; k++) {
    const E = S[k].els.filter(vis);
    const seen = new Set();
    for (let a = 0; a < E.length; a++) for (let b = a + 1; b < E.length; b++) {
      const A = E[a], B = E[b];
      if (anc[A.i].has(B.i)) continue;
      if (A.hold || B.hold) continue; // 标了 data-hold 的元素（拿在手里的道具、角色头上的气泡、贴在身上的标记）允许盖在别的东西上
      const ix = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), iy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      if (ix <= 6 || iy <= 6) continue;
      const areaA = (A.x1 - A.x0) * (A.y1 - A.y0), areaB = (B.x1 - B.x0) * (B.y1 - B.y0);
      const frac = (ix * iy) / Math.min(areaA, areaB);
      const inside = (P, Q) => P.x0 >= Q.x0 - 4 && P.x1 <= Q.x1 + 4 && P.y0 >= Q.y0 - 4 && P.y1 <= Q.y1 + 4;
      if (frac < 0.3 || inside(A, B) || inside(B, A)) continue;
      const key = `${A.i}|${B.i}`;
      seen.add(key);
      const r0 = pairRun.get(key) ?? { run: 0, first: S[k].t, best: 0 };
      if (r0.run === 0) r0.first = S[k].t;
      r0.run++; r0.best = Math.max(r0.best, r0.run);
      pairRun.set(key, r0);
    }
    for (const [key, r0] of pairRun) if (!seen.has(key)) r0.run = 0;
  }
  const overlaps = [...pairRun.entries()].filter(([, r0]) => r0.best >= Math.ceil(1.25 / STEP));
  for (const [key, r0] of overlaps.slice(0, 4)) { const [a, b] = key.split("|").map(Number); errs.push(`「${names[a]}」和「${names[b]}」在约 ${r0.first.toFixed(1)} 秒起有 ${(r0.best * STEP).toFixed(1)} 秒互相盖住一大块。请错开位置，或让其中一个先淡出/移走；如果是故意的（道具拿在手里/凑到嘴边/贴在身上），给那个道具的标签加 data-hold 属性（文字写在图形里面，请把文字放进那个图形的 DOM 里作为它的子元素，不要另放一个盖在上面）`); }
  if (overlaps.length > 4) errs.push(`另外还有 ${overlaps.length - 4} 对元素互相盖住，请整体检查布局`);

  // 4) 画面停住：所有元素的位置和透明度连续 5.5 秒以上没有变化
  const sig = (k) => S[k].els.map((e) => `${e.x0},${e.y0},${e.x1},${e.y1},${e.o},${e.sub ?? ""}`).join("|");
  let run = 0, runStart = 0;
  for (let k = 1; k < nS; k++) {
    if (sig(k) === sig(k - 1)) { if (run === 0) runStart = S[k - 1].t; run++; } else {
      if (run * STEP > 5.5) { errs.push(`在约 ${runStart.toFixed(1)} 到 ${(runStart + run * STEP).toFixed(1)} 秒之间画面完全没有变化（${(run * STEP).toFixed(1)} 秒），最多 5 秒。请在这段话的关键词处让东西动起来、出现或变化`); break; }
      run = 0;
    }
  }
  if (run * STEP > 5.5 && !errs.some((e) => e.includes("完全没有变化"))) errs.push(`在约 ${runStart.toFixed(1)} 秒之后画面完全没有变化（${(run * STEP).toFixed(1)} 秒），最多 5 秒。请让动作一直铺到旁白讲完`);

  // 5) 画面空了：连续 ≥ 1.5 秒没有任何可见内容（第一秒除外）
  let empty = 0;
  for (let k = 0; k < nS; k++) {
    if (S[k].t < 0.8) continue;
    empty = S[k].els.some(vis) ? 0 : empty + 1;
    if (empty * STEP >= 1.5) { errs.push(`在约 ${S[k].t.toFixed(1)} 秒画面是空的（没有任何可见元素），请保证有内容`); break; }
  }

  // 6) 旁白动作对时：每个关键动作那一刻前 1 秒到后 1.5 秒内，必须有元素变化
  if (beatCues.length) {
    const changeAt = [];
    for (let k = 1; k < nS; k++) changeAt.push(sig(k) !== sig(k - 1) ? S[k].t : null);
    const changes = changeAt.filter((x) => x !== null);
    const missed = beatCues.filter((bc) => !changes.some((t) => t >= bc.sec - 1.0 && t <= bc.sec + 1.5));
    stats.beats = beatCues.length; stats.beatsHit = beatCues.length - missed.length;
    if (beatCues.length && (beatCues.length - missed.length) / beatCues.length < minBeatHit) errs.push(`旁白这些动作的那一刻，画面完全没有变化（前 1 秒到后 1.5 秒内没有任何元素动）：${missed.map((m) => `${m.ref}（${m.what}）`).join("；")}。请在这些时刻写动画，位置直接用 cue("${missed[0]?.ref}") 这样的原话`);
  }

  // 6.5) 尺寸：文字够大、角色和道具够大、画面不能只有一小撮东西
  {
    const small = new Set(), tiny = new Set(), maxW = new Map();
    let minFill = 1, sparse = 0;
    const area = W * H;
    for (let k = 0; k < nS; k++) {
      const E = S[k].els.filter(vis);
      for (const e of E) {
        if (e.txt && e.fs < 26 && !e.hold) small.add(`${names[e.i]}(${e.fs}px)`);
        const w = e.x1 - e.x0;
        if (e.person && e.o > 0.6) { const m0 = maxW.get(e.i); if (!m0 || w > m0.w) maxW.set(e.i, { w, hold: e.hold, ch: true }); }
        if (/\/(chars|props)\/[\w-]+\.svg$/.test(e.src) && e.o > 0.6) { const m = maxW.get(e.i); if (!m || w > m.w) maxW.set(e.i, { w, hold: e.hold, ch: /\/chars\//.test(e.src) }); }

      }
      if (S[k].t > 1.0 && E.length) {
        const x0 = Math.min(...E.map((e) => e.x0)), y0 = Math.min(...E.map((e) => e.y0)), x1 = Math.max(...E.map((e) => e.x1)), y1 = Math.max(...E.map((e) => e.y1));
        const fill = ((x1 - x0) * (y1 - y0)) / area;
        minFill = Math.min(minFill, fill);
        if (fill < 0.2 || (y1 - y0) < 0.55 * H || (x1 - x0) < 0.6 * W) sparse++;
      }
    }
    for (const [i, m] of maxW) { if (m.ch && m.w < 150) tiny.add(`${names[i]}（最大宽 ${m.w}px，角色至少 150px）`); else if (!m.ch && !m.hold && m.w < 70) tiny.add(`${names[i]}（最大宽 ${m.w}px，道具至少 70px）`); }
    if (small.size) errs.push(`这些文字太小，观众看不清（字号至少 26px）：${[...small].slice(0, 4).join("、")}。请调大字号，或者删掉这条文字`);
    if (tiny.size) errs.push(`这些素材画得太小：${[...tiny].slice(0, 4).join("、")}。主角是画面的重点，请放大（角色 width 建议 190~260，道具 90~140）`);
    if (sparse * STEP > 2.5) errs.push(`画面太空：有 ${(sparse * STEP).toFixed(1)} 秒，所有内容挤在舞台的一小块里（外框占不到舞台面积的 20%，或高度不到舞台的 55%、宽度不到 60%，常见情况是东西都贴在下半部、上半部空着）。请把人物和东西放大、上下左右拉开，让人物站在舞台中下部、气泡/表情/飞行的东西占满上半部，铺满舞台（舞台是 ${W}×${H}）`);
  }
  // 6.6) 不许"换姿势就换了人"：同一位置先后出现两个不同的 chars 文件
  {
    const swaps = new Set();
    const charIdx = names.map((n, i) => ({ n, i })).filter((x) => /\((?:[\w-]+)\.svg\)/.test(x.n) && rep0[x.i]);
    const byCharSrc = (i) => rep0[i];
    for (let a = 0; a < charIdx.length; a++) for (let b = a + 1; b < charIdx.length; b++) {
      const A = charIdx[a].i, B = charIdx[b].i;
      if (byCharSrc(A) === byCharSrc(B)) continue;
      let alive = null;
      for (let k = 0; k < nS; k++) {
        const ea = S[k].els.find((e) => e.i === A), eb = S[k].els.find((e) => e.i === B);
        if (!ea || !eb) continue;
        const ca = [(ea.x0 + ea.x1) / 2, (ea.y0 + ea.y1) / 2], cb = [(eb.x0 + eb.x1) / 2, (eb.y0 + eb.y1) / 2];
        const near = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) < 140;
        const va = ea.o > 0.3, vb = eb.o > 0.3;
        if (near && va !== vb) { alive = true; swaps.add(`${byCharSrc(A)} 和 ${byCharSrc(B)}`); }
      }
    }
    if (swaps.size) errs.push(`角色换姿势会变成另一个人（图片是不同的人物形象，不是同一个人换表情）：${[...swaps].slice(0, 3).join("；")} 在同一个位置先后替换。请保持同一个角色图不变，用头顶的表情（props/ 里的表情）、rotation 摇头晃动、y 点头、scale 抖动来表现心情和动作`);
  }
  // 7) 画面文字：长度、数字、英文、符号来源
  // 画面文字规则按视频语言切换：中文 ≤14 字且不要自己造英文；英文 ≤5 个单词且 ≤32 字符，不要混入中日韩字符。数字规则两种语言都一样
  const isEn = lang === "en";
  const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
  for (const t of rep.texts) {
    if (isEn) {
      const words = t.split(/\s+/).filter(Boolean).length;
      if (words > 5 || [...t].length > 32) errs.push(`文字「${t}」太长（${words} 个单词、${[...t].length} 个字符，上限 5 个单词、32 个字符）`);
      if (CJK.test(t)) errs.push(`文字「${t}」含中日韩文字：这支视频是英文的，画面上的字也要用英文`);
    } else if ([...t].length > 14) errs.push(`文字「${t}」太长（${[...t].length} 字，上限 14）`);
    if (/[0-9０-９]/.test(t)) errs.push(`文字「${t}」含数字：画面是示意图，数字只由旁白讲，请换成不含数字的写法`);
    if (isEn) {
      // 英文视频：普通英文单词是正常的；只检查希腊字母符号必须出自论文公式
      if (sym?.any) for (const ch of t) if (/[α-ωΑ-Ω]/.test(ch) && !sym.chars.has(ch)) errs.push(`文字「${t}」里的符号「${ch}」没有在论文公式里出现过`);
    } else if (sym?.any) {
      for (const w of t.matchAll(/[A-Za-z]+/g)) { const x = w[0]; if (x.length >= 2 ? !sym.words.has(x) && ![...x].every((ch) => sym.chars.has(ch)) : !sym.chars.has(x)) errs.push(`文字「${t}」里的「${x}」不是论文公式里出现过的符号或函数名，不能自己造英文`); }
      for (const ch of t) if (/[α-ωΑ-Ω]/.test(ch) && !sym.chars.has(ch)) errs.push(`文字「${t}」里的符号「${ch}」没有在论文公式里出现过`);
    } else if (/[A-Za-z]{2,}/.test(t)) errs.push(`文字「${t}」含英文单词，请用中文`);
  }
  return { errs: [...new Set(errs)], stats, report: rep };
}

/** 渲染舞台在某一刻的静帧（PNG），用来看画面 */
export function shotMotion({ html, css = "", script, W = 1600, H = 520, dur = 10, cues = {}, t = 0, out }) {
  mkdirSync("llm-test/mc", { recursive: true });
  const file = `llm-test/mc/shot-${Math.abs(Math.round(t * 1000))}.html`;
  writeFileSync(file, pageHtml({ html, css, script, W, H, dur, cues, mode: "shot", t }));
  mkdirSync(resolve(out, ".."), { recursive: true });
  const r = runEdge(file, [`--screenshot=${resolve(out)}`, `--window-size=${W},${H}`, toUrl(file)]);
  return existsSync(out);
}
