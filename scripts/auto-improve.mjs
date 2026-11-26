// 自动改进循环：发现（演示级看图质检）→ 修复（按毛病类型重做这一个演示）→ 复测（用新渲染的帧）→ 保留或回退。不需要人。
//   node scripts/auto-improve.mjs <arXiv 编号> [--rounds 2] [--max-per-round 8] [--only scene/from,…] [--scene a,b]
//        [--model sensenova/deepseek-flash] [--qa-model sensenova/kimi-k3] [--dry]
// 任何论文、任何场景都走同一套：演示清单来自 demos.json，舞台尺寸（整块 520 / 公式下方 300）由演示所在位置决定，
// 安装方式（替换镜头 / 写进 eqx 的 insets）由 motion-slots.mjs 决定。每个演示的改动都是"先备份分镜，装，校验，重新渲染这几帧复测"，
// 没有变好就把这一个演示恢复。全程只用本地网关里允许的模型。
// 退出码：0 = 没有需修改的演示 / 全部变好；3 = 仍有需修改（见报告）；4 = 质检调用没跑成（结果不完整）
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { loadScene, installPlan, applyInstall } from "./motion-slots.mjs";
import { demoContext } from "./motion-ctx.mjs";
import { reviewMotion, reviewRank } from "./motion-review.mjs";
import { qaDemos } from "./demo-qa.mjs";

