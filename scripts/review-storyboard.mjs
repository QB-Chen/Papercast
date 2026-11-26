// 分镜审查:让另一个模型扮演"挑剔的观众+教学设计师",检查画面是否和旁白矛盾、是否会误导、是否单调。
//   node scripts/review-storyboard.mjs --narr narration/pilot/ratio.revised.json --board storyboards/ratio.v2.json --model sensenova/glm-5.3
import { readFileSync, writeFileSync } from "node:fs";
import { chatJson } from "./llm.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const narr = JSON.parse(readFileSync(flag("--narr"), "utf8"));
const board = JSON.parse(readFileSync(flag("--board"), "utf8"));
const model = flag("--model", "sensenova/glm-5.3");
const outFile = flag("--out", flag("--board").replace(/\.json$/, ".review.json"));

const describe = (b) => {
  switch (b.kind) {
    case "text": return `大字「${b.text}」`;
    case "card": return `卡片「${b.title ?? ""}」要点：${(b.lines ?? []).join(" / ")}，贴图：${b.sticker ?? "无"}`;
    case "formula": return `算式「${b.formula}」${b.note ? `，说明「${b.note}」` : ""}`;
    case "compare": return `左右对比：左【${b.left?.title} ${b.left?.big ?? ""} ${b.left?.small ?? ""}】vs 右【${b.right?.title} ${b.right?.big ?? ""} ${b.right?.small ?? ""}】`;
    case "dots": return `点阵：一共 ${b.total} 个点，标出 ${b.marked} 个，说明「${b.label ?? ""}」`;
    case "bars": return `条形图：${(b.items ?? []).map((it) => `${it.label}=${it.value}（标注${it.display ?? ""}）`).join("，")}`;
    case "flow": return `流程：${(b.steps ?? []).map((s) => s.text).join(" → ")}`;
    case "sticker": return `大贴图：${(b.stickers ?? []).map((s) => `${s.name}「${s.caption ?? ""}」`).join("，")}`;
  }
  return b.kind;
};

const timeline = narr.sentences.map((s) => {
  const here = board.beats.filter((b) => b.at === s.id);
  const shots = here.length ? here.map((b) => `    ▶ [${b.slot}${b.clear ? ",清屏" : ""}] ${describe(b)}`).join("\n") : "    （画面不变）";
  return `${s.id}：${s.text}\n${shots}`;
}).join("\n");

const SYSTEM = `你是挑剔的教学设计师，要审查一份科普动画的分镜，找出会让观众误解、或让观众困惑的地方。观众只有初中数学水平。

重点检查：
1. 画面与旁白矛盾：旁白说"几乎没变"，画面却画出明显的变化；旁白说的数字和画面上的数字对不上。
2. 会误导的图形：例如把"概率"画成加起来不等于 1 的几根条；把"范围参数"画成表示大小的条；用图形比例暗示了旁白没有说的结论。
3. 概念在画面上缺席：旁白在解释一个新名词，但画面上没有它的名字、例子或图示。
4. 单调：连续很多镜头都是整屏替换、同一种元素，没有"层层累积"（比如先放蚂蚁，再并排放上大象做对比）。
5. 信息过载：同一时刻画面上字太多。
每条问题要具体到句子 id 和镜头，并给出可操作的修改建议（可以建议换元素种类、换位置、加 clear 或不加 clear、改数值）。

只输出 JSON：{"overall":"一句话总评","issues":[{"at":"句子id","severity":"高|中|低","type":"矛盾|误导|缺席|单调|过载","problem":"…","suggestion":"…"}]}。没有问题就返回空 issues。最多列 10 条，按严重程度排序。`;

const USER = `下面是旁白与分镜的对照（每句旁白下面是这句话开始时出现的画面）：\n\n${timeline}\n\n请审查。`;

function validate(o) {
  if (!Array.isArray(o?.issues)) return ['顶层必须是 {"overall","issues":[…]}'];
  const ids = new Set(narr.sentences.map((s) => s.id));
  const errs = [];
  for (const it of o.issues) if (!ids.has(it.at)) errs.push(`issue 引用了不存在的句子 ${it.at}`);
  return errs;
}

console.log(`分镜审查模型 ${model}`);
const { obj, errors } = await chatJson(model, [{ role: "system", content: SYSTEM }, { role: "user", content: USER }], validate, {
  maxRounds: 3,
  temperature: 0.3,
  maxTokens: 6000,
  tag: "review-board",
  stream: true,
  timeoutMs: 1_800_000,
  extra: flag("--effort") ? { reasoning_effort: flag("--effort") } : {},
});
if (!obj) {
  console.log("审查失败：", errors.join("; "));
  process.exit(1);
}
writeFileSync(outFile, JSON.stringify(obj, null, 2));
console.log(`\n总评：${obj.overall}\n`);
for (const it of obj.issues) console.log(`[${it.at}] ${it.severity}·${it.type}\n   问题：${it.problem}\n   建议：${it.suggestion}\n`);
console.log(`共 ${obj.issues.length} 条 → ${outFile}`);
