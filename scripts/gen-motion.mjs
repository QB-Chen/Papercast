// 为"需要演示"的片段生成动画代码（HTML + CSS + GSAP）：导演写动作脚本 → 动画师写代码 → 浏览器检查 → 错误反馈给动画师重写。
//   node scripts/gen-motion.mjs <arXiv 编号> <场景id> <起始句 id> [--model sensenova/deepseek-flash] [--out llm-test/motion-out]
// 一次生成一处（demos.json 里 from == 起始句的那一条），结果写 JSON：{ at, plan, motion:{html,css,script}, attempts, errs }
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chatJson } from "./llm.mjs";
import { checkMotion } from "./motion-check.mjs";
import { paperSymbols } from "./free-validate.mjs";
import { judgeMotionMulti } from "./motion-judge-multi.mjs";
import { visionReview } from "./motion-vision.mjs";
import { demoContext } from "./motion-ctx.mjs";
import { DIRECTOR_SYSTEM, ANIMATOR_SYSTEM, directorUser, animatorUser } from "./motion-prompts.mjs";

const args = process.argv.slice(2);
const [id, sceneId, fromId] = args.filter((a) => !a.startsWith("--"));
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const model = flag("--model", "sensenova/deepseek-flash");
const outDir = flag("--out", "llm-test/motion-out");
const notes = flag("--notes", ""); // 画面质检发现的毛病（qa-fix 传进来），告诉导演和动画师这次必须避免
const root = `projects/${id}`;
const tl = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8")).scenes.find((s) => s.id === sceneId);
const plan = JSON.parse(readFileSync(`${root}/plan.json`, "utf8").replace(/^\uFEFF/, ""));
const demos = JSON.parse(readFileSync(`${root}/narration/demos.json`, "utf8"))[sceneId] ?? [];
const demo = demos.find((d) => d.from === fromId);
if (!demo) throw new Error(`demos.json 里 ${sceneId} 没有从 ${fromId} 开始的演示`);
const ids = tl.sentences.map((s) => s.id);
const CTX = demoContext(id, sceneId, fromId); // 生成、评审、渲染共用同一套真实时间（来自 timeline.json，不按字数估算，所以任何语言都准）
const SH = CTX.stageH; // 舞台高度：整块画布 520，公式下方的演示区 300
console.log(`舞台 1600×${SH}${SH === 300 ? "（公式下方的演示区）" : ""}`);
const texts = Object.fromEntries(tl.sentences.map((s) => [s.id, s.text]));
const a = ids.indexOf(demo.from), z = ids.indexOf(demo.to);
const sents = tl.sentences.slice(a, z + 1);
const durSec = CTX.durSec;
const LANG = CTX.lang;
const pj = (n) => JSON.parse(readFileSync(`${root}/paper/${n}.json`, "utf8"));
const paper = { text: readFileSync(`${root}/paper/paper.txt`, "utf8"), equations: pj("equations") };
const sym = paperSymbols(paper, plan.scenes.find((s) => s.id === sceneId)?.formulas ?? []);
const tag = plan.scenes.find((s) => s.id === sceneId)?.tag ?? sceneId;
mkdirSync(outDir, { recursive: true });

/** 把脚本里出现的 cue 解析成相对镜头起点的秒数；同时给 beats 算出时刻 */
const cuesOf = (script) => CTX.cuesOf(script);
const beatCues = CTX.beatSecsFor({ beats: (demo.beats ?? []).map((b) => ({ at: b.at, change: b.what })) });

console.log(`模型 ${model}，演示 ${demo.from}${demo.to !== demo.from ? "~" + demo.to : ""}：${demo.summary}（旁白约 ${durSec.toFixed(1)} 秒）`);

