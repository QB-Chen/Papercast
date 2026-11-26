// 演示级画面质检：对 demos.json 里的每个演示，从"最新渲染的静帧"里取 3 帧（段内 25%、55%、90%），
// 连同旁白和"这段该演什么"交给能看图的本地网关模型，判断有没有演出来。通用，不限场景、不限论文。
//   import { qaDemo, renderDemoFrames } from "./demo-qa.mjs"
//   node scripts/demo-qa.mjs <arXiv 编号> [--scene a,b] [--only scene/from,…] [--out demo-qa.json] [--concurrency 3]
// 帧是现渲染的（scripts/stills.mjs 按当前 props.json），不读旧缓存；输出目录带 props 指纹，分镜一改就不会读到旧图。
// 结论只用 成立 / 需修改 / 未验证；毛病类型固定，方便 auto-improve 按类型选修复动作：
//   blank_start 开头空白    empty 大片空白    static 几乎不动    half_acted 比喻只演了一半
//   too_small 太小          overlap 互相盖住   hidden 被字幕/边缘挡住    off_topic 和旁白无关    other
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chat } from "./llm.mjs";

export const DEMO_DEFECTS = ["blank_start", "empty", "static", "half_acted", "too_small", "overlap", "hidden", "off_topic", "other"];

const SYS = `你是视频审片员。你看到同一段演示动画在 3 个时刻（约 25%、55%、90% 处）的整屏截图（含上方的标题和公式、下方的字幕条；演示区是公式下面或画面中间那块带圆角的面板）。
给你这一段的旁白和"这段动画应该演出什么"，以及若干条【关键变化】。请只看演示区，**只核对这些关键变化有没有出现在对应的帧里**，细节缺失不算问题（"规划的细节"只是参考）。关键变化都出现了就判"成立"；有关键变化没出现，才判"需修改"并写清楚是哪一条。只根据图里看得见的内容判断，看不清就说看不清，不要猜。
三个结论之一：
- "成立"：能看到旁白讲的主体和变化，3 帧之间有可见的推进。
- "需修改"：必须列出具体问题。
- "未验证"：静帧里没法判断（比如要看动作是否顺滑），说明原因。
每个问题给一个类型（type 只能取这些）：
  blank_start：第 1 帧（25% 处）演示区是空的，动画出现得太晚
  empty：多数帧演示区大片空白
  static：3 帧几乎一样，没有推进
  half_acted：主体出现了，但旁白里的关键动作/变化/连接没有演出来（比如链条没拴在人身上、只有文字标签没有过程）
  too_small：关键的人或物小得看不清
  overlap：元素互相盖住或文字被图形盖住
  hidden：标签或元素被字幕条、面板边缘挡住或切掉
  off_topic：画面内容和旁白无关
  other：其他明显毛病
只输出 JSON：{"verdict":"成立|需修改|未验证","problems":[{"type":"类型","what":"具体指出是哪个元素、哪里不对"}],"evidence":"图里看到的内容（一两句）"}。成立时 problems 为空数组。`;

/** 这个演示的关键变化：优先用现行 motion 结果里导演写的 key（最关键、一句话），没有就回落到 demos.json 规划的画面事件 */
export function keysOf(root, scene, demo) {
  try {
    const f = `${root}/narration/motion/${scene}-${demo.from}.json`;
    if (existsSync(f)) { const r = JSON.parse(readFileSync(f, "utf8")); const ks = (r.plan?.beats ?? []).map((b) => b.key).filter(Boolean); if (ks.length) return { keys: ks, from: "导演的 key" }; }
  } catch {}
  return { keys: (demo.beats ?? []).map((b) => b.what), from: "规划事件" };
}

export function propsHash(root) {
  return createHash("sha1").update(readFileSync(`${root}/props.json`)).digest("hex").slice(0, 10);
}

