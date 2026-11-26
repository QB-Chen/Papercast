// 闭环：生成分镜 → 评审"演示有没有演到位" → 把缺口喂回去重做 → 再评审，最多 N 轮；每个场景保留得分最高的一版。
//   node scripts/improve-demos.mjs <arXiv 编号> [--rounds 3] [--dir llm-test/gen-all/<id>]
// 前提：narration/demos.json 已由 plan-demos 生成；dir 里已有一轮生成的分镜（没有的场景会先生成）。
// 结果：dir 里每个场景是评审得分最高的版本；最终评审写在 narration/demo-judge.json。
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const rounds = +flag("--rounds", "3");
const dir = flag("--dir", `llm-test/gen-all/${id}`);
const best = `${dir}-best`;
mkdirSync(best, { recursive: true });
const root = `projects/${id}`;
const run = (script, a) => spawnSync(process.execPath, [script, ...a], { encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
const plan = JSON.parse(readFileSync(`${root}/plan.json`, "utf8").replace(/^\uFEFF/, ""));
const scenes = plan.scenes.map((s) => s.id);
const judgeFile = `${root}/narration/demo-judge.json`;
const score = (j, sid) => {
  const l = j[sid] ?? [];
  return l.reduce((s, x) => s + (x.verdict === "ok" ? 1 : x.verdict === "weak" ? 0.3 : 0), 0) / Math.max(1, l.length);
};

const scores = {}; // 每个场景历史最好的分
for (let r = 0; r <= rounds; r++) {
  // 1) 补齐缺的分镜（第 0 轮用来生成缺的；后面几轮只重做被删掉的）
  const g = run("llm-test/gen-all-boards.mjs", [id]);
  console.log(`第 ${r} 轮 生成：${(g.stdout.match(/(\S+): 通过，\d+ 轮/g) ?? []).join("；") || "（没有需要生成的）"}`);
  // 2) 评审
  const j = run("scripts/judge-demos.mjs", [id, "--board-dir", dir]);
  const judged = JSON.parse(readFileSync(judgeFile, "utf8"));
  let allOk = true;
  for (const sid of scenes) {
    if (!existsSync(`${dir}/${sid}.json`)) { allOk = false; continue; }
    const sc = score(judged, sid);
    if (scores[sid] === undefined || sc >= scores[sid]) {
      // 这一版不比历史最好的差：存为最好版本
      scores[sid] = sc;
      copyFileSync(`${dir}/${sid}.json`, `${best}/${sid}.json`);
    } else {
      // 退步了：恢复历史最好的版本
      copyFileSync(`${best}/${sid}.json`, `${dir}/${sid}.json`);
    }
    const bad = (judged[sid] ?? []).filter((x) => x.verdict !== "ok").length;
    if (scores[sid] < 0.999) allOk = false;
    console.log(`  ${sid}：本版 ${(sc * 100).toFixed(0)} 分（${bad} 处没演到位），最好 ${(scores[sid] * 100).toFixed(0)} 分`);
  }
  const mean = scenes.reduce((s, sid) => s + (scores[sid] ?? 0), 0) / scenes.length;
  console.log(`第 ${r} 轮结束：全片平均 ${(mean * 100).toFixed(0)} 分`);
  if (allOk || r === rounds) break;
  // 3) 评审不满分的场景：删掉当前版本，下一轮让模型带着评审意见重做（评审结果已经写在 demo-judge.json，gen-storyboard 会读）
  //    注意：这里要用"最好版本的评审"作为意见。judged 是当前版本的评审；退步时恢复了旧版，旧版的评审意见略过时，但缺口大体相同。
  for (const sid of scenes) if (scores[sid] < 0.999 && existsSync(`${dir}/${sid}.json`)) rmSync(`${dir}/${sid}.json`);
}
// 最后用最好的版本整体再评审一次，写出最终的 demo-judge.json
const fin = run("scripts/judge-demos.mjs", [id, "--board-dir", dir]);
console.log((fin.stdout.match(/合计.*/) ?? [""])[0]);
