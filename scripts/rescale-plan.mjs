// 把规划里每个场景的句数范围按比例缩放，并同步改简报里的"句数:"行。
// 用途：旁白改成长句风格后，每句讲的时间更长（约 7 秒，原来约 4.7 秒），同样的视频时长需要的句数更少。
//   node scripts/rescale-plan.mjs <arXiv 编号> [倍数，默认 0.68]
import { readFileSync, writeFileSync } from "node:fs";

const id = process.argv[2];
const k = +(process.argv[3] ?? 0.68);
const root = `projects/${id}`;
const plan = JSON.parse(readFileSync(`${root}/plan.json`, "utf8"));
for (const s of plan.scenes) {
  const m = String(s.sentences).match(/^(\d+)\s*[-~]\s*(\d+)$/);
  if (!m) continue;
  const lo = Math.max(5, Math.round(+m[1] * k));
  const hi = Math.max(lo + 2, Math.round(+m[2] * k));
  const old = s.sentences;
  s.sentences = `${lo}-${hi}`;
  const f = `${root}/briefs/${s.id}.md`;
  const md = readFileSync(f, "utf8").replace(/^句数:.*$/m, `句数: ${s.sentences}`);
  writeFileSync(f, md);
  console.log(`${s.id}: ${old} → ${s.sentences}`);
}
writeFileSync(`${root}/plan.json`, JSON.stringify(plan, null, 2));
