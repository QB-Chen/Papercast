// 按画面质检报告（qa-report.json）里的 high 级毛病，自动重做有毛病的"演示"：
//   毛病所在的句子 → 找到 demos.json 里覆盖它的演示 → 用 gen-motion 重新生成这一个演示（质检意见作为 --notes 告诉导演和动画师）
//   → 评审（文字 + 看图）→ 装进分镜 → 校验 → 重新质检这个场景 → 如果 high 毛病没有变少，就恢复原分镜。不需要人。
// 只重做一个演示、不重做整张分镜：整张分镜一重做，场景里所有动画都要重新写，实测过不了校验。
// 没有对应演示的毛病（公式被画面边缘裁掉、空白面板没内容等）不乱动，留在 qa-report.md 里。
//   node scripts/qa-fix.mjs <arXiv 编号> [--max-demos 8] [--model sensenova/deepseek-flash]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadScene, installPlan, applyInstall } from "./motion-slots.mjs";
import { demoContext } from "./motion-ctx.mjs";
import { reviewMotion, reviewRank } from "./motion-review.mjs";

const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith("--"));
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
if (!id) { console.error("用法：node scripts/qa-fix.mjs <arXiv 编号>"); process.exit(1); }
const root = `projects/${id}`;
const maxDemos = +flag("--max-demos", "8");
const model = flag("--model", "sensenova/deepseek-flash");
const run = (script, a) => spawnSync("node", [`scripts/${script}`, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const readRep = () => JSON.parse(readFileSync(`${root}/qa-report.json`, "utf8"));
const demos = JSON.parse(readFileSync(`${root}/narration/demos.json`, "utf8"));

const rep0 = readRep();
const high = (rep0.defects ?? []).filter((d) => d.severity === "high");
if (!high.length) { console.log("没有 high 级毛病，不需要修"); process.exit(0); }

// 毛病 → 演示
const byDemo = new Map();
const unfixable = [];
for (const d of high) {
  const { ids } = loadScene(root, d.scene);
  const i = ids.indexOf(d.sid);
  const demo = (demos[d.scene] ?? []).find((x) => ids.indexOf(x.from) <= i && i <= ids.indexOf(x.to));
  if (!demo) { unfixable.push(d); continue; }
  const key = `${d.scene}/${demo.from}`;
  if (!byDemo.has(key)) byDemo.set(key, { scene: d.scene, demo, defects: [] });
  byDemo.get(key).defects.push(d);
}
console.log(`high ${high.length} 处：能对应到演示的 ${[...byDemo.values()].reduce((s, x) => s + x.defects.length, 0)} 处（${byDemo.size} 个演示），没有对应演示的 ${unfixable.length} 处（只写进报告）`);

const bkDir = `${root}/storyboards-qa-backup`;
mkdirSync(bkDir, { recursive: true });
const summary = [];
let n = 0;
for (const [key, { scene, demo, defects }] of byDemo) {
  if (n++ >= maxDemos) { summary.push({ key, result: "超过本轮上限，没处理" }); continue; }
  const { board, ids } = loadScene(root, scene);
  const plan = installPlan(board, ids, demo);
  if (!plan.ok) { summary.push({ key, result: "不能换", why: plan.reason }); console.log(`${key}：不能换（${plan.reason}）`); continue; }
  const notes = defects.map((d, i) => `${i + 1}. 句子 ${d.sid}：[${d.type}] ${d.what}`).join("\n");
  console.log(`\n== ${key}：${defects.length} 处 high，重新生成动画`);
  const outDir = `${root}/narration/motion-qafix`;
  mkdirSync(outDir, { recursive: true });
  const file0 = `${outDir}/${scene}-${demo.from}.json`;
  rmSync(file0, { force: true }); // 删掉上次遗留的候选文件：生成失败时不能把旧候选当成这次的结果装进去
  const g = run("gen-motion.mjs", [id, scene, demo.from, "--model", model, "--out", outDir, "--judge-rounds", "0", "--notes", notes]);
  const file = file0;
  let cand = null;
  if (g.status) { summary.push({ key, result: "没改", why: `gen-motion 退出码 ${g.status}` }); console.log(`  → gen-motion 失败（退出码 ${g.status}），保留原动画`); continue; }
  try { cand = JSON.parse(readFileSync(file, "utf8")); } catch {}
  if (!cand?.ok || !cand.motion) { summary.push({ key, result: "没改", why: "重新生成没通过浏览器检查" }); console.log("  → 重新生成没通过浏览器检查，保留原动画"); continue; }
  // 评审新版本，并和现有版本比较（现有版本如果没评审过就先评审）
  const ctx = demoContext(id, scene, demo.from);
  const curFile = `${root}/narration/motion/${scene}-${demo.from}.json`;
  const cur = existsSync(curFile) ? JSON.parse(readFileSync(curFile, "utf8")) : null;
  const rvNew = await reviewMotion({ id, sceneId: scene, ctx, plan: cand.plan, motion: cand.motion, tag: "qafix" });
  const rvCur = cur?.review?.hasVision ? cur.review : cur?.motion ? await reviewMotion({ id, sceneId: scene, ctx, plan: cur.plan, motion: cur.motion, tag: "qacur" }) : null;
  console.log(`  评审：新版 ${rvNew.okBeats}/${rvNew.beatCount}；旧版 ${rvCur ? rvCur.okBeats + "/" + rvCur.beatCount : "无（原来不是 motion 动画）"}`);
  if (rvNew.okBeats === 0) { summary.push({ key, result: "没改", why: "新版评审里没有任何一个动作成立" }); console.log("  → 新版评审里没有任何动作成立，保留原画面"); continue; }
  if (rvCur && reviewRank(rvNew) < reviewRank(rvCur)) { summary.push({ key, result: "没改", why: "新版评审不如旧版" }); console.log("  → 新版评审不如旧版，保留旧版"); continue; }
  // 装进分镜（备份 → 安装 → 校验 → 重新质检这个场景）
  const bk = `${bkDir}/${scene}.${Date.now()}.json`;
  copyFileSync(`${root}/storyboards/${scene}.json`, bk);
  const nb = applyInstall(board, ids, demo, cand.motion);
  writeFileSync(`${root}/storyboards/${scene}.json`, JSON.stringify(nb, null, 2));
  const restore = (why) => { copyFileSync(bk, `${root}/storyboards/${scene}.json`); run("build-props.mjs", [id]); summary.push({ key, result: "恢复原分镜", why }); console.log(`  → 已恢复原分镜：${why}`); };
  const checks = [["check-anchors.mjs", "锚点检查"], ["validate-project.mjs", "分镜校验"], ["build-props.mjs", "build-props"]];
  let bad = null;
  for (const [s, name] of checks) { const r = run(s, [id]); if (r.status) { bad = name + "没通过"; break; } }
  if (bad) { restore(bad); continue; }
  const nBefore = (readRep().defects ?? []).filter((d) => d.scene === scene && d.severity === "high").length;
  const q = run("qa-render.mjs", [id, "--scene", scene]);
  if (![0, 3].includes(q.status)) { restore("重新质检没跑成"); continue; }
  const nAfter = (readRep().defects ?? []).filter((d) => d.scene === scene && d.severity === "high").length;
  if (nAfter >= nBefore) {
    // 报告里这个场景换回旧结果
    const r1 = readRep();
    r1.defects = [...r1.defects.filter((d) => d.scene !== scene), ...rep0.defects.filter((d) => d.scene === scene)];
    writeFileSync(`${root}/qa-report.json`, JSON.stringify(r1, null, 2));
    restore(`重做后 ${scene} 的 high 从 ${nBefore} 变成 ${nAfter}，没有变少`);
    continue;
  }
  // 保存为现行版本，同时写入评审明细
  writeFileSync(curFile, JSON.stringify({ ...cand, ok: true, review: rvNew, okBeats: rvNew.okBeats, beatCount: rvNew.beatCount, score: rvNew.textScore, unverified: ["动作是否顺滑", "声音是否同步", "实际播放"] }, null, 2));
  summary.push({ key, result: "已重做", before: nBefore, after: nAfter });
  console.log(`  → 保留新版：${scene} 的 high ${nBefore} → ${nAfter}`);
}
writeFileSync(`${root}/qa-fix-summary.json`, JSON.stringify({ summary, unfixable }, null, 2));
console.log("\n" + summary.map((s) => `${s.key}：${s.result}${s.after !== undefined ? `（high ${s.before} → ${s.after}）` : s.why ? `（${s.why}）` : ""}`).join("\n"));
if (unfixable.length) console.log(`\n没有对应演示、没动的 ${unfixable.length} 处：\n` + unfixable.map((d) => `  ${d.scene}/${d.sid} [${d.type}] ${d.what.slice(0, 70)}`).join("\n"));
