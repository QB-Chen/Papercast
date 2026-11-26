// 给公式的每一项配一个"角色演员"：讲到这一项时，下方出现一个小人物（带表情或道具），把"为什么"演出来，而不是只有一行字。
//   node scripts/plan-actors.mjs <arXiv 编号> [--model sensenova/kimi-k3]
// 读 plan.json 里每条公式每一项的 name / role / why（why 里通常有一个比喻），选：
//   look：角色（src/story/chars.json 里的 id），要和 why 里的比喻对上（老师批改→teacher，厨师试吃→cook，裁判打分→judge，用力→person-lifting-weights……）
//   mood / prop：可选，头上的表情或手边的道具（public/stickers/ 里的贴图名）
// 结果写回 plan.json：formulas[].parts[].actor = { look, mood?, prop? }
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { chatJson } from "./llm.mjs";

const args = process.argv.slice(2);
const id = args[0];
if (!id) throw new Error("用法：node scripts/plan-actors.mjs <arXiv 编号>");
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "sensenova/kimi-k3";
const root = `projects/${id}`;
const plan = JSON.parse(readFileSync(`${root}/plan.json`, "utf8").replace(/^\uFEFF/, ""));
const chars = JSON.parse(readFileSync("src/story/chars.json", "utf8"));
const charIds = new Set(chars.map((c) => c.id));
const stickers = new Set(readdirSync("public/stickers").filter((f) => f.endsWith(".svg")).map((f) => f.replace(/\.svg$/, "")));

const SYSTEM = `你在给讲解视频设计"角色演员"。每条公式被拆成几项，讲到哪一项，屏幕下方就出现一个小人物，把这一项"为什么有这个作用"的比喻演出来。
对每一项选：
- look：角色，只能从下面的角色清单里选。要和这一项 why 里的比喻对上：老师批改→teacher，学生→student，厨师试吃→cook，评委打分→judge，科学家→scientist，侦探找线索→detective，修理工→mechanic，用力/费力→person-lifting-weights，攀爬→person-climbing，同时处理多件事→person-juggling，拿不准/耸肩→person-shrugging，懊恼→person-facepalming，否定→person-gesturing-no，认可→person-gesturing-ok，冷静→person-in-lotus-position，兴奋→person-cartwheeling，对抗→person-fencing。比喻里没有人物就选最贴近语义的姿势。
- mood：可选，头上的小表情，取贴图名：thinking-face、light-bulb、exploding-head、sparkles、fire、warning、check-mark-button、cross-mark、high-voltage。
- prop：可选，手边的道具，取贴图名：books、memo、coin、trophy、magnifying-glass-tilted-left、scissors、balance-scale、thumbs-up、cross-mark、key、locked、gear、abacus、bar-chart、compass、magnet、ruler 之类（只能用清单里有的）。
同一条公式里相邻两项不要选一模一样的角色，尽量有变化。
只输出 JSON：{"actors":[{"eq":"eq4","parts":[{"look":"teacher","mood":"light-bulb","prop":"memo"},…]}]}，parts 的个数必须和该公式的项数一致，顺序一致。`;

for (const sc of plan.scenes) {
  if (!sc.formulas?.length) continue;
  const user = `角色清单：\n${chars.map((c) => `${c.id}（${c.zh}）`).join("、")}\n\n可用贴图名：${[...stickers].join("、")}\n\n本场景的公式：\n${sc.formulas
    .map((f) => `公式 ${f.eq}：${f.overview}\n${f.parts.map((p, i) => `  ${i + 1}. ${p.name} —— 作用：${p.role}；为什么：${p.why}`).join("\n")}`)
    .join("\n")}`;
  const { obj, errors } = await chatJson(
    model,
    [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    (o) => {
      const errs = [];
      if (!Array.isArray(o?.actors)) return ['顶层必须是 {"actors":[…]}'];
      for (const f of sc.formulas) {
        const a = o.actors.find((x) => x.eq === f.eq);
        if (!a) {
          errs.push(`缺少公式 ${f.eq}`);
          continue;
        }
        if (!Array.isArray(a.parts) || a.parts.length !== f.parts.length) errs.push(`${f.eq} 的 parts 个数必须是 ${f.parts.length}`);
        (a.parts ?? []).forEach((p, i) => {
          if (!charIds.has(p.look)) errs.push(`${f.eq} 第 ${i + 1} 项 look「${p.look}」不在角色清单里`);
          if (p.mood && !stickers.has(p.mood)) errs.push(`${f.eq} 第 ${i + 1} 项 mood「${p.mood}」不是贴图名`);
          if (p.prop && !stickers.has(p.prop)) errs.push(`${f.eq} 第 ${i + 1} 项 prop「${p.prop}」不是贴图名`);
        });
      }
      return errs;
    },
    { maxRounds: 4, temperature: 0.5, maxTokens: 12000, tag: `actors-${sc.id}`, timeoutMs: 600_000 },
  );
  if (!obj) {
    console.log(`  ${sc.id} 失败：${(errors ?? []).slice(0, 2).join("；")}`);
    process.exitCode = 1;
    continue;
  }
  for (const f of sc.formulas) {
    const a = obj.actors.find((x) => x.eq === f.eq);
    f.parts.forEach((p, i) => {
      const { look, mood, prop } = a.parts[i];
      p.actor = { look, ...(mood ? { mood } : {}), ...(prop ? { prop } : {}) };
    });
    console.log(`  ${sc.id} ${f.eq}：${f.parts.map((p) => `${p.name}→${p.actor.look}`).join("，")}`);
  }
}
writeFileSync(`${root}/plan.json`, JSON.stringify(plan, null, 2));
console.log("已写入 plan.json");
