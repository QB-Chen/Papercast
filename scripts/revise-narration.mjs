// 根据事实审查意见,让写稿模型修改旁白稿中有问题的句子,其余句子保持不变。
//   node scripts/revise-narration.mjs --in narration/pilot/ratio.deepseek-flash.json --review narration/pilot/ratio.deepseek-flash.review.json --out narration/pilot/ratio.revised.json --model sensenova/deepseek-flash
import { readFileSync, writeFileSync } from "node:fs";
import { chatJson } from "./llm.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const input = JSON.parse(readFileSync(flag("--in"), "utf8"));
// --review 可以是逗号分隔的多份审查意见（事实审查 + 风格审查），按句子 id 合并
const reviewFiles = flag("--review").split(",").map((x) => x.trim()).filter(Boolean);
const mergedById = new Map();
reviewFiles.forEach((f, k) => {
  const tag = k === 0 ? "事实" : "风格";
  for (const r of JSON.parse(readFileSync(f, "utf8")).reviews) {
    const bad0 = r.verdict !== "ok" && r.verdict !== "比喻";
    const cur = mergedById.get(r.id) ?? { id: r.id, verdict: "ok", issue: "", evidence: "", fix: "" };
    if (bad0) {
      cur.verdict = cur.verdict === "ok" ? r.verdict : cur.verdict;
      cur.issue += `${cur.issue ? "；" : ""}【${tag}】${r.issue ?? ""}`;
      if (r.evidence) cur.evidence += `${cur.evidence ? "；" : ""}${r.evidence}`;
      if (r.fix) cur.fix += `${cur.fix ? " / " : ""}${r.fix}`;
    }
    mergedById.set(r.id, cur);
  }
});
const review = { reviews: [...mergedById.values()] };
const model = flag("--model", "sensenova/deepseek-flash");
const outFile = flag("--out");
const prefix = input.sentences[0].id.match(/^[a-z]+/)[0];

const bad = review.reviews.filter((r) => r.verdict !== "ok" && r.verdict !== "比喻");
if (!bad.length) {
  writeFileSync(outFile, JSON.stringify(input, null, 2));
  console.log("没有需要修改的句子，原样输出。");
  process.exit(0);
}

const SYSTEM = `你是中文知识区科普视频的文案作者。下面是一份旁白稿，事实核查员指出其中几句有问题。请只修改这些句子，其余句子逐字保持不变。

要求：
- 保持口播稿的口吻：句子偏长（平均三十来个字），一句话里常有转折和补充，口语连接词多（那、不过、所以说、当然了、比如说），爱自问自答，像对朋友说话；不要改成短句堆叠，不要用书面腔。每句不超过 90 个字。核查员给出的"建议/改写"只是参考，要改得像口播而不是照抄。事实和数字不能改：事实核查的意见必须落实，风格意见在不改变事实的前提下落实。
- text 里不要出现希腊字母、数学符号、阿拉伯数字（一律用汉字，如"零点二八"）。
- 保持 id 不变，保持句子数量和顺序不变。visual 字段如果因为改句子需要同步调整就调整，否则保持不变。
- 只输出完整 JSON：{"sentences":[{"id","text","visual"}…]}，不要解释。`;

