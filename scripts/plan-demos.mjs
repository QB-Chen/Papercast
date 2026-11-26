// 找出旁白里所有"需要演示"的地方：举例子、打比方、讲故事、描述一连串动作、解释一个机制怎么运转。
// 每一处写清楚：哪几句、谁（角色）、做什么（动作顺序）、用到什么道具、结果或反应是什么。
//   node scripts/plan-demos.mjs <arXiv 编号> [--model sensenova/kimi-k3] [--scene hook]
// 结果写到 projects/<id>/narration/demos.json：{ "<场景id>": [ {from,to,kind,summary,actors,props,beats:[{at,what}]} ] }
// 之后：
//   - gen-storyboard 会把这份清单作为"必须演出来的片段"交给分镜模型
//   - 校验器按清单检查：这几句话上必须有一个动画镜头（自由动画或角色小剧场），而且动画事件要落在这些句子里
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { chatJson } from "./llm.mjs";
import { langOf } from "./lang.mjs";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--") && !/^sensenova\//.test(a));
if (!id) throw new Error("用法：node scripts/plan-demos.mjs <arXiv 编号> [--model ...] [--scene 场景id]");
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const model = flag("--model", "sensenova/kimi-k3");
const only = flag("--scene");
const root = `projects/${id}`;
const EN = langOf(id) === "en"; // 英文版：summary 和画面事件写英文；at 里的短语必须是英文旁白里连续出现的词
const LANG_EN = `

【语言：英文版（最高优先级，覆盖上面"中文""不含英文"的要求）】
旁白是英文。summary 和 beats[].what 用英文写（summary 不超过 140 个字符，不含阿拉伯数字）。beats[].at 写成 "句子id@短语"，短语必须是该句英文原文里**连续出现的 1~4 个单词**（照抄原文，大小写一致，不要改变单词形式）。actors[].as 写英文称呼（如 "chef"）。`;
const plan = JSON.parse(readFileSync(`${root}/plan.json`, "utf8").replace(/^\uFEFF/, ""));
const outFile = `${root}/narration/demos.json`;
const result = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
const chars = JSON.parse(readFileSync("src/story/chars.json", "utf8"));
const props = JSON.parse(readFileSync("src/story/props.json", "utf8"));

const SYSTEM = `你是科普视频的"画面导演助理"。你要通读一个场景的旁白，找出**所有需要用动画演出来的地方**。观众不能只听旁白，凡是旁白在做下面这些事的地方，画面都必须"演"出来：
1. 举例子（"举个例子""比如""假设"）：例子里的人、物、数、变化，要用动画摆出来。
2. 打比方、讲故事（"就像一个厨师""好比老师批改卷子"）：比喻里的角色要出场，做比喻里的动作，有反应。
3. 描述一连串动作或过程（"端出来给客人尝""先采样两个回答，再让人标注，再优化"）：每个动作要对应一个画面事件，按顺序发生。
4. 解释一个机制怎么运转（"概率先乘上权重再除以总数""差距被推开"）：要用图形把"变化"演出来：东西变大变小、移动、合并、分叉。
**不需要演示的**：纯过渡句（"好，我们接着看"）、纯结论、纯定义、提问引子、只在讲论文原图原表原式的句子（那些由论文图表镜头负责）。

每一处输出：
- from、to：起止句子 id（含）。一处最好管 1 到 4 句；连着的同一个例子合成一处。
- kind：example（举例）/ analogy（比喻）/ process（过程）/ mechanism（机制）。
- summary：一句话说清楚演什么（20 到 40 字）。
- actors：要出场的角色，从角色清单里选 id（没有人物的机制演示可以为空数组）；每个写成 {"id":"cook","as":"厨师"}。
- props：要用到的道具，从道具清单里选 id（食物、物品、表情等）；没有合适的就留空，不要硬凑。
- beats：按旁白先后的"画面事件"，每条 {"at":"句子id@句中的连续几个字","what":"这一刻画面上发生什么"}。at 里的短语必须是该句原文里**连续出现**的字；每一处至少 3 条 beats，要覆盖例子里的每个动作和反应（谁做了什么 → 对方的反应 → 结果）。
- 不能包含数字或英文（画面上只演形象，数量由旁白讲）。

只输出 JSON：{"demos":[{"from":"h2","to":"h2","kind":"analogy","summary":"…","actors":[{"id":"cook","as":"厨师"}],"props":["fork-and-knife-with-plate"],"beats":[{"at":"h2@读过全网菜谱","what":"…"}]}]}。
没有需要演示的句子就输出 {"demos":[]}。宁可多找，不要漏掉：一个场景里通常有 3 到 8 处。`;

