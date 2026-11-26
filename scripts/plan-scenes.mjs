// 读完整篇论文，规划视频的场景，并为每个场景写出"简报"(briefs)。
//   node scripts/plan-scenes.mjs <arXiv 编号> [--minutes 10] [--model sensenova/kimi-k3]
// 输入：projects/<id>/paper/ 下 fetch-paper 抓好的数据
// 输出：projects/<id>/plan.json、projects/<id>/briefs/<场景>.md
// 防编造：每条"论文事实"必须附一段论文原文摘录(quote)，校验器会在论文正文里逐条核对，找不到就打回重写。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chatJson } from "./llm.mjs";
import { langOf } from "./lang.mjs";

const args = process.argv.slice(2);
const id = args[0];
if (!id) throw new Error("用法：node scripts/plan-scenes.mjs <arXiv 编号> [--minutes 10] [--model …]");
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const minutes = +flag("--minutes", 10);
const EN = langOf(id) === "en"; // 英文版：给观众看的文字（标题、事实复述、举例、画面建议）都用英文写；校验里的字数上限换成字符数
const K = EN ? 2.6 : 1;
const model = flag("--model", "sensenova/kimi-k3");
const root = `projects/${id}`;
const meta = JSON.parse(readFileSync(`${root}/paper/meta.json`, "utf8"));
const paperText = readFileSync(`${root}/paper/paper.txt`, "utf8");
const equations = JSON.parse(readFileSync(`${root}/paper/equations.json`, "utf8"));
const figures = JSON.parse(readFileSync(`${root}/paper/figures.json`, "utf8"));
const tables = JSON.parse(readFileSync(`${root}/paper/tables.json`, "utf8"));
const exemplar = readFileSync(EN ? "prompts/style-exemplar-en.txt" : "prompts/style-exemplar.txt", "utf8").slice(0, 2500);

const norm = (s) => s.toLowerCase().replace(/\$/g, "").replace(/\s+/g, "");
const normPaper = norm(paperText);
// 每句平均多少秒：按实测。中文 121 句 → 成片 20.8 分钟（含句间停顿和场景留白）= 10.3 秒/句；DPO 116 句 → 19.9 分钟 = 10.3 秒/句；
// 旧值 7 秒/句会让 "10 分钟"的目标做成 20 分钟。英文按 2.4 词/秒、风格闸门要求的 ~20 词/句估 8.5 秒/句（英文版还没有完整成片的实测，做完要回来校准）
const SEC_PER_SENTENCE = 9.5; // 句长闸门收紧后（中文平均 ≤39 字、英文 ≤20 词）每句约 8.5 秒语音 + 句间停顿和场景留白；旧的松闸门下实测中文 10.3、英文 12.3 秒/句，没有用新闸门完整跑过，做完要回来校准
const TOTAL = Math.round((minutes * 60) / SEC_PER_SENTENCE);
const MAX_PAPER = 120000; // 技术报告常有十几万字；正文里的图表数字表也算在内
const paperForPrompt = paperText.length > MAX_PAPER ? paperText.slice(0, MAX_PAPER) + "\n……（后文省略）" : paperText;