// 1) 导演：动作脚本
const t0 = Date.now();
const dir = await chatJson(model, [{ role: "system", content: DIRECTOR_SYSTEM }, { role: "user", content: directorUser({ sceneId, tag, demo, sentences: sents, notes, lang: LANG }) }],
  (o) => {
    const errs = [];
    if (!o?.intent || !o?.stage || !Array.isArray(o.beats)) return ["必须有 intent、stage、beats"];
    if (o.beats.length < 3 || o.beats.length > 6) errs.push("beats 写 3 到 5 条，只挑最关键的动作");
    o.beats.forEach((b, i) => {
      const m = String(b.at ?? "").match(/^([^@]+)@(.+)$/);
      if (!m || !ids.slice(a, z + 1).includes(m[1])) errs.push(`beats[${i}].at 必须写成 句子id@原话，且句子在 ${demo.from}~${demo.to} 内`);
      else if (/[，。？！、：；,.?!;:“”「」（）()]/.test(m[2])) errs.push(`beats[${i}].at 的短语「${m[2]}」含标点，请只取逗号之间连续的几个字`);
      else if (!texts[m[1]].includes(m[2])) errs.push(`beats[${i}].at 的短语「${m[2]}」不在句子 ${m[1]} 的原文里（必须是原文里连续的字）`);
      if (!b.change) errs.push(`beats[${i}].change 必填`);
      if (!b.key || String(b.key).length < 4) errs.push(`beats[${i}].key 必填：这一拍观众必须看到的那一个可见变化（一句话）`);
    });
    return errs;
  }, { maxRounds: 4, temperature: 0.5, maxTokens: 40000, tag: `mdir-${sceneId}-${fromId}`, timeoutMs: 600_000 });
if (dir.errors?.length) { console.log("✗ 导演没通过：", dir.errors.slice(0, 2).join("；")); process.exit(1); }
console.log(`导演完成（${((Date.now() - t0) / 1000).toFixed(0)}s，${dir.obj.beats.length} 个动作）`);
for (const b of dir.obj.beats) console.log(`   ${b.at}：${b.change}`);

// 2) 动画师：代码，错误反馈重写
const t1 = Date.now();
const beatSecs = CTX.beatSecsFor(dir.obj);
let last = null;
const anim = await chatJson(model, [{ role: "system", content: ANIMATOR_SYSTEM }, { role: "user", content: animatorUser({ script: dir.obj, sentences: sents, durSec, notes, lang: LANG }) }],
  (o) => {
    if (!o?.html || !o?.script) return ['必须输出 {"html":"…","css":"…","script":"…"}，三项都要有'];
    const cues = cuesOf(o.script);
    const r = checkMotion({ html: o.html, css: o.css ?? "", script: o.script, W: 1600, H: SH, dur: durSec, cues, beatCues: beatSecs, lang: LANG, sym, tag: `${sceneId}-${fromId}` });
    last = r;
    return r.errs;
  }, { maxRounds: 8, temperature: 0.5, maxTokens: 100000, tag: `manim-${sceneId}-${fromId}`, timeoutMs: 900_000, extra: {} });
