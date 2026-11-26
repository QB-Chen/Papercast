// 事实审查:让另一个模型对照论文事实,逐句判断旁白稿有没有说错、夸大、或论文里查不到的陈述。
//   node scripts/review-narration.mjs --brief briefs/ratio.md --in narration/pilot/ratio.deepseek-flash.json --model sensenova/glm-5.3
// 输出每句的结论(ok / 夸大 / 错误 / 无依据)和理由。只审查"关于论文的陈述",比喻和举例不算。
import { readFileSync, writeFileSync } from "node:fs";
import { chatJson } from "./llm.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const brief = readFileSync(flag("--brief"), "utf8");
const input = JSON.parse(readFileSync(flag("--in"), "utf8"));
const model = flag("--model", "sensenova/glm-5.3");
const outFile = flag("--out", flag("--in").replace(/\.json$/, ".review.json"));
const paperPath = flag("--paper", "paper/2606.09821.txt");
const isDrpo = paperPath.includes("2606.09821");
const paper = readFileSync(paperPath, "utf8");
const LANG = flag("--lang", process.env.VIDEO_LANG ?? "zh");
// 英文版：旁白稿是英文，简报里的论文事实也可能是英文；verdict 仍用固定的中文标签（程序按它判断），issue/fix 的话用英文写，fix 必须是能直接替换的英文
const LANGNOTE =
  LANG === "en"
    ? `\n\n【语言】待审旁白稿是英文口播。claim 用英文复述；issue 用英文写；fix 必须是可以直接替换原句的英文口语句子（保持口播口吻，不要出现括号、下划线、希腊字母）。verdict 仍然只能是 ok / 夸大 / 错误 / 无依据 / 比喻 这五个中文标签。注意英文数字的写法（"890 bytes"、"a quarter"、"16 billion"）要和论文里的数值逐个核对。`
    : "";

// 论文正文里和本场景相关的部分:引言到 2.3 节末尾即可，足够核对 PPO/GRPO/比例相关陈述
const cut = paper.search(/\n\s*3 Method\s*\n/);
// --excerpt full:把整篇论文(去掉参考文献之后)给审查模型，用于讲方法、实验、消融的场景
const refAt = paper.search(/\n\s*References\s*\n/);
const paperExcerpt = flag("--excerpt") === "full" ? paper.slice(0, refAt > 0 ? refAt : 100000).slice(0, 100000) : paper.slice(0, cut > 0 ? cut : 20000).slice(0, 22000);