const SYSTEM = `你是中文知识区科普视频的总编剧。你要读一篇论文，规划一支讲解视频：拆成若干场景，并为每个场景整理好"写旁白所需的论文事实"。
观众只有初中数学水平。旁白会由另一个写手按你的简报来写，所以简报必须准确、自足。

【规划原则】
1. 场景数 7 到 11 个，总句数约 ${TOTAL} 句（视频约 ${minutes} 分钟）。每个场景给出句数范围（如 "10-14"）。
2. 结构：开场（讲这篇论文解决什么问题，引起兴趣）→ 背景（观众需要先懂的前置知识，用生活例子）→ 旧方法的毛病 → 论文的核心方法（可拆成 2~3 个场景，难的地方单独成场景）→ 实验结果 → 消融或分析（如果论文有）→ 总结（必须诚实说局限）。
3. 如果有一个确实贴切的生活比喻，可以写进 metaphor，但它只是写手手里的一个工具：只在真正对得上的地方用，不要硬套、不要每个概念都回扣；找不到贴切的就写 null。
4. 每个场景的 facts：只写这一场景要讲的论文事实，6 到 14 条。每条包含：
   - zh：中文复述，一句话，包含具体数字（如果论文有）。
   - quote：论文原文里的一小段连续摘录（英文原文，10 到 200 个字符），要原样复制，不要改动、不要拼接、不要翻译。用来证明这条事实不是你编的。
   数字、模型名、方法名一定要和原文一致。论文用了 often、generally、in some cases 这类程度词，zh 里也要保留（"往往""通常""部分情况下"）。
5. refs：这个场景会用到的论文里的公式、图、表（只能用我给你的清单里的 id）。讲方法的场景选 1~4 条关键公式；讲实验的场景选对应的图和表。
6. 局限必须写在最后一个场景的 facts 里（论文里有 limitation / 只在某类任务上测过 之类的话，要如实引用）。
7. 每个场景给 examples（可以自己编的生活比喻和数字例子，旁白必须说明是"假设/举个例子"）、must（必须讲到的点，5~8 条）、avoid（本场景不要提前讲的内容）、board（画面建议：哪些句子适合用图、表、公式、数据图、架构图、数轴、分布图、清单……）。

【输出格式】只输出一个 JSON：
{"title":"视频标题（不超过 20 字）","metaphor":{"name":"比喻名","mapping":"一句话说明比喻里什么对应论文里的什么"} 或 null,"terms":["旁白里允许出现的英文缩写或模型名，如 PPO、GPT-4"],"scenes":[{"id":"英文小写场景名","prefix":"一个小写字母，场景间不重复","title":"场景标题（不超过 10 字）","tag":"左上角小标签（不超过 10 字）","goal":"这个场景要让观众听懂什么（两三句话）","sentences":"10-14","facts":[{"zh":"…","quote":"…"}],"refs":{"eq":["eq3"],"fig":["F2"],"table":["T1"]},"examples":["…"],"must":["…"],"avoid":["…"],"board":"画面建议","mustWords":["全文必须出现的关键词，2~4 个"]}]}
第一个场景 id 必须是 hook，最后一个必须是 out。`;

const USER = `【论文】《${meta.title}》
${paperForPrompt}

【可用的公式 id】
${equations.map((e) => `${e.id}${e.num ? " " + e.num : ""}：${e.tex.slice(0, 110)}`).join("\n")}

【可用的图 id】
${figures.filter((f) => f.file).map((f) => `${f.id}：${(f.caption ?? "").slice(0, 120)}`).join("\n")}

【可用的表 id】
${tables.map((t) => `${t.id}：${(t.caption ?? "").slice(0, 100)}`).join("\n")}

【风格范例（只看口吻，不要抄内容）】
${exemplar}

请规划视频，只输出 JSON。`;

