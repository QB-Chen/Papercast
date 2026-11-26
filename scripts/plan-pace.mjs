// 给每句旁白定语速：难懂的概念、公式项放慢，过渡和玩笑略快，其余正常。
//   node scripts/plan-pace.mjs <arXiv 编号> [--model sensenova/glm-5.3]
// 输出 projects/<id>/narration/pace.json：{ "句id": "slow" | "normal" | "light" }
// 规则（程序保证，不全靠模型）：
//   1. 讲公式某一项的句子（含 plan.json 里该项 say 词的句子，每项取第一次出现的那句）一律 slow；
//   2. 其余由模型挑：首次出现的新概念、反直觉的结论、带数字的关键结果 → slow；过渡句、玩笑、重复回顾 → light；
//   3. slow 总数不超过全片的 40%，light 不超过 25%，超出就保留模型最有把握的（按模型给的先后顺序）。
import { readFileSync, writeFileSync } from "node:fs";
import { chatJson } from "./llm.mjs";

const args = process.argv.slice(2);
const id = args[0];
if (!id) throw new Error("用法：node scripts/plan-pace.mjs <arXiv 编号>");
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "sensenova/glm-5.3";
const root = `projects/${id}`;
const plan = JSON.parse(readFileSync(`${root}/plan.json`, "utf8").replace(/^\uFEFF/, ""));
const narr = JSON.parse(readFileSync(`${root}/narration.json`, "utf8"));

const pace = {};
const forced = new Set();
const modelJobs = [];
for (const sc of narr.scenes) {
  const fm = plan.scenes.find((x) => x.id === sc.id)?.formulas ?? [];
  let prev = -1;
  for (const f of fm)
    for (const p of f.parts) {
      const i = sc.sentences.findIndex((s, k) => k > prev && p.say.some((w) => s.text.toLowerCase().includes(String(w).toLowerCase())));
      if (i >= 0) {
        forced.add(sc.sentences[i].id);
        prev = i;
      }
    }
  for (const s of sc.sentences) pace[s.id] = forced.has(s.id) ? "slow" : "normal";
  modelJobs.push(sc);
}

const SYSTEM = `你是一位讲解视频的配音导演。我会给你一个场景的旁白稿（每句有 id），请你决定哪些句子要放慢、哪些可以略快。
放慢（slow）：听众第一次听到的新概念；反直觉的结论；需要边听边在脑子里算的句子；带关键数字的结果。
略快（light）：过渡句（"接下来""好，我们继续"）、玩笑和吐槽、对前面内容的简单回顾、提问的引子。
其余保持正常，不要写进结果。
已经被程序定为"必须放慢"的句子不用再列。
只输出 JSON：{"slow":["句id",…],"light":["句id",…]}，按你觉得最该放慢/最该加快的先后排序。`;

let done = 0;
const picked = { slow: [], light: [] };
await Promise.all(
  modelJobs.map(async (sc) => {
    const user = `场景 ${sc.id}\n${sc.sentences.map((s) => `${s.id}${forced.has(s.id) ? "（已定为放慢）" : ""} | ${s.text}`).join("\n")}`;
    const { obj } = await chatJson(model, [{ role: "system", content: SYSTEM }, { role: "user", content: user }], (o) => {
      const ids = new Set(sc.sentences.map((s) => s.id));
      const bad = [...(o?.slow ?? []), ...(o?.light ?? [])].filter((x) => !ids.has(x));
      return Array.isArray(o?.slow) && Array.isArray(o?.light) ? (bad.length ? [`不存在的句 id：${bad.join("、")}`] : []) : ['必须是 {"slow":[…],"light":[…]}'];
    }, { maxRounds: 3, temperature: 0.3, maxTokens: 36000, tag: `pace-${sc.id}`, timeoutMs: 600_000 });
    if (obj) {
      picked.slow.push(...obj.slow.filter((x) => !forced.has(x)).map((x) => [sc.id, x]));
      picked.light.push(...obj.light.filter((x) => !forced.has(x) && !obj.slow.includes(x)).map((x) => [sc.id, x]));
    }
    done++;
    console.log(`  ${sc.id} 完成（${done}/${modelJobs.length}）`);
  }),
);

const total = Object.keys(pace).length;
const maxSlow = Math.floor(total * 0.4);
const maxLight = Math.floor(total * 0.25);
let nSlow = forced.size;
for (const [, sid] of picked.slow) if (nSlow < maxSlow) {
  pace[sid] = "slow";
  nSlow++;
}
let nLight = 0;
for (const [, sid] of picked.light) if (nLight < maxLight && pace[sid] === "normal") {
  pace[sid] = "light";
  nLight++;
}
writeFileSync(`${root}/narration/pace.json`, JSON.stringify(pace, null, 2));
const cnt = (v) => Object.values(pace).filter((x) => x === v).length;
console.log(`语速已定：slow ${cnt("slow")}（其中公式项 ${forced.size}），normal ${cnt("normal")}，light ${cnt("light")} → ${root}/narration/pace.json`);
