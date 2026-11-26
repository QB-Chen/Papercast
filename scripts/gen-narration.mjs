// 用大语言模型为一个场景写口播稿，口吻严格对标用户给的范例文案（prompts/style-exemplar.txt，即"讲的好的文案.txt"）。
//   node scripts/gen-narration.mjs --brief briefs/ratio.md --prefix r --model sensenova/kimi-k3 --out narration/pilot/ratio.llm.json
// 输出：{ sentences: [{ id, text, visual }] }。
// 校验分两类：
//   格式：字数、符号、阿拉伯数字、英文词表、必须出现/禁止出现的词（来自简报末尾的"## 校验"小节）
//   风格：把范例文案的统计特征（句长、长句占比、问句占比、口语连接词占比）当作硬指标，不达标就把差距回喂给模型重写
//
// 简报末尾的"## 校验"小节，每行形如（缺省则用默认值）：
//   句数: 10-16
//   必须出现: 蚂蚁, 大象
//   必须出现其一: 平滑|弹簧        （用 | 连接，表示至少出现其中一个）
//   禁止出现: 词1, 词2
//   禁止同时出现: 掩码+弹簧        （用 + 连接，这些词同时出现就报错）
//   允许英文: PPO, FP8, AIME
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chatJson } from "./llm.mjs";
import { metricsOf, splitSentences, metricsOfEn, splitSentencesEn, wordsOf } from "./style-metrics.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const LANG = flag("--lang", process.env.VIDEO_LANG ?? "zh"); // zh | en：英文版用英文口播稿的写法、校验和风格指标
const EN = LANG === "en";
const briefFile = flag("--brief");
const prefix = flag("--prefix", "s");
const model = flag("--model", "sensenova/kimi-k3");
const outFile = flag("--out", `narration/pilot/${prefix}.llm.json`);
const styleGate = !args.includes("--no-style-gate");
if (!briefFile) throw new Error("需要 --brief");

const exemplar = readFileSync(EN ? "prompts/style-exemplar-en.txt" : "prompts/style-exemplar.txt", "utf8");
const brief = readFileSync(briefFile, "utf8");
const EX = metricsOf(splitSentences(exemplar.replace(/^---$/gm, "")));
const EXE = metricsOfEn(splitSentencesEn(EN ? exemplar : readFileSync("prompts/style-exemplar-en.txt", "utf8"))); // 英文范例的指标（中文模式下只是让英文提示词的模板能求值，不会被用到）

