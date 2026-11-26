// 把 gen-motion 通过的结果装进分镜（先备份分镜目录），并写一份审片报告。
//   node scripts/install-motion.mjs <arXiv 编号> [--dir projects/<id>/narration/motion] [--min-ratio 0.5] [--min-score 60] [--dry]
// 只装：ok、两边（文字评审 + 看图评审）都认可的动作占比 ≥ min-ratio（旧结果没有这项时用评审分 ≥ min-score）、现有镜头能换（motion-slots.mjs）。
// 没装的演示保留原来的画面（分镜阶段按演示清单放的自由动画画布，是兜底）。
// 装完跑 check-anchors、重建 props，写 projects/<id>/motion-report.md。
import { readFileSync, readdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadScene, installPlan, applyInstall } from "./motion-slots.mjs";
const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith("--"));
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const root = `projects/${id}`;
const dir = flag("--dir", `${root}/narration/motion`);
const minScore = +flag("--min-score", "60");
const minRatio = +flag("--min-ratio", "0.5");
const dry = argv.includes("--dry");
const demos = JSON.parse(readFileSync(`${root}/narration/demos.json`, "utf8"));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
const rows = []; // 审片报告：每个演示一行
const byScene = {};
for (const f of files) {
  const r = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const [scene] = f.split("-");
  const demo = (demos[scene] ?? []).find((d) => d.from === r.at);
  const key = `${scene}/${r.at}`;
  const row = { key, file: f, status: "", why: "", r };
  rows.push(row);
  if (!demo) { row.status = "跳过"; row.why = "demos.json 里找不到"; continue; }
  if (!r.ok || !r.motion) { row.status = "未装"; row.why = "生成没通过浏览器检查"; continue; }
  if (r.okBeats != null && r.beatCount) {
    if (r.okBeats / r.beatCount < minRatio) { row.status = "未装"; row.why = `两边都认可的动作 ${r.okBeats}/${r.beatCount}，低于 ${(minRatio * 100).toFixed(0)}%`; continue; }
  } else if ((r.score ?? 100) < minScore) { row.status = "未装"; row.why = `评审 ${r.score} 分 < ${minScore}`; continue; }
  (byScene[scene] ??= []).push({ f, r, demo, row });
}
let backupDir = null;
if (!dry) {
  const bk = `${root}/storyboards-before-motion-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`;
  if (!existsSync(bk)) cpSync(`${root}/storyboards`, bk, { recursive: true });
  backupDir = bk;
  console.log(`已备份分镜 → ${bk}`);
}
let n = 0;
for (const [scene, list] of Object.entries(byScene)) {
  let { board, ids } = loadScene(root, scene);
  list.sort((a, b) => ids.indexOf(a.demo.from) - ids.indexOf(b.demo.from));
  for (const { f, r, demo, row } of list) {
    const p = installPlan(board, ids, demo);
    if (!p.ok) { row.status = "未装"; row.why = p.reason; console.log(`✗ ${f}：${p.reason}`); continue; }
    board = applyInstall(board, ids, demo, r.motion);
    row.status = "已装"; row.why = `换掉 ${p.replaced.join(",") || "（无）"}`;
    n++;
    console.log(`✓ ${f}：${r.okBeats != null ? `认可 ${r.okBeats}/${r.beatCount}` : `评审 ${r.score ?? "-"}`}，换掉 ${p.replaced.join(",") || "（无）"}`);
  }
  if (!dry) writeFileSync(`${root}/storyboards/${scene}.json`, JSON.stringify(board, null, 2));
}
console.log(`${dry ? "（试运行，没写文件）" : "已写入"} ${n} 个动画`);

// ---- 审片报告（OpenMotion 审片规则：成立/需修改/未验证 + 证据；不用综合分数当合格线）----
const verdictCount = (r) => { const c = { 成立: 0, 需修改: 0, 未验证: 0 }; for (const b of r.review?.beats ?? []) c[b.verdict] = (c[b.verdict] ?? 0) + 1; return c; };
let md = `# 动画审片报告\n\n`;
md += `- 项目：${id}；生成：deepseek 系列写代码，文字评审与看图评审用本地网关里不同家的模型。\n`;
md += `- **未验证（没有任何模型或工具能验证）：动作是否顺滑、声音是否同步、实际播放效果。** 这些需要人或能看视频的工具来看。\n`;
md += `- 已装 ${rows.filter((x) => x.status === "已装").length} 个，未装 ${rows.filter((x) => x.status !== "已装").length} 个（未装的保留原来的画面）。\n\n`;
md += `| 演示 | 状态 | 成立/需修改/未验证 | 说明 |\n| --- | --- | --- | --- |\n`;
for (const x of rows.sort((a, b) => a.key.localeCompare(b.key))) {
  const c = verdictCount(x.r);
  md += `| ${x.key} | ${x.status} | ${x.r.review ? `${c.成立}/${c.需修改}/${c.未验证}` : "-"} | ${x.why} |\n`;
}
md += `\n## 仍未解决的问题（按演示）\n\n`;
for (const x of rows) {
  const bad = (x.r.review?.beats ?? []).filter((b) => b.verdict === "需修改");
  const probs = x.r.review?.problems ?? [];
  if (!bad.length && !probs.length) continue;
  md += `### ${x.key}（${x.status}）\n`;
  for (const b of bad) md += `- 动作「${b.at}」需修改：${[b.text?.verdict !== "ok" && b.text?.note, b.vision?.verdict === "需修改" && "[看图] " + b.vision.evidence].filter(Boolean).join(" ")}\n`;
  for (const p of probs.slice(0, 4)) md += `- 整体：${p}\n`;
  if (x.r.review?.sheet) md += `- 证据截图：${x.r.review.sheet}\n`;
  md += `\n`;
}
if (!dry) { writeFileSync(`${root}/motion-report.md`, md); console.log(`审片报告 → ${root}/motion-report.md`); }

// 装完之后的检查任何一项失败，都把分镜恢复备份并重建 props（以前锚点检查失败时直接退出，留下改了一半的分镜和旧 props）
function restoreAll(why) {
  console.log(`✗ ${why}：恢复备份分镜`);
  cpSync(backupDir, `${root}/storyboards`, { recursive: true });
  spawnSync("node", ["scripts/build-props.mjs", id], { encoding: "utf8" });
  console.log("已恢复备份分镜并重建 props");
  process.exit(1);
}
if (!dry && n) {
  const c = spawnSync("node", ["scripts/check-anchors.mjs", id], { encoding: "utf8" });
  console.log(c.stdout.trim().split("\n").slice(-3).join("\n"));
  if (c.status) restoreAll("锚点检查没通过");
  const v = spawnSync("node", ["scripts/validate-project.mjs", id], { encoding: "utf8" });
  if (v.status) { console.log(v.stdout.split("\n").filter((l) => /^   - /.test(l)).slice(0, 4).join("\n")); restoreAll("分镜校验没通过"); }
  const b = spawnSync("node", ["scripts/build-props.mjs", id], { encoding: "utf8" });
  console.log(b.status === 0 ? "props 已重建" : "build-props 失败：" + (b.stderr || b.stdout).slice(-300));
  if (b.status) restoreAll("build-props 没通过");
}
