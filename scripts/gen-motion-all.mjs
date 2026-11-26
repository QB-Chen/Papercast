// 批量给 demos.json 里的演示生成 OpenMotion 式动画（每个演示一个子进程跑 gen-motion.mjs）
//   node scripts/gen-motion-all.mjs <arXiv 编号> [--kinds analogy,example,process] [--need-actors] [--only scene/from,…]
//        [--concurrency 3] [--limit 20] [--out projects/<id>/narration/motion] [--judge-rounds 1] [--list]
// 已经有 ok 结果的演示会跳过（失败的会重跑）。默认只选现有分镜里能直接换掉的演示（motion-slots.mjs），--all-slots 不过滤。
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { loadScene, installPlan } from "./motion-slots.mjs";
const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith("--"));
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);
if (!id) { console.error("用法：node scripts/gen-motion-all.mjs <arXiv 编号> [选项]"); process.exit(1); }
const outDir = flag("--out", `projects/${id}/narration/motion`);
const kinds = flag("--kinds", "analogy,example,process").split(",");
const conc = +flag("--concurrency", "3");
const limit = +flag("--limit", "999");
const only = flag("--only", "") ? flag("--only", "").split(",") : null;
const jr = flag("--judge-rounds", "1");
const model = flag("--model", "sensenova/deepseek-flash");
const judges = flag("--judge-models", "sensenova/glm-5.3");
const vision = flag("--vision-model", "sensenova/kimi-k3");
mkdirSync(`${outDir}/logs`, { recursive: true });

const demos = JSON.parse(readFileSync(`projects/${id}/narration/demos.json`, "utf8"));
let todo = [];
for (const [scene, list] of Object.entries(demos)) for (const d of list) {
  const key = `${scene}/${d.from}`;
  if (only) { if (!only.includes(key)) continue; }
  else { if (!kinds.includes(d.kind)) continue; if (has("--need-actors") && !d.actors?.length) continue; }
  if (!has("--all-slots")) { const { board, ids } = loadScene(`projects/${id}`, scene); if (!installPlan(board, ids, d).ok) continue; }
  todo.push({ scene, from: d.from, key, file: `${outDir}/${scene}-${d.from}.json` });
}
const done = (t) => { try { return existsSync(t.file) && JSON.parse(readFileSync(t.file, "utf8")).ok === true; } catch { return false; } };
const pending = todo.filter((t) => !done(t)).slice(0, limit);
console.log(`选中 ${todo.length} 个演示，已完成 ${todo.length - todo.filter((t) => !done(t)).length}，这次跑 ${pending.length} 个，并发 ${conc}`);
if (has("--list")) { for (const t of todo) console.log((done(t) ? "✓ " : "· ") + t.key); process.exit(0); }

let next = 0, running = 0, finished = 0;
const t0 = Date.now();
await new Promise((resolve) => {
  const launch = () => {
    while (running < conc && next < pending.length) {
      const t = pending[next++]; running++;
      const log = [];
      const p = spawn("node", ["scripts/gen-motion.mjs", id, t.scene, t.from, "--model", model, "--out", outDir, "--judge-models", judges, "--vision-model", vision, "--judge-rounds", jr], { stdio: ["ignore", "pipe", "pipe"] });
      p.stdout.on("data", (b) => log.push(b)); p.stderr.on("data", (b) => log.push(b));
      p.on("close", async (code) => {
        running--; finished++;
        const { writeFileSync } = await import("node:fs");
        writeFileSync(`${outDir}/logs/${t.scene}-${t.from}.log`, Buffer.concat(log));
        let st = "失败";
        try { const r = JSON.parse(readFileSync(t.file, "utf8")); st = r.ok ? `通过 两边都认可 ${r.okBeats ?? "-"}/${r.beatCount ?? "-"} 个动作` : "未通过"; } catch {}
        console.log(`[${finished}/${pending.length}] ${t.key} ${st}（退出码 ${code}，已用 ${((Date.now() - t0) / 60000).toFixed(0)} 分钟）`);
        if (finished === pending.length) resolve(); else launch();
      });
    }
  };
  if (!pending.length) resolve(); else launch();
});
console.log("批量结束");