const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith("--"));
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
if (!id) { console.error("用法：node scripts/auto-improve.mjs <arXiv 编号> [选项]"); process.exit(1); }
const root = `projects/${id}`;
const rounds = +flag("--rounds", "2");
const perRound = +flag("--max-per-round", "8");
const genModel = flag("--model", "sensenova/deepseek-flash");
const qaModel = flag("--qa-model", "sensenova/kimi-k3");
const scenes = flag("--scene", "") ? flag("--scene", "").split(",") : null;
const only = flag("--only", "") ? flag("--only", "").split(",") : null;
const dry = argv.includes("--dry");
const run = (script, a) => spawnSync("node", [`scripts/${script}`, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const demosAll = JSON.parse(readFileSync(`${root}/narration/demos.json`, "utf8"));
const items = [];
for (const [scene, list] of Object.entries(demosAll)) for (const demo of list) {
  if (scenes && !scenes.includes(scene)) continue;
  if (only && !only.includes(`${scene}/${demo.from}`)) continue;
  items.push({ scene, demo });
}
const keyOf = (it) => `${it.scene}/${it.demo.from}`;
const bkDir = `${root}/storyboards-auto-backup`;
mkdirSync(bkDir, { recursive: true });
mkdirSync(`${root}/narration/motion-auto`, { recursive: true });
const history = []; // 每个演示每一轮发生了什么，写进报告

// 把毛病类型翻译成给导演/动画师的具体要求（通用，不绑论文）
const FIX_HINT = {
  blank_start: "动画出现得太晚：这段旁白一开口 0.5 秒内就要有可见的主体出现（人物或关键物件先站好），不要让演示区空着等后面的词。",
  empty: "演示区大片空白：把人物和关键物件放大、铺满演示区，不要只放几个小图标。",
  static: "几乎不动：每句旁白里的动作都要对应一个可见的运动（移动、变大变小、数量变化、表情变化），不要只出现不动。",
  half_acted: "比喻/机制只演了一半：旁白里说到的每个连接、动作、变化都要画出来（比如拴着就要画出连接线、从加减变成乘除就要演出变形的过程），不能只放一个文字标签或孤立的图标。",
  too_small: "关键的人或物太小：放大到演示区的主体尺寸（人物宽 120~150px 时脚下留出标签位置，关键物件 ≥ 90px）。",
  overlap: "元素互相盖住：重新安排位置，一个时刻只让一两个主体占据同一区域，用淡出/移走给后来的元素让位。",
  hidden: "标签或元素被边缘/字幕条挡住：所有人物、标签整个放在演示区里，离底边至少 40px。",
  off_topic: "画面和旁白无关：严格按旁白里每个动作的原话安排画面，不要放无关的装饰。",
  other: "按检测意见修正。",
};
const notesFor = (res) => res.problems.map((p, i) => `${i + 1}. [${p.type}] ${p.what}。要求：${FIX_HINT[p.type] ?? FIX_HINT.other}`).join("\n");

console.log(`项目 ${id}：${items.length} 个演示；最多 ${rounds} 轮，每轮最多处理 ${perRound} 个`);
let latest = await qaDemos(id, items, { model: qaModel });
if (latest.some((r) => r.error)) { console.log("⚠ 有演示的质检调用没跑成，结果不完整"); }
const initialBad = latest.filter((r) => r.verdict === "需修改").length;
console.log(`\n起始检测：成立 ${latest.filter((r) => r.verdict === "成立").length}，需修改 ${initialBad}，未验证 ${latest.filter((r) => r.verdict === "未验证").length}`);
if (dry) { writeFileSync(`${root}/auto-improve-report.json`, JSON.stringify({ dry: true, latest: latest.map(({ files, ...r }) => r) }, null, 1)); process.exit(initialBad ? 3 : 0); }

const giveUp = new Set(); // 已经试过没改善的演示，不再重复尝试
const conc = +flag("--concurrency", "3");
// 异步子进程（spawnSync 会卡住事件循环，并行就是假的）
const runAsync = (script, a) => new Promise((resolve) => { const p = spawn("node", [`scripts/${script}`, ...a], { stdio: ["ignore", "pipe", "pipe"] }); const out = []; p.stdout.on("data", (d) => out.push(d)); p.stderr.on("data", (d) => out.push(d)); p.on("close", (code) => resolve({ status: code, output: Buffer.concat(out).toString() })); });
// 互斥锁：装进分镜、校验、重建 props、复测这一段要独占（会改分镜和 props，复测读的是当时的 props）。生成和评审不用锁，可以并行
let lockTail = Promise.resolve();
const withLock = (fn) => { const p = lockTail.then(fn, fn); lockTail = p.catch(() => {}); return p; };

async function processOne(cur, round) {
  const { scene, demo } = cur;
  const key = cur.key;
  const rec = { round, key, before: cur.problems.map((p) => p.type) };
  history.push(rec);
  {
    const { board, ids } = loadScene(root, scene);
    const plan = installPlan(board, ids, demo);
    if (!plan.ok) { rec.result = "不能换"; rec.why = plan.reason; giveUp.add(key); console.log(`${key}：不能换（${plan.reason}）`); return; }
  }
  console.log(`\n${key}：${cur.problems.map((p) => p.type).join("、")}`);
  // 1) 重新生成（并行）
  const f0 = `${root}/narration/motion-auto/${scene}-${demo.from}.json`;
  rmSync(f0, { force: true });
  const g = await runAsync("gen-motion.mjs", [id, scene, demo.from, "--model", genModel, "--out", `${root}/narration/motion-auto`, "--judge-rounds", "0", "--notes", notesFor(cur)]);
  let cand = null; try { cand = JSON.parse(readFileSync(f0, "utf8")); } catch {}
  if (g.status || !cand?.ok || !cand.motion) { rec.result = "没改"; rec.why = "重新生成没通过浏览器检查"; console.log(`  ${key} → 重新生成没通过浏览器检查，保留原画面`); return; }
  // 2) 评审新版本（文字 + 看图，并行），至少一个动作成立
  const ctx = demoContext(id, scene, demo.from);
  const rv = await reviewMotion({ id, sceneId: scene, ctx, plan: cand.plan, motion: cand.motion, tag: "auto-" + key.replace("/", "-") });
  rec.reviewOk = `${rv.okBeats}/${rv.beatCount}`;
  if (rv.okBeats === 0) { rec.result = "没改"; rec.why = "新版评审里没有任何动作成立"; console.log(`  ${key} → 新版评审里没有任何动作成立，保留原画面`); return; }
  const candKeys = (cand.plan?.beats ?? []).map((b) => b.key).filter(Boolean);
  // 3) 以下独占：重新读分镜 → 基线（同一份 key）→ 装入 → 校验 → 复测 → 保留或恢复
  await withLock(async () => {
    const { board, ids } = loadScene(root, scene); // 别的 worker 可能刚改过同一个场景，必须现读
    const plan = installPlan(board, ids, demo);
    if (!plan.ok) { rec.result = "不能换"; rec.why = plan.reason; giveUp.add(key); console.log(`  ${key} → 不能换（${plan.reason}）`); return; }
    let baseline = cur;
    if (candKeys.length) {
      const [bl] = await qaDemos(id, [{ scene, demo }], { model: qaModel, log: () => {}, keyOverride: { [key]: candKeys } });
      if (!bl.error) baseline = { ...cur, verdict: bl.verdict, problems: bl.problems };
      rec.baselineSameKey = bl.verdict + (bl.problems.length ? "：" + bl.problems.map((p) => p.type).join("、") : "");
    }
    const bk = `${bkDir}/${scene}.${Date.now()}.json`;
    copyFileSync(`${root}/storyboards/${scene}.json`, bk);
    writeFileSync(`${root}/storyboards/${scene}.json`, JSON.stringify(applyInstall(board, ids, demo, cand.motion), null, 2));
    const restore = (why) => { copyFileSync(bk, `${root}/storyboards/${scene}.json`); run("build-props.mjs", [id]); rec.result = "恢复原画面"; rec.why = why; giveUp.add(key); console.log(`  ${key} → 已恢复原画面：${why}`); };
    let bad1 = null;
    for (const [sc2, name, args] of [["check-anchors.mjs", "锚点检查", [id]], ["validate-project.mjs", "分镜校验", [id, "--scene", scene]], ["build-props.mjs", "build-props", [id]]]) { const r = run(sc2, args); if (r.status) { bad1 = name + "没通过"; break; } }
    if (bad1) { restore(bad1); return; }
    const [after] = await qaDemos(id, [{ scene, demo }], { model: qaModel, log: () => {}, keyOverride: candKeys.length ? { [key]: candKeys } : null });
    const score = (r) => (r.verdict === "成立" ? 0 : r.verdict === "未验证" ? 5 : 10) + r.problems.length;
    rec.after = after.verdict + (after.problems.length ? "：" + after.problems.map((p) => p.type).join("、") : "");
    rec.compare = `同一份 key：修之前 ${rec.baselineSameKey ?? "-"} → 修之后 ${rec.after}`;
    if (after.error || score(after) >= score(baseline)) { restore(`复测没有变好（${rec.compare}）`); return; }
    mkdirSync(`${root}/narration/motion`, { recursive: true });
    writeFileSync(`${root}/narration/motion/${scene}-${demo.from}.json`, JSON.stringify({ ...cand, ok: true, review: rv, okBeats: rv.okBeats, beatCount: rv.beatCount, score: rv.textScore, unverified: ["动作是否顺滑", "声音是否同步", "实际播放"] }, null, 2));
    Object.assign(cur, { verdict: after.verdict, problems: after.problems, evidence: after.evidence });
    rec.result = "已改善"; console.log(`  ${key} → 保留新版：复测 ${rec.after}`);
  });
}

for (let round = 1; round <= rounds; round++) {
  const bad = latest.filter((r) => r.verdict === "需修改" && !giveUp.has(r.key));
  if (!bad.length) { console.log(`\n第 ${round} 轮：没有可处理的需修改演示，结束`); break; }
  const batch = bad.slice(0, perRound);
  console.log(`\n=== 第 ${round} 轮：处理 ${batch.length} 个（共 ${bad.length} 个需修改），生成和评审 ${conc} 路并行，装入和复测串行 ===`);
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (next < batch.length) { const cur = batch[next++]; try { await processOne(cur, round); } catch (e) { console.log(`  ${cur.key} 出错：${String(e).slice(0, 120)}`); } } }));
}