const SYSTEM0 = `你是严格的事实核查员。你的任务：对照论文原文和"论文事实"简报，逐句检查一份科普旁白稿，找出其中说错、夸大、或论文里查不到依据的陈述。

规则：
- 只审查"关于论文或方法的事实性陈述"（例如某方法怎么做、某数字是多少、某结论是什么）。
- 生活比喻（抽奖、摸球、遛狗）、简报明确允许的举例数字（蚂蚁、大象）不算事实陈述，不要挑它们的毛病。但如果比喻会把观众引向错误理解，要指出。
- 判断标准：
  ok = 与论文一致；
  夸大 = 方向对，但说得比论文更绝对、更宽泛；
  错误 = 与论文矛盾，或把参数含义说反；
  无依据 = 论文和简报里都查不到。
- 对每个 ok 以外的句子，给出：问题在哪、论文原文怎么说（引一小句英文原文或简报条目编号）、建议的改法。
- 数字要核对：0.2、0.28、7.8%、0.01 等。特别注意 PPO 的剪切范围是对称的 [1−ε, 1+ε]，而 GRPO 是 ε_low=0.2、ε_high=0.28 不对称。
- 只输出 JSON：{"reviews":[{"id":"…","claim":"…","verdict":"ok|夸大|错误|无依据|比喻","evidence":"…","issue":"…","fix":"…"}]}。每一句都要有一条。

【强制要求：没有证据不能判 ok】
- 先用 claim 字段把这句话里的核心陈述改写成一句"可以被核对的话"；如果这句话完全是比喻或过渡，verdict 写"比喻"，claim 写"（比喻/过渡）"。
- 只要 claim 是关于论文或方法的事实，evidence 就必须引用一小句论文英文原文（或简报条目编号，如"简报第3条"）。引不出来，就不能判 ok，只能判"无依据"或"夸大"。
- ok 的 issue 和 fix 留空；其他结论必须写 issue 和 fix。

【校准样例，请照这个标准判】
- 「GRPO 把允许范围放宽到零点二和零点二八」→ 错误。简报第4条：GRPO 用的是 ε_low=0.2、ε_high=0.28，下界 0.2、上界 0.28，并不是"放宽到"某个值，且 PPO 本身的范围是对称的。
- 「绝大多数词都特别少见」→ 夸大。论文只说概率不超过 0.01 的词占采样的 7.8%，没有说"绝大多数词"。
- 「某个倍数的词随便走」→ 夸大。能不能走取决于剪切范围 ε 的具体值，不能一概而论。
- 「概率就是抽奖摸中的机会」→ 比喻，不算事实。`;
// 审别的论文时，去掉 DRPO 专用的数字提醒和校准样例，换成通用说法
const SYSTEM = isDrpo
  ? SYSTEM0
  : SYSTEM0.replace(/- 数字要核对：[^\n]*\n/, "- 数字要核对：旁白里的每个数字、模型名、方法名，都要能在论文原文或简报里找到；论文用了 often、generally 这类程度词，旁白不能改成\"总是\"\"一定\"。\n").replace(/【校准样例[\s\S]*$/, "【校准样例】\n- 论文说 \"often\"，旁白说成\"总是\" → 夸大。\n- 旁白里出现一个论文里没有的百分比 → 无依据。\n- 打比方（抽奖、遛狗等）→ 比喻，不算事实。");

const USER = `【论文原文节选（英文）】
${paperExcerpt}

【论文事实简报】
${brief}

【待审旁白稿】
${input.sentences.map((s) => `${s.id}: ${s.text}`).join("\n")}

请逐句审查，输出 JSON。`;

function validate(obj) {
  const errs = [];
  if (!Array.isArray(obj?.reviews)) return ['顶层必须是 {"reviews":[…]}'];
  const ids = new Set(obj.reviews.map((r) => r.id));
  for (const s of input.sentences) if (!ids.has(s.id)) errs.push(`漏审了 ${s.id}`);
  for (const r of obj.reviews) {
    if (!["ok", "夸大", "错误", "无依据", "比喻"].includes(r.verdict)) errs.push(`${r.id} 的 verdict 不合法：${r.verdict}`);
    if (r.verdict === "ok" && (typeof r.evidence !== "string" || r.evidence.trim().length < 6)) errs.push(`${r.id} 判了 ok 但没有给出论文原文或简报条目作为证据，请补上证据，补不出就改判`);
  }
  return errs;
}

console.log(`审查模型 ${model}，共 ${input.sentences.length} 句`);
const { obj, errors } = await chatJson(
  model,
  [
    { role: "system", content: SYSTEM + LANGNOTE },
    { role: "user", content: USER },
  ],
  validate,
  { maxRounds: 3, temperature: 0.2, maxTokens: 36000, tag: "review", stream: true, timeoutMs: 1_800_000, extra: flag("--effort") ? { reasoning_effort: flag("--effort") } : {} },
);
if (!obj) {
  console.log("审查失败：", errors.join("; "));
  process.exit(1);
}
writeFileSync(outFile, JSON.stringify(obj, null, 2));
const bad = obj.reviews.filter((r) => r.verdict !== "ok" && r.verdict !== "比喻");
console.log(`\n共 ${obj.reviews.length} 条，其中有问题 ${bad.length} 条 → ${outFile}\n`);
for (const r of bad) {
  const text = input.sentences.find((s) => s.id === r.id)?.text ?? "";
  console.log(`[${r.id}] ${r.verdict}  「${text}」\n   问题：${r.issue}\n   依据：${r.evidence}\n   建议：${r.fix}\n`);
}
