// 根据分镜审查意见,让设计模型修改分镜。
//   node scripts/revise-storyboard.mjs --narr N.json --board B.json --review R.json --out B2.json --model sensenova/sensenova-6.8-flash
import { readFileSync, writeFileSync } from "node:fs";
import { chatJson } from "./llm.mjs";
import { ELEMENT_DOC, stickerNames, validateStoryboard } from "./storyboard-schema.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const narr = JSON.parse(readFileSync(flag("--narr"), "utf8"));
const board = JSON.parse(readFileSync(flag("--board"), "utf8"));
const review = JSON.parse(readFileSync(flag("--review"), "utf8"));
const model = flag("--model", "sensenova/sensenova-6.8-flash");
const outFile = flag("--out");
const ids = narr.sentences.map((s) => s.id);

const issues = review.issues.filter((i) => i.severity === "高" || i.severity === "中" || i.severity === "低");

const SYSTEM = `你是科普动画的分镜设计师。下面是你之前设计的分镜，以及教学设计师提出的审查意见。请修改分镜，让每条意见都得到处理，同时保持其余设计不变。

原则：
- 审查意见是建议，不是命令。如果某条意见你认为不成立，可以不改，但必须在对应镜头上保持原样；不要为了迎合意见而引入新的错误。
- 优先实现这些方向：避免误导的图形（范围参数别画成条；概率条的和不能超过 1，超过时改用别的元素）；增加累积感（相邻镜头能并排就不要整屏清空，用 L1/L2/R1/R2 做左右并排，且不要加 clear）；概念出现时画面上要有它的名字或例子。
- 蚂蚁和大象的对比，建议让两个镜头并排保留（蚂蚁在左、大象在右），最后再用 compare 汇总。
- dots 的 marked 可以是小数，如 7.8。
${ELEMENT_DOC}
【可用贴图名】${stickerNames().join("、")}

只输出完整的分镜 JSON 对象，不要任何解释。`;

const USER = `旁白稿：
${narr.sentences.map((s) => `${s.id} | ${s.text}`).join("\n")}

当前分镜：
${JSON.stringify(board)}

审查意见：
${issues.map((i) => `- [${i.at}] ${i.severity}·${i.type}：${i.problem}\n  建议：${i.suggestion}`).join("\n")}`;

console.log(`修订模型 ${model}，处理 ${issues.length} 条审查意见`);
const { obj, rounds, errors } = await chatJson(
  model,
  [
    { role: "system", content: SYSTEM },
    { role: "user", content: USER },
  ],
  (o) => validateStoryboard(o, ids, Object.fromEntries(narr.sentences.map((s) => [s.id, s.text]))),
  { maxRounds: 5, temperature: 0.5, maxTokens: 12000, tag: "revise-board" },
);
if (!obj) {
  console.log(`\n${rounds} 轮后仍有问题：\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
obj.sceneId = board.sceneId;
writeFileSync(outFile, JSON.stringify(obj, null, 2));
const kinds = {};
for (const b of obj.beats) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
const clears = obj.beats.filter((b) => b.clear).length;
const sideBySide = obj.beats.filter((b) => ["L1", "L2", "R1", "R2"].includes(b.slot)).length;
console.log(`\n通过校验（${rounds} 轮）：${obj.beats.length} 个镜头，清屏 ${clears} 次，左右分格镜头 ${sideBySide} 个，元素 ${JSON.stringify(kinds)} → ${outFile}`);
