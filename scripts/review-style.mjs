// 风格审查：把旁白稿和"讲的好的文案"范例对照，逐句挑出不像范例的地方，并给出具体改法。
//   node scripts/review-style.mjs --in narration/x.draft.json --out narration/x.style.json [--brief briefs/x.md] [--model sensenova/glm-5.3]
// 输出格式和事实审查一致：{ score, summary, reviews:[{id, verdict:"ok"|"风格", issue, fix}] }，
// 所以 revise-narration.mjs 可以把两份审查意见一起读进去，一次改完。
import { readFileSync, writeFileSync } from "node:fs";
import { chatJson } from "./llm.mjs";
import { metricsOf, metricsOfEn } from "./style-metrics.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const input = JSON.parse(readFileSync(flag("--in"), "utf8"));
const outFile = flag("--out", flag("--in").replace(/\.json$/, ".style.json"));
const model = flag("--model", "sensenova/glm-5.3");
const brief = flag("--brief") ? readFileSync(flag("--brief"), "utf8") : "";
const exemplar = readFileSync("prompts/style-exemplar.txt", "utf8");
const M = metricsOf(input.sentences.map((s) => s.text));

const SYSTEM = `你是一位挑剔的口播稿编辑。我会给你一篇"范例口播稿"（我最喜欢的 UP 主的风格）和一份"待审旁白稿"，请你逐句对照，找出待审稿里"不像范例"的地方。

范例的特点：
1. 句子偏长，一句话里常有转折和补充（"虽然……但是……""不过……""而且……"），不是短句堆叠。
2. 口语连接词多（那、当然了、不过、所以说、比如说、就是、而且、其实、可以说、也就是说），像在对朋友说话。
3. 爱自问自答，把观众拉进来（"那你想想看……""有没有更好的办法呢？"）。
4. 讲概念先给一个具体的小例子，把例子讲透、一直用下去，再给名字。
5. 有预告和回收（"别着急，后面再说""回到刚才那个例子"），会澄清误区，会表达看法。
6. 没有书面腔，不用"综上所述""由此可见""值得注意的是"，不用并列罗列式的要点句。

请重点挑这些毛病：
- 连续几句都很短、很平，像要点列表或字幕条（应该合并成带转折的长句）。
- 书面腔、说明书腔、口号腔。
- 术语出现得太突然：没有先用例子或大白话铺垫就直接抛名词。
- 比喻硬塞：为了回扣比喻而说"回到某某比喻"，但这句话和比喻没关系，或者同一个比喻在一个场景里用了很多次。
- 场景开头衔接生硬、结尾没有自然过渡。
- 连续多句用同一种句式开头。
- 不适合朗读的写法（符号、下划线、过长的并列）。

规则：
- 最多标出一半的句子，只标真正有问题的，不要鸡蛋里挑骨头。
- 对每个有问题的句子，fix 必须是一个可以直接替换的完整改写，口吻像范例，字数在 15 到 80 之间，而且**不能改变句子的事实内容、不能增加或改动数字、不能增加论文里没有的论断**；可以把相邻的句子的意思并进来，但那样的话请在 issue 里说明"建议和 xx 句合并"，fix 仍然只写这一句的新文字。
- 数字一律用汉字，不要出现阿拉伯数字和希腊字母。
- 只输出 JSON：{"score":1到10的整数（10 是和范例一样好）,"summary":"一句话总评","reviews":[{"id":"…","verdict":"ok 或 风格","issue":"问题在哪（verdict 为 ok 时留空）","fix":"改写后的完整句子（verdict 为 ok 时留空）"}]}，每一句都要有一条。`;