const rule = (name) => {
  const m = brief.match(new RegExp(`^\\s*${name}\\s*[:：]\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
};
const items = (name) =>
  (rule(name) ?? "")
    .split(/[,，、]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
const [MIN_N, MAX_N] = (rule("句数") ?? "12-20").split(/[-~到]/).map((x) => parseInt(x, 10));
// 中文旁白里不允许出现英文单词（缩写除外）。简报要求"必须出现"一个含多个英文单词的名字（如 Hierarchical Sparse Indexer）就永远通不过，
// 这种要求自动放宽成：只要求它的缩写或中文译名出现（简报里写不出来就直接不要求），并在日志里说明
const latinTokens = (s) => s.match(/[A-Za-z][A-Za-z0-9\-]*/g) ?? [];
// 中文旁白里数字一律写汉字，所以含阿拉伯数字的"必须出现"词（890 字节）也满足不了，同样放宽
const multiLatin = (w) => !EN && ((!/[\u4e00-\u9fff]/.test(w) && latinTokens(w).length >= 2) || /\d/.test(w.replace(/[A-Za-z][A-Za-z0-9\-]*/g, ""))); // 英文名里的数字（FP4、GPT-4）不算
const relaxed = [];
const MUST = items("必须出现").filter((w) => (multiLatin(w) ? (relaxed.push(w), false) : true));
const MUST_ANY = items("必须出现其一").map((x) => x.split("|").map((y) => y.trim()).filter((w) => (multiLatin(w) ? (relaxed.push(w), false) : true))).filter((g) => g.length);
if (relaxed.length) console.log(`⚠ 这些"必须出现"的词含多个英文单词，中文旁白里说不出来，已放宽（不要求出现）：${relaxed.join("、")}`);
const FORBID = items("禁止出现");
const FORBID_COMBO = items("禁止同时出现").map((x) => x.split("+").map((y) => y.trim()));
// 允许英文清单里写的可能是词组（"KV cache"），校验是逐个英文词比对的，所以拆成单个词；要求必须出现的单个英文名（Terminal-Bench）也算允许
const ALLOWED_LATIN = new Set(["PPO", "GRPO", "DPPO", "DRPO", "SPO", "LLM", "RL", "ratio", "clip", ...items("允许英文").flatMap(latinTokens), ...[...MUST, ...MUST_ANY.flat()].flatMap(latinTokens)]);

// 贯穿比喻：可选。只在真正对得上的地方用，不强行回扣
const metaphorLine = brief.match(/贯穿比喻[：:]\s*(.+)/)?.[1]?.trim();
const METAPHOR_RULE = metaphorLine
  ? `- 全片有一个可以借用的比喻：${metaphorLine}\n  只在它真能帮观众理解的地方用，一个场景里最多用一两次；不要每讲完一个概念就硬回扣一句"回到某某比喻"，那样很假。不用也完全可以。`
  : "- 概念之间要有承接，讲完一个再自然过渡到下一个。";

// 公式逐项讲解：简报里有"公式逐项JSON"就要求旁白按顺序讲到每一项
let FORMULAS = [];
try {
  const j = brief.match(/^公式逐项JSON:\s*(.+)$/m)?.[1];
  if (j) FORMULAS = JSON.parse(j);
} catch {
  FORMULAS = [];
}
const FORMULA_RULE = FORMULAS.length
  ? `\n- 这个场景里有要逐项讲解的公式。严格按简报"必须逐项讲解的公式"那一节写：先一句话说整条公式在干什么，然后按顺序，每一项单独用一到两句话，说清它叫什么、起什么作用、为什么会有这个作用；讲到某一项时，必须说出简报里给的那几个词之一，让观众知道你现在指的是公式的哪一部分；最后用一句话把各项合起来。不要整条公式念一遍就带过。旁白里不要出现希腊字母和下标，用名字称呼。`
  : "";
const SYSTEM_ZH = `你是一位中文知识区 UP 主，正在为自己的视频写口播稿，观众只有初中数学水平。你要写的是整支视频里的一个场景。

【最重要：模仿范例的说话方式】
我会给你一篇我最喜欢的口播稿作范例。请像模仿一个人的声音那样去模仿它的口吻和节奏，不是只学格式。我已经把它的特点统计出来了，你写的稿子必须达到：
- 句子偏长。范例平均每句 ${EX.平均字数} 个字，${Math.round(EX["超过25字的句子占比"] * 100)}% 的句子超过 25 个字。一句话里常带转折或补充，比如"虽然……但是……""不过……""而且……""那换句话说就是……"。千万不要写成一串短句。
- 口语连接词很多。范例里约 ${Math.round(EX["含连接词/口语词的句子占比"] * 100)}% 的句子含有"那""当然了""不过""所以说""比如说""就是""而且""其实""可以说""也就是说"这类词，约 ${Math.round(EX["以'那/不过/所以说/当然了/比如说'开头的占比"] * 100)}% 的句子就以它们开头。
- 爱自问自答，把观众拉进来："那你想想看，要是你的话，你会怎么办呢？""有没有更科学的办法呢？""大家能理解吗？"范例里约 ${Math.round(EX.问句占比 * 100)}% 的句子是问句。
- 会预告和回收（"别着急，后面再说""回到刚才那个例子"），会澄清误区（"注意，这里并不是说……"），会说出自己的看法（"我觉得更重要的是……"，只能是看法，不能编自己的经历）。
- 讲一个概念，先拿一个具体的小例子让人有感觉，把例子讲透、一直用下去，再告诉观众它叫什么、在这里起什么作用。不要一个概念换一个例子。
- 像对朋友说话，不是写文章。不用"综上所述""由此可见""值得注意的是"这类书面腔。

【写法要求】
- 观众没有机器学习背景。每个术语第一次出现，要先用大白话或例子说清楚，再给名字。遇到公式和符号，先说它的意思，不要上来就念符号。
${METAPHOR_RULE}
- 一句话可以很长，字幕会自动按标点分段显示，所以放心写长句。但一句话只讲一件事。${FORMULA_RULE}

【格式要求】
- 只输出 JSON：{"sentences":[{"id":"…","text":"…","visual":"…"}]}，不要任何解释。
- id 用简报指定的前缀加序号，如 r1、r2、r3……，严格连续递增。
- 每句 text 一般在 20 到 40 个字符，最长不超过 70 个字符，不少于 4 个字符（"那怎么办呢？"这样的短问句可以有，但别连着出现）。
- text 里不要出现希腊字母和数学符号。数字一律写汉字（"千分之一""百分之五十""零点二"）。英文缩写（PPO、GRPO 等）可以保留。
- visual：一句话写这句话说出来时画面上最该出现什么（物体、谁在变化）。没有新画面时写"保持上一画面"。
- 句数：按简报"校验"部分给出的范围。

【事实纪律】
- 关于论文的陈述，只能来自简报里的"论文事实"，不得补充简报以外的论文结论、实验结果、数字。论文用了"往往""通常"这类程度词，你也要保留，不能说成"总是""一定"。
- 简报允许的举例数字可以用，但必须明说是"举个例子""假设"。
- 不要编造个人经历，人称用"我们""你"，可以说"我觉得"表达看法。
- 这是一支完整的单个视频，不是系列节目：不要说"上一集""下一集""下期""上期""上次"，要说"前面""刚才""后面""接下来"。`;

// ---- 英文版：写给英文观众的口播稿。简报是中文或英文都行，但旁白必须是自然的口语英文 ----
const FORMULA_RULE_EN = FORMULAS.length
  ? `\n- This scene has formulas that must be explained term by term. Follow the "formulas to explain term by term" section of the brief strictly: first one sentence on what the whole formula does; then, in order, one or two sentences per term saying what it is called, what it does, and why it does that; when you reach a term you MUST say one of the words the brief lists for it, so viewers know which part of the formula you mean; finally one sentence that ties the terms together. Never just read the formula out. Do not use Greek letters or subscripts in the narration; refer to each part by its name.`
  : "";
const SYSTEM_EN = `You are a popular English-language science YouTuber writing the voice-over script for one scene of your own explainer video. The audience has no machine-learning background (think a curious high-school student). Your script will be read aloud by a text-to-speech voice, so it must sound like a person talking, not like an article.

[MOST IMPORTANT: copy how the example talks]
I will show you an example script I love. Imitate its voice and rhythm, not just its format. Measured features of the example that your script must reach:
- Sentences are fairly long. The example averages ${EXE.avgWords} words per sentence and ${Math.round(EXE.longShare * 100)}% of its sentences are longer than 18 words. A sentence often carries a turn or an add-on ("but", "though", "which means", "so"). Do NOT write a pile of short, flat sentences.
- Lots of spoken connectors: about ${Math.round(EXE.colloquialShare * 100)}% of the sentences contain words like "so", "well", "honestly", "kind of", "just", "you", "we", contractions ("it's", "don't", "that's"). About ${Math.round(EXE.openerShare * 100)}% of the sentences start with openers such as "So", "Now", "But", "Well", "Okay", "Think about", "Imagine", "Here's", "Of course".
- Self-questions that pull the viewer in ("So what could you do about it?", "Does that actually work?"). About ${Math.round(EXE.questionShare * 100)}% of the sentences are questions.
- Previews and call-backs ("we'll get to that in a second", "back to that notebook"), clearing up misunderstandings ("notice what they are not claiming"), and opinions ("I think the interesting part is..."), but never invented personal experiences.
- For each new idea, start with a small concrete example so the viewer feels it, stay with that example, and only then give the idea its name and say what it does here. Do not switch examples every concept.
- Talk to a friend. No "in conclusion", "it is worth noting that", "furthermore", "moreover", no bullet-list sentences.

[Writing rules]
- Assume no ML background. The first time a term appears, explain it in plain words or with an example, then give the name. For formulas and symbols, say what it means first, never start by reading symbols.
- Ideas must connect: finish one, then move naturally to the next. A metaphor is optional and only worth using where it truly fits; do not force a call-back to it after every concept.
- Each sentence should cover one idea. Long is fine because captions are split at punctuation automatically.${FORMULA_RULE_EN}

[Format rules]
- Output JSON only: {"sentences":[{"id":"…","text":"…","visual":"…"}]}, with no explanation.
- ids are the prefix from the brief plus a running number: ${prefix}1, ${prefix}2, ${prefix}3 … strictly consecutive.
- Each text is usually 8 to 24 words, never more than 40 words, and at least 3 words (a short question such as "So what now?" is fine, but never several in a row).
- Text must be plain spoken English: no Greek letters, no math symbols, no parentheses, no underscores, no function notation like f(x) or y_w, no markdown, no emoji. Write numbers the way you would say them in a video: digits are fine for measurements and counts ("890 bytes", "45 trillion tokens", "16B parameters" -> write "16 billion parameters"); spell small numbers in ordinary speech ("one", "two", "a quarter", "about half"). Acronyms and model names (KV, MoE, FP4, DeepSeek-V4.1-Flash) are fine; the first time an acronym appears, say what it stands for or what it means.
- visual: one line saying what should be most visible on screen while this sentence is spoken (objects, what changes). Write "keep previous visual" if nothing new.
- Number of sentences: the range in the brief's checks section.

[Fact discipline]
- Every statement about the paper must come from the "paper facts" in the brief. Do not add results, numbers or conclusions that are not there. If the paper hedges ("often", "typically", "in some cases"), keep the hedge; never turn it into "always" or "definitely".
- Illustrative numbers allowed by the brief may be used but you must say clearly they are made up: "say", "suppose", "for example".
- Do not invent personal experiences. Use "we" and "you"; "I think" is fine for opinions.
- This is one complete video, not a series: never say "last episode", "next episode", "next time", "last time"; say "earlier", "a moment ago", "later", "next".`;
const SYSTEM = EN ? SYSTEM_EN : SYSTEM_ZH;

const USER = EN
  ? `===== EXAMPLE START (imitate how it talks, do not copy its content) =====
${exemplar}
===== EXAMPLE END =====

Here is the brief for my scene:

===== BRIEF START =====
${brief}
===== BRIEF END =====

id prefix: ${prefix}
Output the JSON directly.`
  : `=====范例开始（请模仿它的说话方式，不要抄内容）=====
${exemplar}
=====范例结束=====

下面是我的场景简报：

=====简报开始=====
${brief}
=====简报结束=====

id 前缀：${prefix}
请直接输出 JSON。`;

function styleErrors(texts) {
  if (!styleGate || texts.length < 6) return [];
  const m = metricsOf(texts);
  const errs = [];
  const need = (label, got, min, hint) => got < min && errs.push(`【风格】${label}：现在 ${got}，要求不低于 ${min}（范例是 ${hint}）。`);
  need("平均每句字数", m.平均字数, +(EX.平均字数 * 0.82).toFixed(1), EX.平均字数);
  need("超过 25 字的句子占比", m["超过25字的句子占比"], +(EX["超过25字的句子占比"] * 0.7).toFixed(2), EX["超过25字的句子占比"]);
  need("问句占比", m.问句占比, +(EX.问句占比 * 0.55).toFixed(2), EX.问句占比);
  need("含口语连接词的句子占比", m["含连接词/口语词的句子占比"], +(EX["含连接词/口语词的句子占比"] * 0.8).toFixed(2), EX["含连接词/口语词的句子占比"]);
  need("以'那/不过/所以说/当然了/比如说'等开头的句子占比", m["以'那/不过/所以说/当然了/比如说'开头的占比"], +(EX["以'那/不过/所以说/当然了/比如说'开头的占比"] * 0.6).toFixed(2), EX["以'那/不过/所以说/当然了/比如说'开头的占比"]);
  const tooLong = m.平均字数 > EX.平均字数 * 1.25;
  if (tooLong) errs.push(`【风格】平均每句 ${m.平均字数} 个字太长了，范例是 ${EX.平均字数}，大多数句子应该在 20 到 38 字之间。把最长的几句从逗号处拆成两句，每句仍然要有口语味（不要拆成要点式短句）。`);
  const tooShort = m.平均字数 < EX.平均字数 * 0.82 || m["超过25字的句子占比"] < EX["超过25字的句子占比"] * 0.7;
  if (errs.length && tooShort && !tooLong) errs.push(`【风格】整体偏书面、偏短句堆叠。请把相邻的两三个短句并成一个带转折或补充的长句，再整体重写，而不是只改一两句。`);
  if (errs.some((e) => e.includes("问句占比"))) errs.push(`【风格】问句不够：请在讲到新概念前、讲完一个结论后，用"那……呢？""有没有更好的办法呢？""你想想看，……？"这样的自问自答把观众拉进来。`);
  return errs;
}

// ---- 英文版校验 ----
function styleErrorsEn(texts) {
  if (!styleGate || texts.length < 3) return [];
  const m = metricsOfEn(texts);
  const errs = [];
  // 句子太少时占比类指标不稳定，只查最要紧的一条：平均句长（英文每句超过 22 词，配音会变成 15 秒以上一句，字幕和画面都跟不上）
  if (texts.length < 6) {
    if (m.avgWords > EXE.avgWords * 1.5) errs.push(`【风格】Average ${m.avgWords} words per sentence is too long (example: ${EXE.avgWords}). Most sentences should be 10 to 24 words; split the longest ones at a comma, keeping each one spoken and conversational.`);
    return errs;
  }
  const need = (label, got, min, ex) => got < min && errs.push(`【风格】${label}: now ${got}, must be at least ${min} (the example has ${ex}).`);
  need("average words per sentence", m.avgWords, +(EXE.avgWords * 0.85).toFixed(1), EXE.avgWords);
  need("share of sentences longer than 18 words", m.longShare, +(EXE.longShare * 0.7).toFixed(2), EXE.longShare);
  need("share of questions", m.questionShare, +(EXE.questionShare * 0.55).toFixed(2), EXE.questionShare);
  need("share of sentences with spoken connectors/contractions", m.colloquialShare, +(EXE.colloquialShare * 0.8).toFixed(2), EXE.colloquialShare);
  need("share of sentences starting with openers like So/Now/But/Well/Think about", m.openerShare, +(EXE.openerShare * 0.6).toFixed(2), EXE.openerShare);
  const tooLong = m.avgWords > EXE.avgWords * 1.5;
  if (tooLong) errs.push(`【风格】Average ${m.avgWords} words per sentence is too long (example: ${EXE.avgWords}). Most sentences should be 10 to 24 words; split the longest ones at a comma, keeping each one spoken and conversational.`);
  if (errs.length && !tooLong && m.avgWords < EXE.avgWords * 0.85) errs.push(`【风格】The script is too choppy and written-sounding. Merge neighbouring short sentences into one sentence with a turn ("but", "though", "so") and rewrite as a whole, not just one or two lines.`);
  if (errs.some((e) => e.includes("questions"))) errs.push(`【风格】Not enough questions: before a new concept, or after a conclusion, pull the viewer in with a self-question ("So what could you do about it?", "Does that actually work?", "Why does that matter?").`);
  return errs;
}
const lc = (s) => String(s ?? "").toLowerCase();
function validateEn(obj) {
  const errs = [];
  const list = obj?.sentences;
  if (!Array.isArray(list)) return ['The top level must be {"sentences":[…]}'];
  if (list.length < MIN_N || list.length > MAX_N) errs.push(`${list.length > MAX_N * 2 || list.length < MIN_N * 0.5 ? "" : "【风格】"}You wrote ${list.length} sentences; the target range is ${MIN_N} to ${MAX_N} (only a target: a small deviation is acceptable if everything else passes)`);
  const seen = new Set();
  list.forEach((s, i) => {
    const want = `${prefix}${i + 1}`;
    if (s.id !== want) errs.push(`sentence ${i + 1} must have id ${want}, you wrote ${s.id}`);
    if (seen.has(s.id)) errs.push(`duplicate id: ${s.id}`);
    seen.add(s.id);
    if (typeof s.text !== "string" || !s.text.trim()) {
      errs.push(`${s.id} has empty text`);
      return;
    }
    const nw = wordsOf(s.text);
    if (nw > 45) errs.push(`${nw > 70 ? "" : "【风格】"}${s.id} is too long (${nw} words, aim for 12 to 30, never above 45): "${s.text}". Split it into two sentences.`);
    if (nw < 3) errs.push(`${s.id} is too short (${nw} words); merge it into a neighbour: "${s.text}"`);
    if (/[α-ωΑ-Ω∑∏√≤≥≠±×÷→⟹]/.test(s.text)) errs.push(`${s.id} contains math symbols or Greek letters; say them in words: "${s.text}"`);
    if (/[\u4e00-\u9fff]/.test(s.text)) errs.push(`${s.id} contains Chinese characters; the narration must be English only`);
    if (/[()\[\]{}_*#`<>]/.test(s.text)) errs.push(`${s.id} contains parentheses/brackets/underscores/markdown, which the voice reads out strangely; rephrase in plain words: "${s.text}"`);
    if (/\b[A-Za-z]\w*\s*\(/.test(s.text)) errs.push(`${s.id} contains function notation; rephrase in words: "${s.text}"`);
    if (typeof s.visual !== "string" || s.visual.trim().length < 2) errs.push(`${s.id} is missing the visual line`);
  });
  if (FORMULAS.length) {
    let prev = -1;
    for (const fm of FORMULAS) {
      for (const [k, p] of fm.parts.entries()) {
        const idx = list.findIndex((s, i) => i > prev && p.say.some((w) => lc(s.text).includes(lc(w))));
        if (idx < 0) errs.push(`Formula ${fm.eq}, term ${k + 1} "${p.name}" is not explained: starting from the sentence after the previous term, one sentence must contain one of ${p.say.join(", ")} and say what it does and why. Each term needs its own sentence, in order`);
        else prev = idx;
      }
    }
  }
  const all = lc(list.map((s) => s.text).join(" "));
  for (const must of MUST) if (!all.includes(lc(must))) errs.push(`The text must mention "${must}"`);
  for (const group of MUST_ANY) if (!group.some((w) => all.includes(lc(w)))) errs.push(`The text must contain at least one of: ${group.join(", ")}`);
  for (const w of FORBID) if (all.includes(lc(w))) errs.push(`The text must not mention "${w}" (not covered in this scene)`);
  for (const combo of FORBID_COMBO) if (combo.every((w) => all.includes(lc(w)))) errs.push(`"${combo.join('" and "')}" must not appear together (not covered in this scene)`);
  for (const w of ["last episode", "next episode", "previous episode", "next time", "last time", "next video", "previous video", "last video", "part one", "part two"]) if (all.includes(w)) errs.push(`The text must not say "${w}": this is one standalone video, not a series. Say "earlier", "a moment ago", "later", "next"`);
  if (!errs.length) errs.push(...styleErrorsEn(list.map((s) => s.text)));
  return errs;
}

