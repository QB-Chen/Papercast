// 每个演示生成多个候选，按评审（文字 + 看图）选最好的一个。已有版本也作为候选参加比较。
//   node scripts/gen-motion-best.mjs <arXiv 编号> [--candidates 3] [--target 0.6] [--concurrency 2] [--only scene/from,…]
//        [--kinds analogy,example,process] [--model sensenova/deepseek-flash] [--judge-models sensenova/glm-5.3] [--vision-model sensenova/kimi-k3]
//        [--out projects/<id>/narration/motion] [--list]
// 为什么不再"评审后喂回去重写"：实测反复重写不收敛（0/6→1/6→1/6，文字分 68→58→48），多生成几个挑最好的更稳。
// 一个演示的流程：已有版本若没评审过先评审；成立动作占比 ≥ target 就不动；否则生成 N 个新候选（各自过浏览器检查），
// 全部评审后选最好的，写回 <out>/<scene>-<from>.json（含 review 明细和所有候选的成绩）。
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { loadScene, installPlan } from "./motion-slots.mjs";
import { demoContext } from "./motion-ctx.mjs";
import { reviewMotion, reviewRank } from "./motion-review.mjs";

const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith("--"));
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);
const fresh = argv.includes("--fresh"); // 全部用新素材重做（画风统一）；新版本全失败才保留旧版本
if (!id) { console.error("用法：node scripts/gen-motion-best.mjs <arXiv 编号> [选项]"); process.exit(1); }
const outDir = flag("--out", `projects/${id}/narration/motion`);
const N = +flag("--candidates", "3");
const target = +flag("--target", "0.6");
const conc = +flag("--concurrency", "2");
const kinds = flag("--kinds", "analogy,example,process").split(",");
const only = flag("--only", "") ? flag("--only", "").split(",") : null;
const model = flag("--model", "sensenova/deepseek-flash");
const textModels = flag("--judge-models", "sensenova/glm-5.3").split(",");
const visionModel = flag("--vision-model", "sensenova/kimi-k3");
mkdirSync(`${outDir}/logs`, { recursive: true });

const demos = JSON.parse(readFileSync(`projects/${id}/narration/demos.json`, "utf8"));
const todo = [];
for (const [scene, list] of Object.entries(demos)) for (const d of list) {
  const key = `${scene}/${d.from}`;
  if (only) { if (!only.includes(key)) continue; }
  else {
    if (!kinds.includes(d.kind)) continue;
    const { board, ids } = loadScene(`projects/${id}`, scene);
    if (!installPlan(board, ids, d).ok) continue;
  }
  todo.push({ scene, from: d.from, key, file: `${outDir}/${scene}-${d.from}.json` });
}
console.log(`选中 ${todo.length} 个演示，每个最多 ${N} 个新候选，目标：成立动作 ≥ ${(target * 100).toFixed(0)}%，并发 ${conc}`);
if (has("--list")) { todo.forEach((t) => console.log("· " + t.key)); process.exit(0); }