let ok = !anim.errors?.length;
// 评审闭环（OpenMotion 审片规则：看实际画面；结论只用 成立/需修改/未验证 加证据，不用综合分数当合格线）：
//   文字评审：glm-5.3 读浏览器测出来的时间线；看图评审：kimi-k3（能看图，且和写代码的 deepseek 不同家）看每个动作时刻的截图。
//   每个动作只要有一边说没到位就算没到位；最佳版本 = 两边都认可的动作最多的那一版。
const judgeModels = flag("--judge-models", flag("--judge-model", "sensenova/glm-5.3")).split(",").map((x) => x.trim()).filter(Boolean);
const visionModel = flag("--vision-model", "sensenova/kimi-k3");
const JR = +flag("--judge-rounds", "2");
const OKV = new Set(["ok", "成立"]);
async function reviewOnce(cur, label) {
  const [tj, vj] = await Promise.all([
    judgeMotionMulti({ models: judgeModels, plan: dir.obj, report: cur.report, sentences: sents, W: 1600, H: SH }).catch(() => null),
    visionModel && visionModel !== "none" ? visionReview({ model: visionModel, motion: cur.obj, cues: cuesOf(cur.obj.script), plan: dir.obj, beatSecs, dur: durSec, tag: `${sceneId}-${fromId}-${label}` }).catch((e) => ({ error: String(e).slice(0, 120) })) : null,
  ]);
  if (vj?.error) console.log("  看图评审没跑成：" + vj.error);
  const vOk = vj && !vj.error;
  const beats = dir.obj.beats.map((bt, i) => {
    const t = tj?.beats?.[i], v = vOk ? vj.beats[i] : null;
    const tOK = t ? OKV.has(t.verdict) : null, vOK = v ? v.verdict === "成立" : null;
    const bad = tOK === false || v?.verdict === "需修改";
    const verdict = bad ? "需修改" : (tOK && (vOK || vOK === null) ? "成立" : "未验证");
    return { at: bt.at, verdict, text: t ? { verdict: t.verdict, note: t.note } : null, vision: v ? { verdict: v.verdict, evidence: v.evidence } : null };
  });
  const problems = [...(tj?.overall?.problems ?? []), ...(vOk ? (vj.overall?.problems ?? []).map((p) => "[看图] " + p) : [])];
  return { beats, problems, okBeats: beats.filter((x) => x.verdict === "成立").length, textScore: tj?.overall?.score ?? null, sheet: vOk ? vj.sheet : null, hasText: !!tj, hasVision: !!vOk };
}
let best = ok ? { obj: anim.obj, report: last?.report, review: null } : null;
const rank = (r) => (r ? r.okBeats * 1000 + (r.textScore ?? 0) - r.problems.length : -1);
if (ok && JR > 0) {
  let cur = { obj: anim.obj, report: last.report };
  for (let r = 0; r <= JR; r++) {
    const rv = await reviewOnce(cur, "r" + r);
    console.log(`评审第 ${r} 次：${rv.okBeats}/${rv.beats.length} 个动作两边都认可（文字评审分 ${rv.textScore ?? "-"}；看图 ${rv.hasVision ? "有" : "没跑成"}）${rv.problems.length ? "；问题：" + rv.problems.slice(0, 4).join(" / ") : ""}`);
    if (!best.review || rank(rv) >= rank(best.review)) best = { obj: cur.obj, report: cur.report, review: rv };
    const weak = rv.beats.map((x, i) => ({ ...x, beat: dir.obj.beats[i] })).filter((x) => x.verdict === "需修改");
    if ((!weak.length && !rv.problems.length) || r === JR) break;
    const fb = `上一版经过两位审片员评审（一位读时间线，一位看了每个动作时刻的画面截图），下面这些问题还没解决，请在保持其他部分的前提下改写（仍然输出完整的 {"html","css","script"}）：\n${weak.map((x) => `- ${x.beat.at}（${x.beat.change}）：${[x.text?.verdict !== "ok" && x.text?.note, x.vision?.verdict === "需修改" && "[看图] " + x.vision.evidence].filter(Boolean).join(" ")}`).join("\n")}\n整体问题：${rv.problems.slice(0, 6).join("；")}`;
    const again = await chatJson(model, [{ role: "system", content: ANIMATOR_SYSTEM }, { role: "user", content: animatorUser({ script: dir.obj, sentences: sents, durSec, notes, lang: LANG }) }, { role: "assistant", content: JSON.stringify(cur.obj) }, { role: "user", content: fb }],
      (o) => {
        if (!o?.html || !o?.script) return ['必须输出 {"html","css","script"}'];
        const rr = checkMotion({ html: o.html, css: o.css ?? "", script: o.script, W: 1600, H: SH, dur: durSec, cues: cuesOf(o.script), beatCues: beatSecs, lang: LANG, sym, tag: `${sceneId}-${fromId}` });
        last = rr;
        return rr.errs;
      }, { maxRounds: 6, temperature: 0.5, maxTokens: 100000, tag: `manim2-${sceneId}-${fromId}`, timeoutMs: 900_000 });
    if (again.errors?.length) { console.log("  改写后没通过浏览器检查，保留上一版"); break; }
    cur = { obj: again.obj, report: last.report };
  }
  if (best) { anim.obj = best.obj; ok = true; }
}
console.log(`动画师${ok ? "通过" : "未通过"}（${((Date.now() - t1) / 1000).toFixed(0)}s，${anim.rounds} 轮）${last?.stats ? `  时间线 ${last.stats.duration.toFixed(1)}s，旁白动作 ${last.stats.beatsHit ?? "-"}/${last.stats.beats ?? "-"}` : ""}`);
if (!ok) for (const e of anim.errors.slice(0, 5)) console.log("   -", e);
const out = { at: demo.from, to: demo.to, ok, rounds: anim.rounds, errs: anim.errors ?? [], review: best?.review ?? null, okBeats: best?.review?.okBeats ?? null, beatCount: dir.obj.beats.length, score: best?.review?.textScore ?? null, unverified: ["动作是否顺滑", "声音是否同步", "实际播放"], plan: dir.obj, motion: anim.obj ? { html: anim.obj.html, css: anim.obj.css ?? "", script: anim.obj.script } : null, durSec };
const file = `${outDir}/${sceneId}-${fromId}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`→ ${file}`);