function validateZh(obj) {
  const errs = [];
  const list = obj?.sentences;
  if (!Array.isArray(list)) return ['顶层必须是 {"sentences":[…]}'];
  if (list.length < MIN_N || list.length > MAX_N) errs.push(`${list.length > MAX_N * 2 || list.length < MIN_N * 0.5 ? "" : "【风格】"}句数是 ${list.length}，要求 ${MIN_N} 到 ${MAX_N} 句（句数只是目标，其余都合格时偏差可以接受）`);
  const seen = new Set();
  list.forEach((s, i) => {
    const want = `${prefix}${i + 1}`;
    if (s.id !== want) errs.push(`第 ${i + 1} 句的 id 应为 ${want}，你写的是 ${s.id}`);
    if (seen.has(s.id)) errs.push(`id 重复：${s.id}`);
    seen.add(s.id);
    if (typeof s.text !== "string" || !s.text.trim()) {
      errs.push(`${s.id} 的 text 为空`);
      return;
    }
    const len = [...s.text].length;
    if (len > 100) errs.push(`${s.id} 太长（${len} 字符，硬上限 100，建议 90 以内）：「${s.text}」，请在合适的地方拆成两句`);
    if (len < 4) errs.push(`${s.id} 太短（${len} 字符），请并进相邻的句子：「${s.text}」`);
    if (/[α-ωΑ-Ω∑∏√≤≥≠±×÷→⟹]/.test(s.text)) errs.push(`${s.id} 含有数学符号或希腊字母，请改成中文说法：「${s.text}」`);
    const latin = s.text.match(/[A-Za-z][A-Za-z0-9\-]*/g) ?? [];
    let rest = s.text;
    for (const w of latin) {
      if (ALLOWED_LATIN.has(w)) rest = rest.replace(w, "");
      else if (w.length >= 2) errs.push(`【风格】${s.id} 含不允许的英文「${w}」：请改成中文说法（专有名词用中文意译，比如 Full 模式说成"完整模式"）；这是个软要求，改不掉时会被接受，配音按英文读`);
    }
    if (/\d/.test(rest)) errs.push(`${s.id} 含阿拉伯数字，请一律改成汉字：「${s.text}」`);
    if (typeof s.visual !== "string" || s.visual.trim().length < 2) errs.push(`${s.id} 缺少 visual 画面说明`);
    // 配音会把函数记号、括号里的字母、下划线逐个读出来，听着很怪
    if (/[A-Za-z]\s*\(/.test(s.text) || /[（(][^）)]*[A-Za-z]/.test(s.text) || /_/.test(s.text)) errs.push(`${s.id} 含有函数记号、括号里的英文或下划线（如 Z(x)、y_w），配音会读得很怪，请改成中文说法（如"配分函数""好回答"）：「${s.text}」`);
  });
  // 公式的每一项都要有一句话专门讲，并且按顺序
  if (FORMULAS.length) {
    let prev = -1;
    for (const fm of FORMULAS) {
      for (const [k, p] of fm.parts.entries()) {
        const idx = list.findIndex((s, i) => i > prev && p.say.some((w) => (s.text ?? "").includes(w)));
        if (idx < 0) errs.push(`公式 ${fm.eq} 的第 ${k + 1} 项「${p.name}」没有讲到：从上一项所在句子的下一句起，必须有一句话里出现 ${p.say.join("、")} 之一，并在这句话里说清它的作用和原因。每一项要有自己的句子，顺序不能乱`);
        else prev = idx;
      }
    }
  }
  const all = list.map((s) => s.text).join("");
  for (const must of MUST) if (!all.includes(must)) errs.push(`全文没有出现必须覆盖的词「${must}」`);
  for (const group of MUST_ANY) if (!group.some((w) => all.includes(w))) errs.push(`全文至少要出现下面其中一个词：${group.join("、")}`);
  for (const w of FORBID) if (all.includes(w)) errs.push(`全文不能出现「${w}」（本场景不讲这个）`);
  for (const combo of FORBID_COMBO) if (combo.every((w) => all.includes(w))) errs.push(`「${combo.join("」和「")}」不能同时出现（本场景不讲这部分内容）`);
  for (const w of ["上一集", "下一集", "下集", "上集", "下期", "上期", "下一期", "上一期", "上次"]) if (all.includes(w)) errs.push(`全文不能出现「${w}」：这是单个视频，不是系列，请改成"前面""刚才""后面""接下来"`);
  if (!errs.length) errs.push(...styleErrors(list.map((s) => s.text)));
  return errs;
}

const validate = EN ? validateEn : validateZh;
console.log(`模型 ${model}（${LANG}），简报 ${briefFile}，句数 ${MIN_N}-${MAX_N}，风格闸门 ${styleGate ? "开" : "关"}`);
const { obj, rounds, errors, partial } = await chatJson(
  model,
  [
    { role: "system", content: SYSTEM },
    { role: "user", content: USER },
  ],
  validate,
  { maxRounds: 6, temperature: 0.8, maxTokens: 14000, tag: `narr-${prefix}`, stream: true, timeoutMs: 1_800_000, bestEffort: true },
);

mkdirSync(dirname(outFile), { recursive: true });
// 轮数用完后只剩风格指标没完全达标（格式和事实纪律都没问题）：接受最好的一版，后面还有风格审查和修订会继续改
if (obj && partial) {
  if (errors.every((e) => e.startsWith("【风格】") || e.startsWith("公式 ") || e.startsWith("Formula "))) console.log(`\n⚠ ${rounds} 轮后风格指标仍有差距，接受最好的一版（交给后面的风格审查）：\n- ${errors.join("\n- ")}`);
  else {
    console.log(`\n${rounds} 轮后仍有格式问题：\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }
}
if (!obj) {
  console.log(`\n${rounds} 轮后仍有问题：\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
writeFileSync(outFile, JSON.stringify(obj, null, 2));
console.log(`\n通过校验（共 ${rounds} 轮）：${obj.sentences.length} 句 → ${outFile}`);
if (EN) {
  const me = metricsOfEn(obj.sentences.map((s) => s.text));
  console.log(`style: avg ${me.avgWords} words (example ${EXE.avgWords}), long ${me.longShare} (${EXE.longShare}), questions ${me.questionShare} (${EXE.questionShare}), colloquial ${me.colloquialShare} (${EXE.colloquialShare}), openers ${me.openerShare} (${EXE.openerShare})`);
  process.exit(0);
}
const m = metricsOf(obj.sentences.map((s) => s.text));
console.log(`风格指标：平均 ${m.平均字数} 字（范例 ${EX.平均字数}），长句占比 ${m["超过25字的句子占比"]}（${EX["超过25字的句子占比"]}），问句 ${m.问句占比}（${EX.问句占比}），连接词 ${m["含连接词/口语词的句子占比"]}（${EX["含连接词/口语词的句子占比"]}）`);