// ---- 英文版 ----
const EN = (flag("--lang") ?? process.env.VIDEO_LANG ?? "zh") === "en";
const exemplarEn = readFileSync("prompts/style-exemplar-en.txt", "utf8");
const SYSTEM_EN = `You are a picky script editor for English explainer videos. I will give you an "example script" (the style of my favourite YouTuber) and a "script under review". Compare them sentence by sentence and find where the script under review does not sound like the example.

Features of the example:
1. Fairly long sentences, often with a turn or add-on ("but", "though", "which means", "so"), not a pile of short flat sentences.
2. Many spoken connectors and contractions (so, well, honestly, kind of, just, you, we, it's, don't, that's), like talking to a friend.
3. Self-questions that pull the viewer in ("So what could you do about it?", "Does that actually work?").
4. For each concept, a small concrete example first, kept going, and only then the name.
5. Previews and call-backs, clearing up misunderstandings, giving an opinion.
6. No written-article tone: no "in conclusion", "furthermore", "it is worth noting that", no bullet-style listing sentences.

Pick on these problems:
- Several short flat sentences in a row that sound like bullet points or subtitles (they should be merged into a longer sentence with a turn).
- Written or manual-like or slogan-like tone.
- A term thrown out suddenly without a plain-words or example set-up.
- A metaphor forced in: "going back to our X" when the sentence has nothing to do with it, or the same metaphor used many times in one scene.
- Stiff scene openings and no natural hand-off at the end.
- Many consecutive sentences starting the same way.
- Text that is awkward to read aloud (symbols, parentheses, underscores, long enumerations).

Rules:
- Mark at most half of the sentences, and only the really problematic ones.
- For each marked sentence, "fix" must be a complete replacement sentence in English, spoken in the voice of the example, 8 to 45 words, that does NOT change the factual content, does NOT add or change any number, and does NOT add claims that are not in the paper. You may fold the meaning of a neighbouring sentence in, but then say "suggest merging with xx" in issue; fix still contains only the new text for this one sentence.
- No parentheses, underscores, Greek letters or markdown in fix.
- Output JSON only: {"score": integer 1-10 (10 = as good as the example), "summary": "one-line overall comment", "reviews":[{"id":"…","verdict":"ok" or "风格","issue":"what is wrong (empty when ok)","fix":"the full rewritten sentence (empty when ok)"}]}. One entry per sentence. The verdict value must be exactly "ok" or "风格".`;
const ME = metricsOfEn(input.sentences.map((s) => s.text));
const USER_EN = `[EXAMPLE SCRIPT]
${exemplarEn}

${brief ? `[Brief for this scene (only to tell which sentences are paper facts; do not change facts)]\n${brief.slice(0, 3000)}\n\n` : ""}[SCRIPT UNDER REVIEW] (measured: avg ${ME.avgWords} words per sentence, question share ${ME.questionShare}, colloquial share ${ME.colloquialShare}; the example has 13.7 words, 0.15, 0.85)
${input.sentences.map((s) => `${s.id}: ${s.text}`).join("\n")}

Review every sentence and output JSON.`;
function validateEn(o) {
  const errs = [];
  if (!Array.isArray(o?.reviews)) return ['The top level must be {"score":…,"reviews":[…]}'];
  const ids = new Set(o.reviews.map((r) => r.id));
  for (const s of input.sentences) if (!ids.has(s.id)) errs.push(`missing review for ${s.id}`);
  let bad = 0;
  for (const r of o.reviews) {
    if (!["ok", "风格"].includes(r.verdict)) errs.push(`${r.id}: verdict must be exactly "ok" or "风格"`);
    if (r.verdict === "风格") {
      bad++;
      const nw = (r.fix ?? "").split(/\s+/).filter(Boolean).length;
      if (!r.issue || !r.fix) errs.push(`${r.id}: a style problem needs both issue and fix`);
      else if (/[α-ωΑ-Ω()_\[\]{}*#`]/.test(r.fix)) errs.push(`${r.id}: fix contains Greek letters, parentheses, underscores or markdown`);
      else if (/[\u4e00-\u9fff]/.test(r.fix)) errs.push(`${r.id}: fix must be English`);
      else if (nw > 50 || nw < 4) errs.push(`${r.id}: fix must be 4 to 50 words (now ${nw})`);
    }
  }
  if (bad > Math.ceil(input.sentences.length * 0.55)) errs.push(`you marked ${bad} sentences, more than half; keep only the most serious ones`);
  return errs;
}

const USER = `【范例口播稿】
${exemplar}

${brief ? `【这个场景的简报（只用来判断哪些是论文事实，不要改事实）】\n${brief.slice(0, 3000)}\n\n` : ""}【待审旁白稿】（程序统计：平均每句 ${M.平均字数} 字，问句占比 ${M.问句占比}，含口语连接词的句子占比 ${M["含连接词/口语词的句子占比"]}；范例是 31 字、0.13、0.75）
${input.sentences.map((s) => `${s.id}: ${s.text}`).join("\n")}

请逐句审查，输出 JSON。`;

function validate(o) {
  const errs = [];
  if (!Array.isArray(o?.reviews)) return ['顶层必须是 {"score":…,"reviews":[…]}'];
  const ids = new Set(o.reviews.map((r) => r.id));
  for (const s of input.sentences) if (!ids.has(s.id)) errs.push(`漏审了 ${s.id}`);
  let bad = 0;
  for (const r of o.reviews) {
    if (!["ok", "风格"].includes(r.verdict)) errs.push(`${r.id} 的 verdict 必须是 ok 或 风格`);
    if (r.verdict === "风格") {
      bad++;
      if (!r.issue || !r.fix) errs.push(`${r.id} 判了风格问题，必须同时给出 issue 和 fix`);
      else if (/\d/.test(r.fix) || /[α-ωΑ-Ω]/.test(r.fix)) errs.push(`${r.id} 的 fix 里有阿拉伯数字或希腊字母，请用汉字`);
      else if ([...r.fix].length > 80 || [...r.fix].length < 12) errs.push(`${r.id} 的 fix 字数要在 12 到 80 之间`);
    }
  }
  if (bad > Math.ceil(input.sentences.length * 0.55)) errs.push(`标出了 ${bad} 句，超过一半，请只保留最严重的`);
  return errs;
}

console.log(`风格审查：${model}，${input.sentences.length} 句（程序统计 平均 ${M.平均字数} 字，问句 ${M.问句占比}，连接词 ${M["含连接词/口语词的句子占比"]}）`);
const { obj, errors } = await chatJson(model, [{ role: "system", content: EN ? SYSTEM_EN : SYSTEM }, { role: "user", content: EN ? USER_EN : USER }], EN ? validateEn : validate, {
  maxRounds: 3,
  temperature: 0.3,
  maxTokens: 36000,
  tag: "style-review",
  stream: true,
  timeoutMs: 1_800_000,
});
if (!obj) {
  console.log("风格审查失败：", errors.join("; "));
  process.exit(1);
}
writeFileSync(outFile, JSON.stringify(obj, null, 2));
const bad = obj.reviews.filter((r) => r.verdict !== "ok");
console.log(`总评 ${obj.score}/10：${obj.summary}\n标出 ${bad.length} 句 → ${outFile}`);
for (const r of bad) console.log(`[${r.id}] ${r.issue}\n   改：${r.fix}`);
