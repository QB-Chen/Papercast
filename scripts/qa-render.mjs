// 渲染后画面质检：不用人盯。每个场景按句子抽帧渲染成静帧，交给能看图的本地网关模型找"观众一眼看得出来的毛病"，
// 写 projects/<id>/qa-report.json 和 qa-report.md。high 级毛病会让流水线自动重做对应镜头（见 paper2video 的 qa 阶段）。
//   node scripts/qa-render.mjs <arXiv 编号> [--model sensenova/kimi-k3] [--batch 6] [--concurrency 3] [--scene hook,out] [--frames-per-sentence 1]
// 抽帧：每句话开口后约 1.7 秒一帧（和联系图一致）；长句（>9 秒）在 70% 处再抽一帧。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { qaFrames } from "./frame-qa.mjs";

const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith("--"));
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
if (!id) { console.error("用法：node scripts/qa-render.mjs <arXiv 编号> [选项]"); process.exit(1); }
const root = `projects/${id}`;
const model = flag("--model", "sensenova/kimi-k3");
const batch = +flag("--batch", "6");
const conc = +flag("--concurrency", "3");
const only = flag("--scene", "") ? flag("--scene", "").split(",") : null;
// props 指纹：缓存的静帧只在 props.json 没变时复用。分镜一改、build-props 一重建，指纹就变，旧帧不会被误当成新画面
// （以前按帧号复用，qa-fix 修完之后的"复检"读到的是修之前的旧图）
import { createHash } from "node:crypto";
const propsHash = createHash("sha1").update(readFileSync(`${root}/props.json`)).digest("hex").slice(0, 10);
const outDir = `${root}/out/qa/${propsHash}`;
mkdirSync(outDir, { recursive: true });
process.env.PATH += ";E:\\Program Files\\ffmpeg\\bin";

const tl = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8"));
const plan = [];
for (const sc of tl.scenes) {
  if (only && !only.includes(sc.id)) continue;
  for (const s of sc.sentences) {
    const frames = [sc.start + s.local + 51];
    if (s.dur > 9 * 30) frames.push(sc.start + s.local + Math.round(s.dur * 0.7));
    for (const f of frames) plan.push({ scene: sc.id, sid: s.id, frame: Math.min(f, sc.start + s.local + s.dur - 2), caption: s.text });
  }
}
console.log(`共 ${plan.length} 帧，场景 ${[...new Set(plan.map((p) => p.scene))].join("、")}`);

// 1) 批量渲染静帧（一次打包、一个浏览器）
const frames = [...new Set(plan.map((p) => p.frame))];
const need = frames.filter((f) => !existsSync(`${outDir}/qa_${f}.png`));
if (need.length) {
  const r = spawnSync("node", ["scripts/stills.mjs", "--comp", "Paper", "--input-props", `${root}/props.json`, "--frames", need.join(","), "--prefix", "qa", "--out", outDir], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status) { console.error("静帧渲染失败：" + (r.stderr || r.stdout).slice(-400)); process.exit(2); }
}

// 2) 每场景连续 batch 张为一组，交给看图模型
const groups = [];
for (const sc of [...new Set(plan.map((p) => p.scene))]) {
  const items = plan.filter((p) => p.scene === sc);
  for (let i = 0; i < items.length; i += batch) groups.push({ scene: sc, items: items.slice(i, i + batch) });
}
const results = [];
let failedGroups = 0;
let next = 0;
async function worker() {
  while (next < groups.length) {
    const g = groups[next++];
    const images = g.items.map((p) => ({ path: `${outDir}/qa_${p.frame}.png`, caption: p.caption }));
    let r = await qaFrames({ model, images });
    if (r.error) r = await qaFrames({ model, images }); // 失败重试一次
    if (r.error) { failedGroups++; console.log(`  ${g.scene} ${g.items[0].sid}~${g.items.at(-1).sid}：质检没跑成（${r.error}）`); }
    for (const d of r.defects) { const p = g.items[d.frame - 1]; results.push({ scene: g.scene, sid: p.sid, frame: p.frame, type: d.type, severity: d.severity, what: d.what }); }
    results.sort((a, b) => a.frame - b.frame);
    console.log(`  ${g.scene} ${g.items[0].sid}~${g.items.at(-1).sid}：${r.error ? "未检查" : r.defects.length ? r.defects.map((d) => `${g.items[d.frame - 1].sid}:${d.type}/${d.severity}`).join(" ") : "没发现毛病"}`);
  }
}
await Promise.all(Array.from({ length: conc }, worker));

// 3) 报告：同一句同一类型的重复意见合并；high 的另列
const merged = [];
for (const d of results) {
  const same = merged.find((m) => m.scene === d.scene && m.sid === d.sid && m.type === d.type);
  if (same) { if (d.severity === "high") same.severity = "high"; same.count++; } else merged.push({ ...d, count: 1 });
}
// 只检查了部分场景时，把没检查的场景在旧报告里的结果并回来
const prevReport = only && existsSync(`${root}/qa-report.json`) ? JSON.parse(readFileSync(`${root}/qa-report.json`, "utf8")) : null;
if (prevReport) merged.unshift(...(prevReport.defects ?? []).filter((d) => !only.includes(d.scene)));
merged.sort((a, b) => a.frame - b.frame);
const high = merged.filter((d) => d.severity === "high");
writeFileSync(`${root}/qa-report.json`, JSON.stringify({ model, frames: plan.length, propsHash, groups: groups.length, failedGroups, defects: merged, high: high.length }, null, 2));
let md = `# 渲染后画面质检\n\n- 质检模型：${model}（只看静帧；**动作是否顺滑、声音是否同步、实际播放效果没有验证**）\n- 检查了 ${plan.length} 帧（${groups.length - failedGroups}/${groups.length} 组质检调用成功${failedGroups ? `，**${failedGroups} 组没跑成，这些帧没有被检查**` : ""}）；发现 ${merged.length} 处毛病，其中 **high（观众会看错或看不懂）${high.length} 处**。low 级只是提示，可能有误报。\n\n`;
for (const sev of ["high", "low"]) {
  const list = merged.filter((d) => d.severity === sev);
  if (!list.length) continue;
  md += `## ${sev === "high" ? "high" : "low"}\n\n| 场景 | 句子 | 类型 | 毛病 | 证据帧 |\n| --- | --- | --- | --- | --- |\n`;
  for (const d of list) md += `| ${d.scene} | ${d.sid} | ${d.type} | ${d.what.replace(/\|/g, "/")} | out/qa/${propsHash}/qa_${d.frame}.png |\n`;
  md += "\n";
}
writeFileSync(`${root}/qa-report.md`, md);
console.log(`质检完成：${merged.length} 处毛病，high ${high.length} 处 → ${root}/qa-report.md`);
// 退出码：0 = 全部检查完且没有 high；3 = 有 high；4 = 有质检调用没跑成（结果不完整，不能当"通过"）
process.exit(failedGroups > 0 ? 4 : high.length ? 3 : 0);
