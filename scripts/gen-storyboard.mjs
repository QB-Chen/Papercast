// 用大语言模型根据旁白稿设计动画分镜。
//   node scripts/gen-storyboard.mjs --in narration/pilot/ratio.revised.json --scene ratio --tag "② 比例尺的毛病" --model sensenova/sensenova-6.8-flash --out storyboards/ratio.sensenova-6.8-flash.json
// 旁白每句的 visual 字段是写稿时给出的画面意图,分镜设计要围绕它。校验失败会回喂给模型修改。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { chatJson } from "./llm.mjs";
import { langOf } from "./lang.mjs";
import { SOFT } from "./error-classes.mjs";
import { ELEMENT_DOC, buildElementDoc, stickerNames, syncEqx, validateStoryboard } from "./storyboard-schema.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const narr = JSON.parse(readFileSync(flag("--in"), "utf8"));
const scene = flag("--scene", "scene");
const project = flag("--project"); // 新流水线：--project <arXiv 编号>
const briefFile = flag("--brief", project ? `projects/${project}/briefs/${flag("--scene", "scene")}.md` : `briefs/${flag("--scene", "scene")}.md`);
const boardHint = existsSync(briefFile) ? (readFileSync(briefFile, "utf8").match(/\n## 画面建议([\s\S]*?)(?=\n## |$)/)?.[1] ?? "").trim() : "";
const tag = flag("--tag", scene);
const model = flag("--model", "sensenova/sensenova-6.8-flash");
const outFile = flag("--out", `storyboards/${scene}.${model.split("/")[1]}.json`);
const effort = flag("--effort"); // low / medium / high：部分模型（如 glm-5.3）推理太久会触发网关 300 秒超时，用 low 压低推理量
const extra = effort ? { reasoning_effort: effort } : {};
const stream = !args.includes("--no-stream"); // 默认流式：边生成边接收，实测可绕开网关 300 秒的整体超时（glm-5.3 推理 340 秒仍能完成）
const ids = narr.sentences.map((s) => s.id);
const LANG = project ? langOf(project) : (process.env.VIDEO_LANG ?? "zh");
const EN = LANG === "en";
// 英文版：旁白是英文，画面上的字也必须是英文；上面文档里写的"中文""字数"要求按这里的为准
const LANG_EN = `

【语言：英文版（最高优先级，覆盖上面所有"用中文""不含英文""N 字以内"的要求）】
旁白是英文视频。画面上出现的每一段文字（text、title、lines、label、tag、heading、card/compare 的字、canvas 和 free 里的 text/labels、角色的 say 和 tag、图的说明）都用简短的口语英文写，不要有中文。
- 字数上限已经按字符数放宽（约为文档里写的 2 倍多）：短标签尽量 1~3 个单词；角色台词 say 不超过 34 个字符；一行字太长会被缩小，看不清。
- 仍然不能写阿拉伯数字（画面是示意图，数字只由旁白讲；论文原图、原表、原公式里的数字除外），不能有括号、下划线、希腊字母。
- 所有"句子id@短语"形式的时间锚点，短语必须是该句英文原文里连续出现的单词，大小写、单词形式照抄。
- 角色 tag 用英文称呼（如 "Chef"、"Judge"），不超过 12 个字符。`;
// 项目模式：加载论文数据，只列出本场景会用到的公式、图、表；不使用 DRPO 专用的 leash / plot / 公式库
let paperCtx = null;
let DOC = ELEMENT_DOC;
let validateCtx = {};
if (project) {
  const pj = (n) => JSON.parse(readFileSync(`projects/${project}/paper/${n}.json`, "utf8"));
  paperCtx = { text: readFileSync(`projects/${project}/paper/paper.txt`, "utf8"), equations: pj("equations"), figures: pj("figures"), tables: pj("tables") };
  const plan = JSON.parse(readFileSync(`projects/${project}/plan.json`, "utf8"));
  const planScene = plan.scenes.find((s) => s.id === scene);
  const refs = planScene?.refs ?? {};
  var sceneFormulas = planScene?.formulas ?? [];
  DOC = buildElementDoc({ leash: false, drpoPlots: false, paper: paperCtx, eqIds: refs.eq ?? [], figIds: refs.fig ?? [], tableIds: refs.table ?? [] });
  validateCtx = { paper: paperCtx, formulas: sceneFormulas, rules: { objectStickers: [], metaphorLeash: false, springSemantics: false } };
}

const SYSTEM = `你是科普动画的分镜设计师。你要为一段旁白设计画面：在旁白的每一个关键节点，决定屏幕上出现什么。

设计原则：
1. 画面服务于理解：旁白在讲一个比喻，画面就画出这个比喻；旁白在讲一个数字对比，画面就把两个数字并排放；旁白在讲一个定义，画面就把名词和一个例子放在一起。
2. 节奏：约每 2 到 3 句旁白就应该有一次新的画面变化，不能让屏幕长时间不动。
3. 每个旁白的 visual 字段是文案作者给的画面意图，请尽量实现它，但要用下面提供的元素去表达，不能超出元素种类。
4. 同一时刻屏幕不要塞太多东西。一个概念，一个主画面。需要换话题时，在新元素上加 "clear": true 清空旧画面。
5. 善用贴图让画面生动：讲到蚂蚁就放 ant，大象就放 elephant，狗就放 dog-face 或 dog，剪刀就放 scissors，等等。
6. 数字要自洽：bars 的 value 必须符合真实比例；dots 的 marked/total 要对应旁白里说的比例。
7. **优先用有运动的元素（leash、grow）表达核心比喻和核心对比，不要用静态卡片代替。** 全片的比喻是"遛狗拉牵引绳"：只要旁白在讲狗、绳子、信任区域、越界、被拉住、被剪断，就用 leash，让狗和绳子随旁白动起来。只要旁白在对比"变化的比例"和"实际变化量"，就用 grow，让条随旁白长起来。
8. 一个场景里，运动元素应该是画面的主角，静态元素是配角。不要整场都是卡片和大字。
9. **画面里出现的每一个数字、模型名、模型规模、实验结果，都必须是旁白里说过的。** 不许自己编数字，不许编"某某模型多少亿参数""某方法得多少分"。旁白没给具体数值的比较（"更稳""更慢""较差"），不要用 bars 画成长短不一的条，用 compare、card 或 flow 来表达。
10. 同一个 leash 的 moves 必须落在不同的句子上。一个 leash 覆盖的这些句子里，不要再插入别的 C/L/R 镜头。
11. T 位置的大字如果带数字（比如"变化量 0.05，权重 0.5"），旁白换到下一个数字时必须再给一个新的 T 镜头更新它，不要让旧数字留在屏幕上讲新数字。
${DOC}
【可用贴图名】${stickerNames().join("、")}

只输出一个 JSON 对象（分镜），不要任何解释。`;

// 项目模式下，换掉 DRPO 专用的两条原则（遛狗比喻、leash/grow），加上论文原图的原则
const SYSTEM_FINAL = project
  ? SYSTEM.replace(/\n5\. [^\n]*/, "\n5. 善用贴图让画面生动（贴图名见清单），贴图要和旁白讲的东西有关，不要为了凑数乱放。")
      .replace(/\n7\. [^\n]*/, "\n7. **优先用有动画或有数据的元素（dist、numberline、eq、fig、table、chart、diagram、rows、dots、grow），不要用静态卡片代替。**旁白在讲论文里的某张图、某个表、某条公式时，必须直接用 fig / table / eq 把原图原表原式放到画面上。**旁白里打比方、讲故事、做对比、提问的地方，不要用大字或卡片，用 stage（角色小剧场）让人物演出来**：比喻里有谁就让谁出场（老师、厨师、评委、学生……），用动作、表情、一句短台词把意思演出来。**旁白在讲「某个量被推高、拉开、压低」「相对基准的变化」「一层层叠起来的过程」时，用 canvas（画布）：东西在同一块画布上随旁白长出来、移动，再被括号和圈标出来；不要写坐标，按说明书写 things 和 marks。**每个讲机制或比较的场景至少用一次 stage 或 canvas。**公式场景里，公式逐项讲解（eqx）之外，必须再用 canvas 的 free 自由动画把这条公式在做什么演示出来；任何版式装不下的内容也用 free 自己搭动画。总的原则：旁白讲的内容能变成动画演示的，就做成演示（用 canvas 的 line/bars/row/tree，或 stage），不要用 card、compare、flow、大字去转述；静态镜头只能当配角，占比不要超过三成。画面要一直有东西在动。**")
      .replace(/\n8\. [^\n]*/, "\n8. 一个场景里，动画和数据图应该是画面的主角，静态元素是配角。不要整场都是卡片和大字。")
  : SYSTEM;
/** 算出这条公式的 eqx 镜头该放在哪一句，以及占用到哪一句，写进提示，避免模型放的位置和程序自动对齐的位置撞车 */
function eqxHint(f) {
  const t = { beats: [{ kind: "eqx", eq: f.eq, at: narr.sentences[0].id }] };
  syncEqx(t, [f], narr.sentences);
  const e = t.beats[0];
  const last = e.partSteps[e.partSteps.length - 1].at;
  return `- ${f.eq}：${f.overview}（共 ${f.parts.length} 项：${f.parts.map((p) => p.name).join("、")}）→ {"kind":"eqx","slot":"C","eq":"${f.eq}","at":"${e.at}"}，占用 ${e.at} 到 ${last}`;
}
// 本场景旁白里"必须演出来"的片段（plan-demos 找出来的）：举例、比喻、一连串动作、机制
const demoList = (() => {
  if (!project) return [];
  const f = `projects/${project}/narration/demos.json`;
  if (!existsSync(f)) return [];
  const all = JSON.parse(readFileSync(f, "utf8"));
  return all[scene] ?? [];
})();
validateCtx.demos = demoList;
const demoHint = demoList.length
  ? `\n本场景有 ${demoList.length} 处旁白必须用动画演出来（不能只讲、不能用卡片或公式高亮代替）。每一处都要有一个 canvas（自由动画 form:"free"，需要人物时用 char 角色和 icon 道具）或 stage，把下面的"画面事件"按顺序演出来，镜头覆盖这几句：\n${demoList.map((d, i) => `${i + 1}. ${d.from}${d.to !== d.from ? "~" + d.to : ""}（${d.kind}）${d.summary}${d.actors?.length ? "；出场人物：" + d.actors.map((a) => a.as + "=" + a.id).join("、") : ""}${d.props?.length ? "；可用道具：" + d.props.join("、") : ""}\n${d.beats.map((b) => "   - " + b.at + "：" + b.what).join("\n")}`).join("\n")}\n（中央同一时刻只能放一个镜头。公式讲解 eqx 占用的句子里，演示要写在那个 eqx 的 insets 里；其余句子用 canvas 或 stage 镜头）\n`
  : "";
// 上一轮评审指出"没演到位"的片段：把缺了什么告诉模型，让它这次补上
const judgeNotes = (() => {
  if (!project) return "";
  const f = `projects/${project}/narration/demo-judge.json`;
  if (!existsSync(f) || process.env.NO_JUDGE_NOTES) return "";
  const j = JSON.parse(readFileSync(f, "utf8"))[scene] ?? [];
  const weak = j.filter((x) => x.verdict !== "ok");
  if (!weak.length) return "";
  return `\n上一版分镜评审后，下面这些演示还没演到位，这次必须补上（旁白里的每个动作和反应都要有对应的画面事件，不能只是东西冒出来或人站着说话）：\n${weak.map((x, i) => `${i + 1}. ${x.from}${x.to !== x.from ? "~" + x.to : ""} ${x.summary}\n   缺的：${x.missing}\n   上一版画面事件：${(x.events ?? []).slice(0, 8).join("；") || "（无）"}`).join("\n")}\n`;
})();
// 渲染后画面质检（qa-render.mjs）发现的 high 级毛病：告诉模型这次别再犯
const qaNotes = (() => {
  if (!project) return "";
  const f = `projects/${project}/qa-report.json`;
  if (!existsSync(f)) return "";
  const hs = (JSON.parse(readFileSync(f, "utf8")).defects ?? []).filter((d) => d.scene === scene && d.severity === "high");
  if (!hs.length) return "";
  return `\n上一版渲染成片后，画面质检发现下面这些观众会看错或看不懂的毛病，这次必须避免（常见原因：带文字的元素旋转或翻转导致文字倒置；前面讲别的东西用的贴图/图标没有用 until 退场，一直留到后面；元素互相盖住；关键元素太小）：\n${hs.map((d, i) => `${i + 1}. 句子 ${d.sid}：[${d.type}] ${d.what}`).join("\n")}\n`;
})();
const USER = `场景 id：${scene}
左上角标签 tag：${tag}

旁白稿（每句：id、旁白文字、画面意图）：
${narr.sentences.map((s) => `${s.id} | ${s.text} | 画面意图：${s.visual}`).join("\n")}

${typeof sceneFormulas !== "undefined" && sceneFormulas.length ? `\n本场景要逐项讲解的公式（每条都必须放一个 eqx 镜头；时间位置由程序按旁白算好，你必须原样使用下面给出的 at，并且在它占用的句子范围内，中央 C 位置不要放任何别的镜头，其他槽位可以放）：\n${sceneFormulas.map((f) => eqxHint(f)).join("\n")}\n` : ""}${boardHint ? `\n本场景的画面建议（请尽量采纳）：\n${boardHint}\n` : ""}${demoHint}${judgeNotes}${qaNotes}
请设计分镜。`;

console.log(`分镜模型 ${model}，旁白 ${ids.length} 句`);
// 质量类规则（画面够不够动、演示有没有演全、同类元素重复）和结构类规则（锚点存在、字段齐全、不出界、能渲染）分开：
// 轮数用完后只剩质量类问题就接受最好的一版并记下警告（后面的 motion 阶段会用模型写的动画替换演示片段，qa 阶段会检出还演不好的）；结构类问题仍然失败，换下一个模型
// "beats 至少 N 个"：模型第一版只给了一个镜头，校验在这一条上就提前返回，所以只有这 1 条错误——看起来"错误最少"，其实是最差的版本（什么都没设计）。权重给最大，避免 bestEffort 选中它
const errScore = (es) => es.reduce((a, e) => a + (/^beats 至少/.test(e) ? 1000 : SOFT.test(e) ? 1 : 10), 0);
const { obj, rounds, errors, partial } = await chatJson(
  model,
  [
    { role: "system", content: SYSTEM_FINAL + (EN ? LANG_EN : "") },
    { role: "user", content: USER },
  ],
  (o) => {
    if (typeof sceneFormulas !== "undefined" && sceneFormulas.length) syncEqx(o, sceneFormulas, narr.sentences);
    return validateStoryboard(o, ids, Object.fromEntries(narr.sentences.map((s) => [s.id, s.text])), { ...validateCtx, strictLayout: true, lang: LANG });
  },
  { maxRounds: 10, temperature: 0.6, maxTokens: 40000, tag: `board-${scene}`, timeoutMs: 1_800_000, extra, stream, bestEffort: true, errScore },
);

mkdirSync(dirname(outFile), { recursive: true });
if (!obj) {
  console.log(`\n${rounds} 轮后仍有问题：\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
if (partial) {
  const hard = errors.filter((e) => !SOFT.test(e));
  if (hard.length) {
    console.log(`\n${rounds} 轮后仍有结构类问题：\n- ${hard.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`\n⚠ ${rounds} 轮后还剩 ${errors.length} 条质量类问题（画面够不够动、演示演没演全），接受最好的一版并记下警告：\n- ${errors.join("\n- ")}`);
  writeFileSync(outFile.replace(/\.json$/, ".warnings.json"), JSON.stringify({ scene, model, errors }, null, 2));
}
obj.sceneId = scene;
writeFileSync(outFile, JSON.stringify(obj, null, 2));
const kinds = {};
for (const b of obj.beats) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
console.log(`\n通过校验（${rounds} 轮）：${obj.beats.length} 个镜头，元素分布 ${JSON.stringify(kinds)} → ${outFile}`);