function validate(p) {
  const errs = [];
  if (!p || !Array.isArray(p.scenes)) return ['顶层必须是 {"title":…,"scenes":[…]}'];
  if (p.scenes.length < 7 || p.scenes.length > 11) errs.push(`场景数是 ${p.scenes.length}，要求 7 到 11 个`);
  if (p.scenes[0]?.id !== "hook") errs.push("第一个场景的 id 必须是 hook");
  if (p.scenes.at(-1)?.id !== "out") errs.push("最后一个场景的 id 必须是 out");
  const ids = new Set();
  const prefixes = new Set();
  let total = 0;
  for (const sc of p.scenes) {
    const w = `场景 ${sc.id}`;
    if (!/^[a-z][a-z0-9]*$/.test(sc.id ?? "")) errs.push(`${w}：id 必须是英文小写`);
    if (ids.has(sc.id)) errs.push(`${w}：id 重复`);
    ids.add(sc.id);
    if (!/^[a-z]$/.test(sc.prefix ?? "")) errs.push(`${w}：prefix 必须是一个小写字母`);
    if (prefixes.has(sc.prefix)) errs.push(`${w}：prefix「${sc.prefix}」和别的场景重复`);
    prefixes.add(sc.prefix);
    const m = String(sc.sentences ?? "").match(/^(\d+)\s*[-~]\s*(\d+)$/);
    if (!m) errs.push(`${w}：sentences 要写成 "10-14" 这样的范围`);
    else total += (+m[1] + +m[2]) / 2;
    if ([...(sc.title ?? "")].length > 10 * K || !sc.title) errs.push(`${w}：title 不能为空，且不超过 ${10 * K} 个字符`);
    if ([...(sc.tag ?? "")].length > 10 * K || !sc.tag) errs.push(`${w}：tag 不能为空，且不超过 ${10 * K} 个字符`);
    const facts = sc.facts ?? [];
    if (facts.length < (sc.id === "hook" ? 3 : 5) || facts.length > 14) errs.push(`${w}：facts 需要 ${sc.id === "hook" ? 3 : 5} 到 14 条，现在 ${facts.length} 条`);
    facts.forEach((f, i) => {
      if (!f.zh || !f.quote) return errs.push(`${w}.facts[${i}] 需要 zh 和 quote`);
      const q = norm(f.quote);
      if (q.length < 12) errs.push(`${w}.facts[${i}].quote 太短，至少 10 个字符`);
      else if (!normPaper.includes(q)) errs.push(`${w}.facts[${i}]「${f.zh.slice(0, 24)}…」的 quote 在论文里找不到：「${f.quote.slice(0, 80)}」。quote 必须从论文正文原样复制一小段连续文字`);
    });
    for (const [k, list, label] of [["eq", equations, "公式"], ["fig", figures, "图"], ["table", tables, "表"]]) {
      for (const r of sc.refs?.[k] ?? []) if (!list.some((x) => x.id === r)) errs.push(`${w}.refs.${k} 里的「${r}」不是论文里的${label} id`);
    }
    if (!(sc.must?.length >= 3)) errs.push(`${w}：must 至少 3 条`);
    if (!sc.board) errs.push(`${w}：缺少 board 画面建议`);
    if (!(sc.mustWords?.length >= 1)) errs.push(`${w}：mustWords 至少 1 个`);
    // 旁白写手有硬规则：中文旁白里数字一律写汉字、英文只允许缩写和单个名字，所以 mustWords 不能带阿拉伯数字、也不能是多个英文单词的名字
    if (!EN) for (const mw of sc.mustWords ?? []) {
      if (/\d/.test(mw.replace(/[A-Za-z][A-Za-z0-9\-]*/g, ""))) errs.push(`${w}.mustWords 里的「${mw}」含阿拉伯数字：旁白里数字要写成汉字，这个词永远满足不了，请换成不含数字的词`);
      else if (!/[\u4e00-\u9fff]/.test(mw) && (mw.match(/[A-Za-z][A-Za-z0-9\-]*/g) ?? []).length >= 2) errs.push(`${w}.mustWords 里的「${mw}」是多个英文单词：中文旁白里不允许出现英文单词，请换成中文名或单个缩写`);
    }
  }
  if (Math.abs(total - TOTAL) > TOTAL * 0.25) errs.push(`各场景句数范围的中间值加起来是 ${Math.round(total)} 句，目标 ${TOTAL} 句（允许 ±25%）`);
  return errs;
}

