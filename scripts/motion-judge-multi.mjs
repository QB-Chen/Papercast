// 多个评审模型并行打分再合并：总分取平均；每个动作取各家里更差的判定；问题合并（标明是谁说的）
import { judgeMotion } from "./motion-judge.mjs";

const RANK = { ok: 0, weak: 1, missing: 2 };
const short = (m) => m.split("/").pop();

export async function judgeMotionMulti({ models, plan, report, sentences, W, H }) {
  const rs = await Promise.all(models.map(async (m) => ({ m, j: await judgeMotion({ model: m, plan, report, sentences, W, H }).catch(() => null) })));
  const got = rs.filter((r) => r.j);
  if (!got.length) return null;
  const beats = plan.beats.map((_, i) => {
    const per = got.map((r) => ({ m: r.m, ...(r.j.beats[i] ?? { verdict: "missing", note: "" }) }));
    const worst = per.reduce((a, b) => (RANK[b.verdict] > RANK[a.verdict] ? b : a));
    const notes = per.filter((p) => p.verdict !== "ok" && p.note).map((p) => `[${short(p.m)}] ${p.note}`).join(" ");
    return { n: i + 1, verdict: worst.verdict, note: notes || worst.note };
  });
  const scores = got.map((r) => r.j.overall?.score ?? 0);
  const problems = got.flatMap((r) => (r.j.overall?.problems ?? []).map((p) => `[${short(r.m)}] ${p}`));
  return {
    beats,
    overall: {
      score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      problems,
      scores: got.map((r) => ({ model: r.m, score: r.j.overall?.score ?? 0 })),
    },
  };
}