function validate(sc) {
  const ids = sc.sentences.map((s) => s.id);
  const text = Object.fromEntries(sc.sentences.map((s) => [s.id, s.text]));
  const charIds = new Set(chars.map((c) => c.id));
  const propIds = new Set(props.map((p) => p.id));
  return (o) => {
    const errs = [];
    if (!Array.isArray(o?.demos)) return ['顶层必须是 {"demos":[…]}'];
    let prevTo = -1;
    o.demos.forEach((d, i) => {
      const w = `demos[${i}]`;
      const a = ids.indexOf(d.from), b = ids.indexOf(d.to);
      if (a < 0 || b < 0 || b < a) { errs.push(`${w} 的 from/to 不是有效的句子范围`); return; }
      if (a <= prevTo) errs.push(`${w} 和上一处重叠，请按先后顺序、不要重叠`);
      prevTo = b;
      if (b - a > 3) errs.push(`${w} 跨了 ${b - a + 1} 句，最多 4 句，请拆开`);
      if (!["example", "analogy", "process", "mechanism"].includes(d.kind)) errs.push(`${w}.kind 必须是 example/analogy/process/mechanism`);
      if (!d.summary || [...d.summary].length > (EN ? 140 : 60)) errs.push(`${w}.summary 必填，不超过 ${EN ? 140 : 60} 个${EN ? "字符" : "字"}`);
      if (EN ? /[0-9\u4e00-\u9fff]/.test(d.summary ?? "") : /[0-9A-Za-z]/.test(d.summary ?? "")) errs.push(`${w}.summary ${EN ? "不能含数字和中文，用英文写" : "不能含数字和英文"}`);
      for (const ac of d.actors ?? []) if (!charIds.has(ac.id)) errs.push(`${w}.actors 里「${ac.id}」不是可用角色`);
      for (const p of d.props ?? []) if (!propIds.has(p)) errs.push(`${w}.props 里「${p}」不是可用道具`);
      const bs = d.beats ?? [];
      if (bs.length < 3) errs.push(`${w}.beats 至少 3 条（现在 ${bs.length}）：每个动作、反应、结果各一条`);
      for (const [j, bt] of bs.entries()) {
        const m = String(bt.at ?? "").match(/^([^@]+)@(.+)$/);
        if (!m || !ids.slice(a, b + 1).includes(m[1])) errs.push(`${w}.beats[${j}].at 必须写成 句子id@短语，且句子在 ${d.from}~${d.to} 之内`);
        else if (!text[m[1]].includes(m[2])) errs.push(`${w}.beats[${j}].at 的短语「${m[2]}」不在句子 ${m[1]} 的原文里（必须是原文连续的字）`);
        if (!bt.what) errs.push(`${w}.beats[${j}].what 必填`);
      }
    });
    return errs;
  };
}

const narrationOf = (sid) => JSON.parse(readFileSync(`${root}/narration/${sid}.final.json`, "utf8").replace(/^\uFEFF/, ""));
for (const s of plan.scenes) {
  if (only && s.id !== only) continue;
  const n = narrationOf(s.id);
  const sc = { id: s.id, sentences: n.sentences };
  const user = `场景 id：${s.id}（${s.tag}）\n旁白（每句：id 和原文）：\n${n.sentences.map((x) => `${x.id} | ${x.text}`).join("\n")}\n\n可用角色：${chars.map((c) => `${c.id}（${c.zh}）`).join("、")}\n\n可用道具和表情：${props.map((p) => `${p.id}（${p.zh}）`).join("、")}`;
  const { obj, errors } = await chatJson(model, [{ role: "system", content: SYSTEM + (EN ? LANG_EN : "") }, { role: "user", content: user }], validate(sc), { maxRounds: 5, temperature: 0.4, maxTokens: 9000, tag: `demos-${s.id}`, timeoutMs: 900_000 });
  if (errors?.length) { console.log(`✗ ${s.id}：${errors.slice(0, 2).join("；")}`); continue; }
  result[s.id] = obj.demos;
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`✓ ${s.id}：${obj.demos.length} 处  ${obj.demos.map((d) => `${d.from}${d.to !== d.from ? "-" + d.to : ""}(${d.kind})`).join(" ")}`);
}
console.log(`→ ${outFile}`);