const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const ratio = (r) => (r?.review?.beatCount ? r.review.okBeats / r.review.beatCount : r?.okBeats != null && r?.beatCount ? r.okBeats / r.beatCount : null);
function genOne(t, k) {
  const dir = `${outDir}/cand/${t.scene}-${t.from}-${k}`;
  rmSync(dir, { recursive: true, force: true });
  return new Promise((resolve) => {
    const log = [];
    const p = spawn("node", ["scripts/gen-motion.mjs", id, t.scene, t.from, "--model", model, "--out", dir, "--judge-rounds", "0"], { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (b) => log.push(b)); p.stderr.on("data", (b) => log.push(b));
    p.on("close", () => {
      writeFileSync(`${outDir}/logs/${t.scene}-${t.from}-c${k}.log`, Buffer.concat(log));
      const r = readJson(`${dir}/${t.scene}-${t.from}.json`);
      resolve(r?.ok && r.motion ? r : null);
    });
  });
}

async function doOne(t) {
  const ctx = demoContext(id, t.scene, t.from);
  const cands = []; // { name, r（结果 json）, review }
  const existing = readJson(t.file);
  if (!fresh && existing?.ok && existing.motion) {
    let rv = existing.review?.hasVision ? existing.review : null;
    if (!rv) rv = await reviewMotion({ id, sceneId: t.scene, ctx, plan: existing.plan, motion: existing.motion, textModels, visionModel, tag: "ex" });
    cands.push({ name: "已有版本", r: existing, review: rv });
    const q = ratio({ review: rv });
    console.log(`  ${t.key} 已有版本：成立 ${rv.okBeats}/${rv.beatCount}`);
    if (q !== null && q >= target) return finish(t, ctx, cands, "已达标，没重新生成");
  }
  console.log(`  ${t.key} 生成 ${N} 个候选…`);
  const gens = await Promise.all(Array.from({ length: N }, (_, k) => genOne(t, k + 1)));
  const okGens = gens.map((r, k) => ({ r, k })).filter((x) => x.r);
  console.log(`  ${t.key} 候选通过浏览器检查 ${okGens.length}/${N}`);
  const reviewed = await Promise.all(okGens.map(async ({ r, k }) => ({ name: `候选${k + 1}`, r, review: await reviewMotion({ id, sceneId: t.scene, ctx, plan: r.plan, motion: r.motion, textModels, visionModel, tag: `c${k + 1}` }) })));
  cands.push(...reviewed);
  if (fresh && !reviewed.length) return { key: t.key, status: "新版本都没通过浏览器检查，保留旧版本" };
  return finish(t, ctx, cands);
}

function finish(t, ctx, cands, note = "") {
  if (!cands.length) return { key: t.key, status: "没有可用版本" };
  const usable = cands.filter((c) => !c.review.browserErrs);
  if (!usable.length) return { key: t.key, status: "没有可用版本" };
  const best = usable.reduce((a, b) => (reviewRank(b.review) > reviewRank(a.review) ? b : a));
  const rv = best.review;
  const out = {
    ...best.r, ok: true, review: rv, okBeats: rv.okBeats, beatCount: rv.beatCount, score: rv.textScore,
    unverified: ["动作是否顺滑", "声音是否同步", "实际播放"],
    candidates: cands.map((c) => ({ name: c.name, okBeats: c.review.okBeats, beatCount: c.review.beatCount, textScore: c.review.textScore, picked: c === best })),
  };
  writeFileSync(t.file, JSON.stringify(out, null, 2));
  return { key: t.key, status: `选 ${best.name}：成立 ${rv.okBeats}/${rv.beatCount}（候选 ${cands.map((c) => `${c.name} ${c.review.okBeats}/${c.review.beatCount}`).join("，")}）${note ? "；" + note : ""}` };
}

let next = 0, finished = 0;
const t0 = Date.now();
async function worker() {
  while (next < todo.length) {
    const t = todo[next++];
    let res;
    try { res = await doOne(t); } catch (e) { res = { key: t.key, status: "出错：" + String(e).slice(0, 120) }; }
    finished++;
    console.log(`[${finished}/${todo.length}] ${res.key} ${res.status}（已用 ${((Date.now() - t0) / 60000).toFixed(0)} 分钟）`);
  }
}
await Promise.all(Array.from({ length: conc }, worker));
const all = todo.map((t) => readJson(t.file)).filter((r) => r?.review);
const tot = all.reduce((s, r) => s + r.review.beatCount, 0), good = all.reduce((s, r) => s + r.review.okBeats, 0);
console.log(`批量结束：${all.length} 个演示，${tot} 个动作，成立 ${good}（${tot ? ((good / tot) * 100).toFixed(0) : 0}%）；达标（≥${(target * 100).toFixed(0)}%）的演示 ${all.filter((r) => r.review.okBeats / r.review.beatCount >= target).length} 个`);