// ---- 英文版 ----
const EN = (flag("--lang") ?? process.env.VIDEO_LANG ?? "zh") === "en";
const SYSTEM_EN = `You are the script writer of an English science explainer video. Below is a voice-over script in which a fact-checker or style editor marked a few sentences as problematic. Rewrite ONLY those sentences; keep every other sentence word for word.

Requirements:
- Keep the spoken voice: fairly long sentences (about 14 words on average) with a turn or add-on, lots of spoken connectors (so, well, but, of course), self-questions, like talking to a friend. Do not turn it into a pile of short sentences or a written-article tone. At most 50 words per sentence. The reviewers' "suggestion/fix" is only a reference: make it sound spoken rather than copying it. Facts and numbers must not change: fact-check comments must be fixed; style comments are applied as long as facts stay the same.
- text must have no Greek letters, math symbols, parentheses, underscores, markdown or function notation, and must be English only.
- Keep ids, the number of sentences and their order unchanged. Adjust the visual field only if the rewritten sentence needs it, otherwise keep it.
- Output the complete JSON only: {"sentences":[{"id","text","visual"}…]}, no explanation.`;
const USER_EN = `[CURRENT SCRIPT]
${JSON.stringify(input, null, 2)}

[REVIEWER COMMENTS (only these sentences need to change)]
${bad.map((r) => `- ${r.id} (${r.verdict}): ${r.issue}\n  evidence: ${r.evidence || "-"}\n  suggestion: ${r.fix}`).join("\n")}`;
function validateEn(obj) {
  const errs = [];
  if (!Array.isArray(obj?.sentences)) return ['The top level must be {"sentences":[…]}'];
  if (obj.sentences.length !== input.sentences.length) errs.push(`Keep ${input.sentences.length} sentences, you gave ${obj.sentences.length}`);
  const badIds = new Set(bad.map((r) => r.id));
  obj.sentences.forEach((s, i) => {
    const orig = input.sentences[i];
    if (!orig) return;
    if (s.id !== orig.id) errs.push(`sentence ${i + 1} must have id ${orig.id}, you wrote ${s.id}`);
    if (!badIds.has(orig.id) && s.text !== orig.text) errs.push(`${orig.id} is not in the change list; keep it word for word: "${orig.text}"`);
    const t = s.text ?? "";
    const nw = (t.match(/[A-Za-z0-9][A-Za-z0-9'’\-.%]*/g) ?? []).length;
    if (nw > 55) errs.push(`${s.id} is too long (${nw} words, limit 55): "${t}"`);
    if (nw < 3) errs.push(`${s.id} is too short (${nw} words): "${t}"`);
    if (/[α-ωΑ-Ω∑∏√≤≥≠±×÷→⟹]/.test(t)) errs.push(`${s.id} contains math symbols`);
    if (/[\u4e00-\u9fff]/.test(t)) errs.push(`${s.id} contains Chinese characters; English only`);
    if (/[()\[\]{}_*#`<>]/.test(t) || /\b[A-Za-z]\w*\s*\(/.test(t)) errs.push(`${s.id} contains parentheses/underscores/markdown/function notation: "${t}"`);
  });
  return errs;
}

const USER = `【当前旁白稿】
${JSON.stringify(input, null, 2)}

【核查员意见（只需修改这些句子）】
${bad.map((r) => `- ${r.id}（${r.verdict}）：${r.issue}\n  依据：${r.evidence || "—"}\n  建议：${r.fix}`).join("\n")}`;

function validate(obj) {
  const errs = [];
  if (!Array.isArray(obj?.sentences)) return ['顶层必须是 {"sentences":[…]}'];
  if (obj.sentences.length !== input.sentences.length) errs.push(`句数应保持 ${input.sentences.length}，你给了 ${obj.sentences.length}`);
  const badIds = new Set(bad.map((r) => r.id));
  obj.sentences.forEach((s, i) => {
    const orig = input.sentences[i];
    if (!orig) return;
    if (s.id !== orig.id) errs.push(`第 ${i + 1} 句 id 应为 ${orig.id}，你写的是 ${s.id}`);
    if (!badIds.has(orig.id) && s.text !== orig.text) errs.push(`${orig.id} 不在修改范围内，必须逐字保持原文：「${orig.text}」`);
    const len = [...(s.text ?? "")].length;
    if (len > 90) errs.push(`${s.id} 太长（${len} 字符，上限 90）：「${s.text}」`);
    if (len < 8) errs.push(`${s.id} 太短（${len} 字符），请写完整：「${s.text}」`);
    if (/[α-ωΑ-Ω∑∏√≤≥≠±×÷→⟹]/.test(s.text ?? "")) errs.push(`${s.id} 含数学符号`);
    // GPT-4、Qwen3、FP8 这类英文名里的数字是允许的，先去掉英文词再查
    if (/\d/.test((s.text ?? "").replace(/[A-Za-z][A-Za-z0-9\-]*/g, ""))) errs.push(`${s.id} 含阿拉伯数字，请改成汉字`);
  });
  return errs;
}

console.log(`修订模型 ${model}，需要修改 ${bad.length} 句：${bad.map((r) => r.id).join(", ")}`);
const { obj, errors } = await chatJson(model, [{ role: "system", content: EN ? SYSTEM_EN : SYSTEM }, { role: "user", content: EN ? USER_EN : USER }], EN ? validateEn : validate, {
  maxRounds: 3,
  temperature: 0.5,
  maxTokens: 9000,
  tag: `revise-${prefix}`,
});
if (!obj) {
  console.log("修订失败：", errors.join("; "));
  process.exit(1);
}
writeFileSync(outFile, JSON.stringify(obj, null, 2));
for (const r of bad) {
  const before = input.sentences.find((s) => s.id === r.id).text;
  const after = obj.sentences.find((s) => s.id === r.id).text;
  console.log(`\n[${r.id}]\n  前：${before}\n  后：${after}`);
}
console.log(`\n已写入 ${outFile}`);
