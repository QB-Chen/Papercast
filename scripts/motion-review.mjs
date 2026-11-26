// 评审一份动画：浏览器实测 → 文字评审（读时间线）+ 看图评审（看每个动作时刻的截图）。
// 结论只用 成立/需修改/未验证 加证据。一个动作只要有一边判"需修改"就是需修改；两边都认可才算"成立"。
import { readFileSync } from "node:fs";
import { checkMotion } from "./motion-check.mjs";
import { judgeMotionMulti } from "./motion-judge-multi.mjs";
import { visionReview } from "./motion-vision.mjs";
import { paperSymbols } from "./free-validate.mjs";

const OKV = new Set(["ok", "成立"]);
const symCache = {};
export function symbolsFor(ctx, sceneId, id) {
  const k = id + sceneId;
  if (symCache[k]) return symCache[k];
  const root = `projects/${id}`;
  const plan = JSON.parse(readFileSync(`${root}/plan.json`, "utf8").replace(/^\uFEFF/, ""));
  const pj = (n) => JSON.parse(readFileSync(`${root}/paper/${n}.json`, "utf8"));
  const paper = { text: readFileSync(`${root}/paper/paper.txt`, "utf8"), equations: pj("equations") };
  return (symCache[k] = paperSymbols(paper, plan.scenes.find((s) => s.id === sceneId)?.formulas ?? []));
}

/** 返回 { beats, problems, okBeats, beatCount, textScore, sheet, hasText, hasVision, browserErrs } */
export async function reviewMotion({ id, sceneId, ctx, plan, motion, textModels = ["sensenova/glm-5.3"], visionModel = "sensenova/kimi-k3", tag = "rv" }) {
  const cues = ctx.cuesOf(motion.script);
  const beatSecs = ctx.beatSecsFor(plan);
  const chk = checkMotion({ html: motion.html, css: motion.css ?? "", script: motion.script, W: ctx.stageW, H: ctx.stageH, dur: ctx.durSec, cues, beatCues: beatSecs, lang: ctx.lang, sym: symbolsFor(ctx, sceneId, id), tag: `${sceneId}-${ctx.demo.from}-${tag}` });
  if (chk.errs.length) return { beats: [], problems: chk.errs, okBeats: 0, beatCount: plan.beats.length, textScore: null, sheet: null, hasText: false, hasVision: false, browserErrs: chk.errs };
  const tryVision = async () => {
    if (!visionModel || visionModel === "none") return null;
    for (let k = 0; k < 2; k++) {
      const v = await visionReview({ model: visionModel, motion, cues, plan, beatSecs, dur: ctx.durSec, W: ctx.stageW, H: ctx.stageH, tag: `${sceneId}-${ctx.demo.from}-${tag}` }).catch((e) => ({ error: String(e).slice(0, 120) }));
      if (!v.error) return v;
      if (k === 1) console.log(`  看图评审没跑成（${sceneId}/${ctx.demo.from}）：${v.error}`);
    }
    return null;
  };
  const [tj, vj] = await Promise.all([
    judgeMotionMulti({ models: textModels, plan, report: chk.report, sentences: ctx.sents, W: ctx.stageW, H: ctx.stageH }).catch(() => null),
    tryVision(),
  ]);
  const beats = plan.beats.map((bt, i) => {
    const t = tj?.beats?.[i], v = vj?.beats?.[i] ?? null;
    const tOK = t ? OKV.has(t.verdict) : null, vOK = v ? v.verdict === "成立" : null;
    const bad = tOK === false || v?.verdict === "需修改";
    const verdict = bad ? "需修改" : (tOK && (vOK || vOK === null) ? "成立" : (vOK && tOK === null ? "成立" : "未验证"));
    return { at: bt.at, verdict, text: t ? { verdict: t.verdict, note: t.note } : null, vision: v ? { verdict: v.verdict, evidence: v.evidence } : null };
  });
  const problems = [...(tj?.overall?.problems ?? []), ...(vj?.overall?.problems ?? []).map((p) => "[看图] " + p)];
  return { beats, problems, okBeats: beats.filter((b) => b.verdict === "成立").length, beatCount: beats.length, textScore: tj?.overall?.score ?? null, sheet: vj?.sheet ?? null, hasText: !!tj, hasVision: !!vj };
}

/** 比较两份评审：成立动作占比高的好；一样就比问题少的 */
export const reviewRank = (r) => (r ? (r.okBeats / Math.max(1, r.beatCount)) * 1000 - r.problems.length + (r.hasVision ? 0 : -500) : -9999);