/** 为一批演示渲染所需的静帧（按当前 props.json，输出到 out/dqa/<指纹>/）。返回 Map<key, {files, frames}> */
export function renderDemoFrames(id, items) {
  const root = `projects/${id}`;
  const tl = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8"));
  const dir = `${root}/out/dqa/${propsHash(root)}`;
  mkdirSync(dir, { recursive: true });
  const need = new Set(), per = new Map();
  for (const it of items) {
    const sc = tl.scenes.find((s) => s.id === it.scene);
    const a = sc.sentences.find((s) => s.id === it.demo.from), z = sc.sentences.find((s) => s.id === it.demo.to);
    const t0 = sc.start + a.local, t1 = sc.start + z.local + z.dur;
    const frames = [0.25, 0.55, 0.9].map((r) => Math.min(t1 - 3, Math.round(t0 + (t1 - t0) * r)));
    frames.forEach((f) => { if (!existsSync(`${dir}/dq_${f}.png`)) need.add(f); });
    per.set(`${it.scene}/${it.demo.from}`, { frames, files: frames.map((f) => `${dir}/dq_${f}.png`) });
  }
  if (need.size) {
    process.env.PATH += ";E:\\Program Files\\ffmpeg\\bin";
    const r = spawnSync("node", ["scripts/stills.mjs", "--comp", "Paper", "--input-props", `${root}/props.json`, "--frames", [...need].join(","), "--prefix", "dq", "--out", dir], { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status) throw new Error("静帧渲染失败：" + (r.stderr || r.stdout).slice(-300));
  }
  return per;
}

/** 对一个演示的 3 帧做检测。返回 { verdict, problems, evidence, error? } */
export async function qaDemo({ model = "sensenova/kimi-k3", demo, text, files, keys = null }) {
  const keyLine = keys?.keys?.length ? `【关键变化】（只核对这些）：\n${keys.keys.map((k, i) => `${i + 1}. ${k}`).join("\n")}\n规划的细节（仅参考）：${(demo.beats ?? []).map((b) => b.what).join("；") || "（无）"}` : `规划的画面事件：${(demo.beats ?? []).map((b) => b.what).join("；") || "（无）"}`;
  const content = [{ type: "text", text: `旁白：${text}\n这段应该演出：${demo.summary ?? "（无）"}\n${keyLine}\n截图按时间顺序 3 张。` }, ...files.map((f) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${readFileSync(f).toString("base64")}` } }))];
  for (let t = 0; t < 2; t++) {
    try {
      const c = await chat(model, [{ role: "system", content: SYS }, { role: "user", content }], { maxTokens: 30000, temperature: 0.1, tag: "demoqa", timeoutMs: 300000 });
      const o = JSON.parse(c.text.match(/\{[\s\S]*\}/)[0]);
      const problems = (o.problems ?? []).filter((p) => DEMO_DEFECTS.includes(p.type));
      const verdict = ["成立", "需修改", "未验证"].includes(o.verdict) ? o.verdict : "未验证";
      return { verdict: verdict === "成立" && problems.length >= 2 ? "需修改" : verdict, problems, evidence: o.evidence ?? "" };
    } catch { /* 重试 */ }
  }
  return { verdict: "未验证", problems: [], evidence: "看图调用没跑成", error: true };
}

/** 对一批演示做检测，返回 [{key, scene, demo, verdict, problems, evidence, files}] */
export async function qaDemos(id, items, { model, concurrency = 3, log = console.log, keyOverride = null } = {}) {
  const root = `projects/${id}`;
  const tl = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8"));
  const frames = renderDemoFrames(id, items);
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const k = next++, it = items[k], key = `${it.scene}/${it.demo.from}`;
      const sc = tl.scenes.find((s) => s.id === it.scene);
      const ids = sc.sentences.map((s) => s.id);
      const text = sc.sentences.slice(ids.indexOf(it.demo.from), ids.indexOf(it.demo.to) + 1).map((s) => s.text).join("");
      const r = await qaDemo({ model, demo: it.demo, text, files: frames.get(key).files, keys: keyOverride?.[key] ? { keys: keyOverride[key], from: "候选的 key" } : keysOf(root, it.scene, it.demo) });
      out[k] = { key, scene: it.scene, demo: it.demo, ...r, files: frames.get(key).files };
      log(`  ${key.padEnd(18)} ${r.verdict}${r.problems.length ? "：" + r.problems.map((p) => p.type).join("、") : ""}`);
    }
  }));
  return out;
}

// 命令行：对整个项目（或指定演示）做一次演示级质检，写 projects/<id>/demo-qa.json
if (process.argv[1]?.endsWith("demo-qa.mjs")) {
  const argv = process.argv.slice(2);
  const id = argv.find((a) => !a.startsWith("--"));
  const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
  if (!id) { console.error("用法：node scripts/demo-qa.mjs <arXiv 编号> [--scene a,b] [--only scene/from,…] [--concurrency 3]"); process.exit(1); }
  const demos = JSON.parse(readFileSync(`projects/${id}/narration/demos.json`, "utf8"));
  const scenes = flag("--scene", "") ? flag("--scene", "").split(",") : null;
  const only = flag("--only", "") ? flag("--only", "").split(",") : null;
  const items = [];
  for (const [scene, list] of Object.entries(demos)) for (const demo of list) {
    if (scenes && !scenes.includes(scene)) continue;
    if (only && !only.includes(`${scene}/${demo.from}`)) continue;
    items.push({ scene, demo });
  }
  console.log(`演示 ${items.length} 个`);
  const res = await qaDemos(id, items, { concurrency: +flag("--concurrency", "3") });
  const c = { 成立: 0, 需修改: 0, 未验证: 0 };
  res.forEach((r) => (c[r.verdict] = (c[r.verdict] ?? 0) + 1));
  writeFileSync(`projects/${id}/${flag("--out", "demo-qa.json")}`, JSON.stringify({ propsHash: propsHash(`projects/${id}`), counts: c, results: res.map(({ files, ...r }) => ({ ...r, demo: { from: r.demo.from, to: r.demo.to, kind: r.demo.kind, summary: r.demo.summary } })) }, null, 1));
  console.log(`\n成立 ${c.成立}，需修改 ${c.需修改}，未验证 ${c.未验证}`);
  process.exit(res.some((r) => r.error) ? 4 : c.需修改 ? 3 : 0);
}