console.log(`规划场景：${meta.title}，目标 ${minutes} 分钟（约 ${TOTAL} 句），模型 ${model}`);
const LANG_EN = `

【语言：英文版（最高优先级，覆盖上面所有"中文"的要求）】
这是一支英文视频。所有会进入视频或交给旁白写手的文字都必须用自然的英文写：title、tag、goal、facts[].zh（字段名仍叫 zh，但内容写英文复述）、examples、must、avoid、board、metaphor.name 和 mapping、mustWords。
- 视频标题不超过 ${20 * K} 个字符；场景 title 和 tag 不超过 ${10 * K} 个字符（短语，不要整句）。
- facts[].zh 是一句话的英文复述，保留具体数字和程度词（often、typically、in some cases），用 "about" "roughly" 这类词时也要和论文一致。quote 仍然是论文原文的原样摘录。
- mustWords：旁白里必须出现的英文词（模型名、方法名、关键术语，大小写和论文一致），2 到 4 个，每个不超过 2 个单词，用论文里的原写法。
- terms：旁白里允许出现的缩写，可以留空数组。
- 其余结构、数量、id 规则不变（场景 id 和 prefix 仍是英文小写字母）。`;
const { obj, rounds, errors } = await chatJson(model, [{ role: "system", content: SYSTEM + (EN ? LANG_EN : "") }, { role: "user", content: USER }], validate, {
  maxRounds: 5,
  temperature: 0.4,
  maxTokens: 16000,
  tag: "plan",
  stream: true,
  timeoutMs: 1_800_000,
});
if (!obj) {
  console.log(`\n${rounds} 轮后仍有问题：\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

// ---- 写 plan.json 和各场景简报 ----
mkdirSync(`${root}/briefs`, { recursive: true });
obj.lang = langOf(id); // 之后所有阶段（旁白、动画、质检）都按这个语言走
writeFileSync(`${root}/plan.json`, JSON.stringify(obj, null, 2));
const sc = obj.scenes;
sc.forEach((s, i) => {
  const prev = sc[i - 1];
  const next = sc[i + 1];
  const refsTxt = [
    s.refs?.eq?.length ? `公式：${s.refs.eq.join("、")}` : "",
    s.refs?.fig?.length ? `图：${s.refs.fig.join("、")}` : "",
    s.refs?.table?.length ? `表：${s.refs.table.join("、")}` : "",
  ].filter(Boolean).join("；");
  const md = `# 场景简报：${s.title}（id 前缀 ${s.prefix}）
## 这个场景要完成的任务
${s.goal}
## 前后文
- ${prev ? `上一个场景「${prev.title}」：${prev.goal}` : "这是开场，没有上文。"}
- ${next ? `下一个场景「${next.title}」：${next.goal}。本场景不要提前讲它的内容。` : "这是全片最后一个场景。"}
${obj.metaphor ? `- 贯穿比喻（可选，只在真正对得上的地方用一两次，别硬回扣）：${obj.metaphor.name}。${obj.metaphor.mapping}\n` : ""}## 论文事实（只能引用这里的内容，不得补充别的论文结论）
${s.facts.map((f, i) => `${i + 1}. ${f.zh}`).join("\n")}
## 可以自己编的举例（必须说明是"举个例子/假设"）
${(s.examples ?? []).map((e) => `- ${e}`).join("\n") || "- 无"}
## 必须覆盖的点
${s.must.map((m) => `- ${m}`).join("\n")}
## 禁止
${(s.avoid ?? []).map((m) => `- ${m}`).join("\n")}
- 不要编造论文里没有的数字、实验结果、作者的话。
- 不要写"我在网上看到"这类个人经历。
## 画面建议
${s.board}${refsTxt ? `\n- 本场景可用的论文素材：${refsTxt}。讲到它们时优先用 fig / table / eq 元素直接展示。` : ""}
## 校验
句数: ${s.sentences}
必须出现: ${s.mustWords.join(", ")}
允许英文: ${(obj.terms ?? []).join(", ")}
`;
  writeFileSync(`${root}/briefs/${s.id}.md`, md);
});
console.log(`\n通过校验（${rounds} 轮）：${sc.length} 个场景，facts 共 ${sc.reduce((a, s) => a + s.facts.length, 0)} 条，每条都已在论文里核对到原文`);
console.log(sc.map((s) => `  ${s.prefix} ${s.id}：${s.title}（${s.sentences} 句，${s.facts.length} 条事实）`).join("\n"));
console.log(`→ ${root}/plan.json 和 ${root}/briefs/`);