// 报告
const fin = latest;
const c = { 成立: 0, 需修改: 0, 未验证: 0 };
fin.forEach((r) => (c[r.verdict] = (c[r.verdict] ?? 0) + 1));
const report = { propsHash: null, start: { bad: initialBad }, end: c, history, remaining: fin.filter((r) => r.verdict === "需修改").map((r) => ({ key: r.key, problems: r.problems, evidence: r.evidence })) };
writeFileSync(`${root}/auto-improve-report.json`, JSON.stringify(report, null, 1));
let md = `# 自动改进报告\n\n- 起始：需修改 ${initialBad} 个；结束：成立 ${c.成立}，需修改 ${c.需修改}，未验证 ${c.未验证}\n- 检测与复测都是 AI 看静帧的判断（${qaModel}），**动作是否顺滑、声音是否同步没有验证**\n\n## 处理记录\n\n| 演示 | 轮 | 修之前的毛病 | 结果 | 说明 |\n| --- | --- | --- | --- | --- |\n`;
for (const h of history) md += `| ${h.key} | ${h.round} | ${h.before.join("、")} | ${h.result ?? "-"} | ${h.why ?? h.after ?? ""} |\n`;
md += `\n## 仍需修改（需要人看或改渲染器）\n\n`;
for (const r of report.remaining) md += `- **${r.key}**：${r.problems.map((p) => `[${p.type}] ${p.what}`).join("；")}\n`;
writeFileSync(`${root}/auto-improve-report.md`, md);
console.log(`\n结束：成立 ${c.成立}，需修改 ${c.需修改}，未验证 ${c.未验证} → ${root}/auto-improve-report.md`);
process.exit(latest.some((r) => r.error) ? 4 : c.需修改 ? 3 : 0);
