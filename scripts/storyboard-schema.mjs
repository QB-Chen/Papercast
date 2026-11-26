// 分镜脚本的校验器与"给模型看的元素说明书"。字段约定与 src/story/types.ts 保持一致。
import { readdirSync, readFileSync } from "node:fs";
import { compileCanvas, estimateSec, eventTimes } from "./canvas-compile.mjs";
import { CANVAS_DOC } from "./canvas-doc.mjs";
import { validateFree } from "./free-validate.mjs";
import { sanitizeHtml, scopeCss, checkScript } from "../src/story/motion-runtime.mjs";

export const SLOTS = ["T", "C", "L1", "L2", "R1", "R2"];
export const KINDS = ["text", "card", "formula", "compare", "dots", "bars", "flow", "sticker", "leash", "grow", "title", "dist", "numberline", "plot", "eq", "rows", "fig", "table", "chart", "diagram", "eqx", "stage", "stream", "paperbar", "canvas"];
const RICH_ONLY_C = ["title", "dist", "numberline", "plot", "eq", "rows", "fig", "table", "chart", "diagram", "eqx", "stage", "stream", "canvas"]; // paperbar 放 T 位置，不在这里
const FOCUS_NAMES = ["all", "left", "right", "top", "bottom", "tl", "tr", "bl", "br", "center"];
const DEFAULT_OBJECT_STICKERS = [
  { word: "蚂蚁", stickers: ["ant"] },
  { word: "大象", stickers: ["elephant"] },
  { word: "剪切", stickers: ["scissors"] },
  { word: "剪掉", stickers: ["scissors"] },
  { word: "天平", stickers: ["balance-scale"] },
];
export const EQLIB = JSON.parse(readFileSync("src/story/eqlib.json", "utf8"));
export const CHARS = JSON.parse(readFileSync("src/story/chars.json", "utf8"));
export const TONES = ["teal", "orange", "pink", "navy", "gray"];

export const stickerNames = () => readdirSync("public/stickers").filter((f) => f.endsWith(".svg")).map((f) => f.replace(/\.svg$/, "")).sort();

/** 给模型看的说明书 */
const BASE_DOC = `
【画面位置 slot】画布分成这几个位置，每个位置同一时刻只显示一个元素，后出现的会替换前面的（所以不会重叠）：
- T：顶部横条（高度小）。适合放一句结论、一个关键词。
- C：整屏中央的大区域。适合放大对比、流程、点阵、公式。
- L1 左上、L2 左下、R1 右上、R2 右下：四个小格子。可以同时显示左右两边的东西。
- 互斥：放 C 会清掉 L1/L2/R1/R2；放 L/R 会清掉 C。T 不受影响。
- 想"一次性换掉所有内容"，在新元素上加 "clear": true。

【元素 kind 及字段】（tone 可选：teal青绿 orange橙 pink玫红 navy深蓝 gray灰）
1. text：一句大字。{"kind":"text","text":"对小词**太严**，对大词太松"}  ——用 **双星号** 标出要强调的词。
2. card：卡片，标题+要点，可带贴图。{"kind":"card","title":"…","lines":["…","…"],"sticker":"贴图名"}  ——lines 最多 3 行，每行不超过 16 字。
3. formula：公式或算式。{"kind":"formula","formula":"新概率 ÷ 旧概率 = {{倍数}}","note":"可选的一句说明"}  ——用 {{ }} 标出要高亮的部分。可以用中文、数字、+ − × ÷ = 等符号，不超过 30 字。
4. compare：左右两个对比。{"kind":"compare","left":{"title":"蚂蚁","sticker":"ant","big":"×2","small":"实际只多千分之一","tone":"pink"},"right":{…},"vs":"VS"}  ——适合在 C 位置。big 是大号数字或短词（不超过 8 字），small 是一行小字（不超过 14 字）。
5. dots：用一堆圆点直观表示"一共多少个，其中几个被标出"。{"kind":"dots","total":100,"marked":1,"label":"一百个球里，摸中红球的机会","unitNote":"可选，如：每个点代表十个球"}  ——total 最多 200；适合解释概率、占比、比例。
6. bars：几根横条对比大小。{"kind":"bars","items":[{"label":"旧概率","value":0.5,"display":"百分之五十","tone":"teal"},{"label":"新概率","value":0.6,"display":"百分之六十","tone":"orange"}]}  ——value 是 0 到 1 的长度比例，所以数值要按真实比例给；2 到 4 根。
7. flow：一串步骤用箭头连起来。{"kind":"flow","steps":[{"text":"新概率","sticker":"可选"},{"text":"除以旧概率"},{"text":"得到倍数"}]}  ——适合在 C 位置，2 到 4 步，每步不超过 8 字。
8. sticker：一到三个大贴图，可带说明。{"kind":"sticker","stickers":[{"name":"dog-face","caption":"模型"},{"name":"chains","caption":"信任区域"}]}

9. leash（运动）：人牵着狗，狗在"信任区域"这个圈里/边界/圈外移动，绳子会松垂、绷直、变弹簧、被剪断。**讲到狗、牵引绳、信任区域、越界、被拉回、被剪断时，优先用它，而不是静态卡片。**
   {"kind":"leash","slot":"C","circleLabel":"信任区域","moves":[{"at":"r13","dog":"inside","line":"slack","label":"在圈里，绳子松松的"},{"at":"r14","dog":"edge","line":"taut","label":"到边界，绳子绷直"},{"at":"r15","dog":"outside","line":"cut","label":"硬剪切：直接撒手"}]}
   - moves 里每一项在对应句子开始说的时候切换状态，狗会平滑移动过去。至少 2 项，最多 6 项，at 必须是旁白里的句子 id，且按时间顺序。
   - dog：inside 圈内 / edge 边界上 / outside 刚出圈 / far 跑远了。
   - line：slack 松垂 / taut 绷直 / spring 弹簧 / cut 剪断（带剪刀）。**语义要对**：slack 表示在范围内自由；taut 表示到了边界、被拉住；cut 表示 PPO/GRPO/DPPO 的“硬剪切”（越界后梯度直接清零，等于撒手不管）；**spring 只用来表示 DRPO 的“平滑纠正”（越界后被一股渐增的力拽回来），不能用来表示 PPO、GRPO、DPPO 的剪切**。如果旁白讲的是剪切、清零、不再更新，就用 cut，不要用 spring。
   - label：每个状态下方的一句短说明，不超过 14 字。circleLabel 是圈上方的字，默认"信任区域"。
   - 只能放在 C 位置。
10. grow（运动）：同一把尺子（0 到 scale）下，几行数值从旧值长到新值，并自动显示"比例变成几倍"和"实际多了几个百分点"。**讲"变化的比例"和"实际变化量"的区别时，用它。**
   {"kind":"grow","slot":"C","scale":1,"animAt":"r21","rows":[{"label":"蚂蚁","sticker":"ant","from":0.001,"to":0.002,"tone":"pink"},{"label":"大象","sticker":"elephant","from":0.5,"to":0.6,"tone":"orange"}]}
   - from/to 是真实数值（0 到 scale 之间的小数，比如千分之一就写 0.001），不要为了好看而放大。程序会按真实比例画出条的长度，并自己算出"×几倍"和"+几个百分点"，你不要自己写这些文字。
   - animAt 是条开始增长的那句旁白的 id（可省略，默认就是这个镜头出现的那句）。
   - rows 1 到 3 行；label 不超过 8 字；sticker 可选。只能放在 C 位置。
【分镜整体结构】
{"sceneId":"…","tag":"左上角小标签，如：② 比例尺的毛病","heading":{"text":"本场景标题（不超过 12 字）","sticker":"可选贴图名","at":"出现在哪句话"},"beats":[{"at":"句子id","slot":"C","kind":"…", …}]}
- 每个 beat 的 at 必须是旁白里真实存在的句子 id，该元素在这句话开始说的时候出现。
- 所有文字都用中文说法，可以出现数字。不要出现希腊字母。
`;

const RICH_DOC = `
11. title（标题页）：大标题 + 一行副标题 + 论文信息卡。**只用于开场或结尾。**
   {"kind":"title","slot":"C","title":"DRPO","text":"给信任区域换个新设计","sticker":"sparkles","paper":true}
   - title 不超过 12 字，text 不超过 16 字；paper 为 true 时自动显示论文题目、腾讯混元、arXiv 编号，你不用写。
12. dist（概率分布柱状图）：几个词的概率，从旧值变成新值；或者画"长尾词表"。**讲"模型给每个词一个概率""每更新一步概率会变""词表是长尾的"时用它。**
   a) 旧→新：{"kind":"dist","slot":"C","tokens":[{"label":"字甲","old":0.5,"new":0.58},{"label":"字乙","old":0.3,"new":0.25},{"label":"字丙","old":0.2,"new":0.17}],"newAt":"b9","highlight":[0],"label":"每更新一步，概率都会动一点"}
      tokens 2 到 6 个，label 不超过 4 字，old 和 new 是 0 到 1 的概率，old 之和、new 之和都不能超过 1；newAt 是柱子开始变化的那句旁白；画面自动标注"举例，数字是假设的"。label 不超过 22 字。
   b) 长尾示意：{"kind":"dist","slot":"C","preset":"longtail","label":"旧概率不超过百分之一的词：占百分之七点八"}
      自动画出"头部几根很高、后面拖着一长串很矮的尾巴"，尾巴自动标红，画面自动标注"示意图"。label 不超过 24 字。
13. numberline（数轴）：一条带刻度的数轴，贴图小人/动物站在上面，从旧值走到新值，程序自动算出"比例×几"和"变了几个百分点"。**要说明"同一把尺子量不同的词"、"绝对变化 vs 比例"、"允许范围"时用它。**
   {"kind":"numberline","slot":"C","axis":{"min":0,"max":1,"step":0.1,"fmt":"pct"},"points":[{"at":"d5","label":"蚂蚁","sticker":"ant","from":0.001,"to":0.002,"tone":"pink"},{"at":"d7","label":"大象","sticker":"elephant","from":0.5,"to":0.6,"tone":"orange"}]}
   - points 1 到 3 个；at 是该点出现并开始移动的句子；from/to 必须是旁白里说过的真实数值（程序会核对）；label 不超过 6 字。
   - 可选 band：在数轴上标出"允许范围"，两端自动画上剪刀。{"band":{"from":0.8,"to":1.28,"label":"允许范围"}}，此时 axis 常用 {"min":0,"max":2,"step":0.5,"fmt":"num"}。label 不超过 10 字。
   - 也可以只放一个点不动（不写 to）。
14. plot（函数曲线图）：由程序按论文公式画曲线，你只选预设、选哪些曲线在哪一句出现、圆点在哪一句移到哪个位置。**讲"权重随变化量怎么变""SPO 和 DRPO 的权重对比"时用它。**
   a) preset="weight"：横轴是概率变化量 D（以阈值 δ 为单位，0 到 1.6），纵轴是梯度权重 w。可选曲线：out（往外冲：w = 1 − D/δ，到边界为 0，越界变负）、in（往回走：w = 1 + D/δ）、mask（DPPO 硬掩码：到边界突然归零）。
      {"kind":"plot","slot":"C","preset":"weight","delta":0.1,"curves":[{"id":"mask","at":"p13"},{"id":"out","at":"p13"},{"id":"in","at":"p18"}],"marks":[{"at":"p15","x":0.5,"on":"out"},{"at":"p16","x":1,"on":"out"},{"at":"p17","x":1.5,"on":"out"}]}
      marks 里 x 是 D/δ（比如阈值 0.1、变化量 0.05，x 就是 0.5）；delta 是旁白里的阈值，写了就会显示真实的 D；on 选圆点落在哪条曲线上。x×delta 必须是旁白在这句话前后讲过的数字（程序会核对），x=1 表示边界。
   b) preset="blowup"：横轴是旧概率 μ（0 到 1），纵轴是同样的概率变化量下权重被改变的幅度。曲线：spo（旧概率越小越失控）、drpo（始终有界）。
      {"kind":"plot","slot":"C","preset":"blowup","curves":[{"id":"spo","at":"s9"},{"id":"drpo","at":"s11"}],"marks":[{"at":"s10","x":0.5,"on":"spo"},{"at":"s10b","x":0.05,"on":"spo"}]}
   - curves 至少 1 条，at 是该曲线开始画出的句子；marks 最多 4 个，按时间顺序，圆点会平滑滑过去。
15. eq（推导步骤栈）：把论文里的公式一行一行叠起来，每行在对应句子弹出，最新一行高亮。**讲公式、推导时必须用它，不要自己写公式。** 公式只能从下面的库里按 id 选：
${Object.entries(EQLIB).map(([k, v]) => `      ${k}：${v.title}  ${v.formula.replace(/[{}]/g, "")}`).join("\n")}
   {"kind":"eq","slot":"C","eqs":[{"at":"v2","ref":"dppo_bound"},{"at":"v6","ref":"ratio_bound","note":"μ 越小范围越宽"}]}
   - eqs 1 到 4 行，at 是该行弹出的句子，note 可选不超过 12 字。同一个 eq 镜头里的行会一直留在屏幕上，所以 eq 镜头占用的时间段内不要再放别的 C 镜头。
16. rows（清单）：一列条目，逐条弹出，可以给每条打 ✓ ✗ ⚠。**讲"测了哪些模型""哪些方法表现如何""几点结论"时用它。**
   {"kind":"rows","slot":"C","list":[{"at":"e1","label":"Qwen3-4B-Base","sub":"稠密 · 40 亿参数","sticker":"robot"},{"at":"e7","label":"GRPO 和 SPO","sub":"基于比例","status":"bad","verdict":"训练不稳"}]}
   - list 2 到 6 条；label 不超过 18 字，sub 不超过 20 字，verdict 不超过 10 字；status 可选 ok / bad / warn / idea，statusAt 是标记打上去的句子（省略则在条目出现后一小会儿）；sticker 可选。
   - 每条的文字都必须是旁白里说过的事实，不要自己补充数据。
【怎么选元素】
- 想让画面"动起来、有信息量"：优先 leash、grow、dist、numberline、plot、eq、rows、dots。card 和 text 只能做配角。
- 同一个场景里不要反复用同一种元素；相邻两个中央镜头不要同一种元素；card 全场景最多 2 张；sticker 最多 2 张。
- 一个镜头里可以有多个变化（eq 的多行、plot 的多条曲线和圆点、numberline 的多个点、rows 的多条），请充分利用，让一个画面讲更多事，而不是每句话换一张卡片。
`;

export const ELEMENT_DOC = BASE_DOC.replace("【分镜整体结构】", RICH_DOC + "【分镜整体结构】");

const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 把常见的中文数字写法解析成 0~1 之间的小数。认不出来返回 null。
 *  支持：千分之一 / 百分之五十 / 百分之七点八 / 零点二八 / 五成 / 一半 / 阿拉伯数字（0.5、50%、1/1000） */
export function parseChineseNumber(s) {
  if (!s) return null;
  const str = String(s).replace(/\s/g, "");
  let m = str.match(/^(\d+(?:\.\d+)?)%$/);
  if (m) return +m[1] / 100;
  m = str.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return +m[1];
  m = str.match(/^(\d+)\/(\d+)$/);
  if (m) return +m[1] / +m[2];
  const cn = (t) => {
    // 简单中文数字：一、十、二十、五十、一百……（只处理到一百）
    if (t === "百" || t === "一百") return 100;
    if (t === "千" || t === "一千") return 1000;
    if (/^[零〇一二三四五六七八九]$/.test(t)) return DIGIT[t];
    let mm = t.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
    if (mm) return (mm[1] ? DIGIT[mm[1]] : 1) * 10 + (mm[2] ? DIGIT[mm[2]] : 0);
    return null;
  };
  const dec = (t) => {
    // 「七点八」「零点二八」
    const mm = t.match(/^([零〇一二三四五六七八九十]+)点([零〇一二三四五六七八九]+)$/);
    if (!mm) return cn(t);
    const head = mm[1] === "十" ? 10 : cn(mm[1]);
    if (head == null) return null;
    let frac = 0;
    [...mm[2]].forEach((d, i) => (frac += DIGIT[d] / Math.pow(10, i + 1)));
    return head + frac;
  };
  m = str.match(/^(千|百|万)分之(.+)$/);
  if (m) {
    const denom = { 千: 1000, 百: 100, 万: 10000 }[m[1]];
    const num = dec(m[2]);
    return num == null ? null : num / denom;
  }
  m = str.match(/^(.+)成$/);
  if (m) {
    const num = dec(m[1]);
    return num == null ? null : num / 10;
  }
  if (str === "一半") return 0.5;
  m = str.match(/^零点([零〇一二三四五六七八九]+)$/);
  if (m) return dec(`零点${m[1]}`);
  m = str.match(/^[零〇一二三四五六七八九十]+点[零〇一二三四五六七八九]+$/);
  if (m) return dec(str);
  return null;
}

/** 从一段文字里取出其中的数字。先整体解析，不行就在文字里找形如"千分之一""百分之五十""零点二五""50%"的片段 */
export function extractNumber(s) {
  const whole = parseChineseNumber(s);
  if (whole != null) return whole;
  const m = String(s ?? "").match(/(?:千|百|万)分之[零〇一二三四五六七八九十点]+|零点[零〇一二三四五六七八九]+|\d+(?:\.\d+)?%|[零〇一二三四五六七八九十]+点[零〇一二三四五六七八九]+/);
  return m ? parseChineseNumber(m[0]) : null;
}

/** 从若干句旁白里取出所有数字(千分之一、百分之五十、零点零五、一点二……) */
export function numbersIn(text) {
  const re = /(?:千|百|万)分之[零〇一二三四五六七八九十点]+|[零〇一二三四五六七八九十]+点[零〇一二三四五六七八九]+|[一二三四五六七八九十]+成|一半|\d+(?:\.\d+)?%?/g;
  return (String(text ?? '').match(re) ?? []).map((m) => parseChineseNumber(m)).filter((v) => v != null);
}

let LANG_S = "zh"; // validateStoryboard 开头按 ctx.lang 设置：英文版画面文字用英文，字数上限按字符数放宽（英文一个字符比汉字窄）
const KS = () => (LANG_S === "en" ? 2.2 : 1);

/** 校验分镜;sentenceIds 为本场景旁白的句子 id 列表 */
export function validateStoryboard(story, sentenceIds, sentenceTexts = {}, ctx = {}) {
  // ctx.paper = { text, equations, figures, tables }；ctx.rules = { objectStickers, metaphorLeash, springSemantics }。不传时沿用 DRPO 这支视频的规则
  const rules = { objectStickers: DEFAULT_OBJECT_STICKERS, metaphorLeash: true, springSemantics: true, ...(ctx.rules ?? {}) };
  const paper = ctx.paper ?? null;
  LANG_S = ctx.lang === "en" ? "en" : "zh";
  const errs = [];
  const ids = new Set(sentenceIds);
  const stickers = new Set(stickerNames());
  if (!story || typeof story !== "object") return ["顶层必须是对象"];
  if (typeof story.tag !== "string" || !story.tag.trim()) errs.push("缺少 tag");
  if (story.heading) {
    if (!ids.has(story.heading.at)) errs.push(`heading.at 引用了不存在的句子 ${story.heading.at}`);
    if ([...(story.heading.text ?? "")].length > Math.round(14 * KS())) errs.push(`heading.text 太长（${[...story.heading.text].length} 字，上限 ${Math.round(14 * KS())}）`);
    if (story.heading.sticker && !stickers.has(story.heading.sticker)) errs.push(`heading.sticker 不存在：${story.heading.sticker}`);
  }
  // 有公式逐项讲解（eqx）的场景，eqx 会占住中央位置很长一段，其他镜头放不进去，要求 6 个几乎无解：这类场景至少 3 个
  const minBeats = (ctx.formulas?.length || (story.beats ?? []).some((b) => b?.kind === "eqx")) ? 3 : 6;
  if (!Array.isArray(story.beats) || story.beats.length < minBeats) return [...errs, `beats 至少 ${minBeats} 个`];

  const checkSticker = (name, where) => {
    if (name && !stickers.has(name)) errs.push(`${where} 的贴图 "${name}" 不存在。可用贴图：${[...stickers].join("、")}`);
  };
  const tooLong = (s, max, where) => {
    const mx = Math.round(max * KS());
    // 英文版：画面文字是普通英文，LaTeX 源码（C_{l}、\\mu）不会被渲染，会原样显示出来；符号要用读法（"C sub l"）或直接用公式镜头
    if (LANG_S === "en" && /[_{}\\^]/.test(String(s ?? "").replace(/\*\*/g, ""))) errs.push(`${where} 里有 LaTeX 记号（_ { } \\ ^）：「${s}」。画面文字是普通英文，这些符号会原样显示出来，请改成读法或去掉`);
    if ([...(s ?? "")].length > mx) errs.push(`${where} 太长（${[...s].length} 字，上限 ${mx}）：「${s}」`);
  };

  story.beats.forEach((b, i) => {
    const w = `beats[${i}]（at=${b.at}）`;
    if (!ids.has(b.at)) errs.push(`${w} 引用了不存在的句子 id`);
    if (!SLOTS.includes(b.slot)) errs.push(`${w} 的 slot 不合法：${b.slot}`);
    if (!KINDS.includes(b.kind)) errs.push(`${w} 的 kind 不合法：${b.kind}`);
    if (b.tone && !TONES.includes(b.tone)) errs.push(`${w} 的 tone 不合法：${b.tone}`);
    const smallSlot = ["L1", "L2", "R1", "R2"].includes(b.slot);
    if (b.slot === "T" && !["text", "formula", "paperbar"].includes(b.kind)) errs.push(`${w}：T 位置太矮，只能放 text、formula 或 paperbar`);
    if (b.kind === "paperbar" && b.slot !== "T") errs.push(`${w}：paperbar（论文条）只能放在 T 位置`);
    if (smallSlot && ["compare", "flow", "dots", "leash", "grow", ...RICH_ONLY_C].includes(b.kind)) errs.push(`${w}：${b.kind} 太大，请放在 C 位置`);
    if (b.slot === "T" && ["leash", "grow", ...RICH_ONLY_C].includes(b.kind)) errs.push(`${w}：${b.kind} 只能放在 C 位置`);
    switch (b.kind) {
      case "text":
        if (!b.text) errs.push(`${w} text 元素缺少 text`);
        tooLong(b.text?.replace(/\*\*/g, ""), 28, `${w}.text`);
        break;
      case "card":
        if (!b.title && !(b.lines?.length)) errs.push(`${w} card 需要 title 或 lines`);
        if ((b.lines?.length ?? 0) > 3) errs.push(`${w}.lines 最多 3 行`);
        tooLong(b.title, 16, `${w}.title`);
        (b.lines ?? []).forEach((l, j) => tooLong(l.replace(/\*\*/g, ""), 18, `${w}.lines[${j}]`));
        checkSticker(b.sticker, w);
        break;
      case "formula":
        if (!b.formula) errs.push(`${w} formula 元素缺少 formula`);
        tooLong(b.formula?.replace(/\{\{|\}\}/g, ""), 30, `${w}.formula`);
        tooLong(b.note, 24, `${w}.note`);
        break;
      case "compare":
        for (const side of ["left", "right"]) {
          const s = b[side];
          if (!s?.title) errs.push(`${w}.${side} 缺少 title`);
          else {
            tooLong(s.title, 8, `${w}.${side}.title`);
            tooLong(s.big, 8, `${w}.${side}.big`);
            tooLong(s.small, 14, `${w}.${side}.small`);
            checkSticker(s.sticker, `${w}.${side}`);
          }
        }
        break;
      case "dots":
        if (!(b.total >= 2 && b.total <= 200)) errs.push(`${w}.total 必须在 2 到 200 之间`);
        if (!(b.marked >= 0 && b.marked <= b.total)) errs.push(`${w}.marked 必须在 0 到 total 之间`);
        tooLong(b.label, 24, `${w}.label`);
        break;
      case "bars":
        if (!Array.isArray(b.items) || b.items.length < 2 || b.items.length > 4) errs.push(`${w}.items 需要 2 到 4 项`);
        (b.items ?? []).forEach((it, j) => {
          if (!(it.value >= 0 && it.value <= 1)) errs.push(`${w}.items[${j}].value 必须在 0 到 1 之间`);
          tooLong(it.label, 8, `${w}.items[${j}].label`);
          tooLong(it.display, 8, `${w}.items[${j}].display`);
          // 条长必须和标注的数字相符:能解析出数值的，必须与 value 一致（允许 15% 的相对误差，或绝对误差 0.01）
          // display 必须带一个来自旁白的具体数字，否则条的长度就是凭空编的（如"较差/最好/中途掉头"）
          const real = extractNumber(it.display);
          if (real == null) {
            errs.push(
              `${w}.items[${j}]：display「${it.display}」里没有具体数字，条的长度就没有依据。bars 每一项的 display 必须写旁白里出现过的数字（如"百分之五十""零点二五"），` +
                `没有具体数字可比时，请改用 compare、card 或 flow，不要用 bars`,
            );
          } else if (real <= 1.0001 && Math.abs(real - it.value) > Math.max(0.01, real * 0.15)) {
            errs.push(
              `${w}.items[${j}]：display「${it.display}」代表 ${real}，但 value 是 ${it.value}，条的长度会误导观众。` +
                `value 必须等于真实数值 ${real}（很小的数就让它画得很短，那正是要表达的意思）；如果想强调很小的差别，请改用 compare 或 dots 元素`,
            );
          }
        });
        break;
      case "title":
        tooLong(b.title, 12, `${w}.title`);
        tooLong(b.text, 16, `${w}.text`);
        checkSticker(b.sticker, w);
        break;
      case "dist": {
        tooLong(b.label, 24, `${w}.label`);
        if (b.preset === "longtail") break;
        const toks = b.tokens ?? [];
        if (toks.length < 2 || toks.length > 6) errs.push(`${w}.tokens 需要 2 到 6 个`);
        let so = 0;
        let sn = 0;
        let anyNew = false;
        toks.forEach((t, j) => {
          tooLong(t.label, 4, `${w}.tokens[${j}].label`);
          if (!(t.old >= 0 && t.old <= 1)) errs.push(`${w}.tokens[${j}].old 必须在 0 到 1 之间`);
          so += t.old ?? 0;
          if (t.new != null) {
            anyNew = true;
            if (!(t.new >= 0 && t.new <= 1)) errs.push(`${w}.tokens[${j}].new 必须在 0 到 1 之间`);
          }
          sn += t.new ?? t.old ?? 0;
        });
        if (so > 1.0001 || sn > 1.0001) errs.push(`${w}：概率总和不能超过 1（旧 ${so.toFixed(2)}，新 ${sn.toFixed(2)}），所有词的概率加起来最多是 1`);
        if (anyNew && !ids.has(b.newAt)) errs.push(`${w}：有 new 就必须给 newAt（柱子变化的那句旁白 id）`);
        (b.highlight ?? []).forEach((h) => {
          if (!(Number.isInteger(h) && h >= 0 && h < toks.length)) errs.push(`${w}.highlight 里的 ${h} 超出 tokens 范围`);
        });
        break;
      }
      case "numberline": {
        const ax = b.axis;
        if (!ax || !(ax.max > ax.min)) errs.push(`${w}.axis 需要 min 和 max，且 max > min`);
        const pts = b.points ?? [];
        if (pts.length < 1 || pts.length > 3) errs.push(`${w}.points 需要 1 到 3 个`);
        pts.forEach((p, j) => {
          if (!ids.has(p.at)) errs.push(`${w}.points[${j}].at 引用了不存在的句子 ${p.at}`);
          tooLong(p.label, 6, `${w}.points[${j}].label`);
          checkSticker(p.sticker, `${w}.points[${j}]`);
          for (const k of ["from", "to"]) {
            if (p[k] != null && ax && !(p[k] >= ax.min && p[k] <= ax.max)) errs.push(`${w}.points[${j}].${k}=${p[k]} 超出数轴范围 ${ax.min}~${ax.max}`);
          }
          // 数值必须是旁白里说过的:在 at 前后各一句里找
          const i = sentenceIds.indexOf(p.at);
          const heard = numbersIn(sentenceIds.slice(Math.max(0, i - 1), i + 3).map((x) => sentenceTexts[x]).join(""));
          for (const k of ["from", "to"]) {
            if (p[k] == null || !Object.keys(sentenceTexts).length) continue;
            if (!heard.some((v) => Math.abs(v - p[k]) <= Math.max(1e-9, Math.abs(p[k]) * 0.02))) {
              errs.push(`${w}.points[${j}].${k}=${p[k]}：旁白在 ${p.at} 前后没有说过这个数。数轴上的数值必须是旁白里出现过的（如"千分之一"=0.001、"百分之五十"=0.5）`);
            }
          }
        });
        if (b.band) {
          if (!(b.band.to > b.band.from)) errs.push(`${w}.band 需要 from < to`);
          tooLong(b.band.label, 10, `${w}.band.label`);
        }
        break;
      }
      case "plot": {
        const preset = b.preset;
        if (!["weight", "blowup"].includes(preset)) errs.push(`${w}.preset 必须是 weight 或 blowup`);
        const okIds = preset === "weight" ? ["out", "in", "mask"] : ["spo", "drpo"];
        const cs = b.curves ?? [];
        if (!cs.length) errs.push(`${w}.curves 至少要有 1 条`);
        cs.forEach((c, j) => {
          if (!okIds.includes(c.id)) errs.push(`${w}.curves[${j}].id「${c.id}」不合法，${preset} 预设只能用 ${okIds.join("/")}`);
          if (!ids.has(c.at)) errs.push(`${w}.curves[${j}].at 引用了不存在的句子 ${c.at}`);
        });
        const ms = b.marks ?? [];
        if (ms.length > 4) errs.push(`${w}.marks 最多 4 个`);
        const xmax = preset === "weight" ? 1.6 : 1;
        ms.forEach((m, j) => {
          if (!ids.has(m.at)) errs.push(`${w}.marks[${j}].at 引用了不存在的句子 ${m.at}`);
          if (!(m.x > 0 && m.x <= xmax)) errs.push(`${w}.marks[${j}].x=${m.x} 必须在 0 到 ${xmax} 之间`);
          if (m.on && !okIds.includes(m.on)) errs.push(`${w}.marks[${j}].on「${m.on}」不合法`);
          if (m.on && !cs.some((c) => c.id === m.on)) errs.push(`${w}.marks[${j}]：圆点落在 ${m.on} 曲线上，但这条曲线没有出现在 curves 里`);
          if (preset === "weight" && b.delta && Object.keys(sentenceTexts).length) {
            const real = +(m.x * b.delta).toFixed(6);
            const i = sentenceIds.indexOf(m.at);
            const heard = numbersIn(sentenceIds.slice(Math.max(0, i - 1), i + 2).map((x) => sentenceTexts[x]).join(""));
            if (m.x !== 1 && !heard.some((v) => Math.abs(v - real) < 1e-6)) {
              errs.push(`${w}.marks[${j}]：x=${m.x}、delta=${b.delta} 对应变化量 ${real}，但旁白在 ${m.at} 前后没有说过这个数。圆点的位置必须是旁白里讲过的变化量`);
            }
          }
        });
        break;
      }
      case "eq": {
        const es = b.eqs ?? [];
        const seenEq = es.map((e) => e.eq).filter(Boolean);
        if (new Set(seenEq).size !== seenEq.length) errs.push(`${w}：同一个 eq 镜头里不能重复放同一条公式，想强调不同部分，请只放一次，用 hl 高亮`);
        if (es.length < 1 || es.length > 4) errs.push(`${w}.eqs 需要 1 到 4 行`);
        es.forEach((e, j) => {
          if (e.eq) {
            const src = paper?.equations?.find((q) => q.id === e.eq);
            if (!src) errs.push(`${w}.eqs[${j}].eq「${e.eq}」不是论文里的公式 id`);
            else {
              for (const h of e.hl ?? []) {
                if (!src.tex.includes(h)) errs.push(`${w}.eqs[${j}].hl「${h}」不是公式 ${e.eq} 的 LaTeX 里的原文片段，必须原样复制`);
                else if ((h.match(/\{/g) ?? []).length !== (h.match(/\}/g) ?? []).length) errs.push(`${w}.eqs[${j}].hl「${h}」括号不配对，高亮片段里的 { } 必须成对`);
              }
            }
            tooLong(e.title, 8, `${w}.eqs[${j}].title`);
            tooLong(e.note, 18, `${w}.eqs[${j}].note`);
          } else if (!EQLIB[e.ref]) errs.push(`${w}.eqs[${j}] 要么写 ref（公式库 id：${Object.keys(EQLIB).join("、")}），要么写 eq（论文公式 id）`);
          if (!ids.has(e.at)) errs.push(`${w}.eqs[${j}].at 引用了不存在的句子 ${e.at}`);
          tooLong(e.note, 12, `${w}.eqs[${j}].note`);
        });
        break;
      }
      case "rows": {
        const ls = b.list ?? [];
        if (ls.length < 2 || ls.length > 6) errs.push(`${w}.list 需要 2 到 6 条`);
        ls.forEach((r, j) => {
          if (!ids.has(r.at)) errs.push(`${w}.list[${j}].at 引用了不存在的句子 ${r.at}`);
          if (r.statusAt && !ids.has(r.statusAt)) errs.push(`${w}.list[${j}].statusAt 引用了不存在的句子 ${r.statusAt}`);
          if (r.status && !["ok", "bad", "warn", "idea"].includes(r.status)) errs.push(`${w}.list[${j}].status 必须是 ok/bad/warn/idea`);
          tooLong(r.label, 18, `${w}.list[${j}].label`);
          tooLong(r.sub, 20, `${w}.list[${j}].sub`);
          tooLong(r.verdict, 10, `${w}.list[${j}].verdict`);
          checkSticker(r.sticker, `${w}.list[${j}]`);
        });
        break;
      }
      case "stream": {
        // 论文里真实的模型输出样例：逐字打出，关键短语依次点亮。文字必须是论文原文（逐字出现），不能让模型自己编
        const txt = b.text ?? "";
        const n = [...txt].length;
        if (n < 8 || n > 160) errs.push(`${w}.text 需要 8 到 160 个字符（现在 ${n}）`);
        const normP = (s) => s.toLowerCase().replace(/\s+/g, "");
        if (paper?.text && !normP(paper.text).includes(normP(txt))) errs.push(`${w}.text 不是论文原文里逐字出现的片段，不能自己编写模型输出：「${txt.slice(0, 40)}」。请只从论文里的样例原样复制一段`);
        const ph = b.phrases ?? [];
        if (ph.length > 5) errs.push(`${w}.phrases 最多 5 个`);
        ph.forEach((p, j) => {
          if (!txt.includes(p)) errs.push(`${w}.phrases[${j}]「${p}」不在 text 里，必须是 text 的原样片段`);
        });
        if (!b.label || [...b.label].length > Math.round(20 * KS())) errs.push(`${w}.label 必填，不超过 ${Math.round(20 * KS())} 字（说明这是什么，比如"论文里模型的真实输出"）`);
        break;
      }
      case "canvas": {
        // 画布：图形原件随旁白长出来、移动。是"示意图"，所以不承载数字和数量；坐标按 1600×520
        if (b.form === "motion") {
          // OpenMotion 式动画（模型写的 HTML+CSS+GSAP）：这里只做静态安全检查；时间锚点、出界、重叠等由 motion-check.mjs 在真浏览器里查，锚点由 check-anchors.mjs 查
          const m = b.motion;
          if (!m || typeof m.html !== "string" || typeof m.script !== "string") { errs.push(`${w} motion 必须有 html 和 script 字符串`); break; }
          for (const e of [...sanitizeHtml(m.html, (p) => p).errs, ...scopeCss(m.css ?? "", "stage").errs, ...checkScript(m.script)]) errs.push(`${w} motion：${e}`);
          break;
        }
        if (b.form === "free") {
          // 自由动画：模型自己搭的对象，校验字段、符号来源、重叠和停住
          const others = story.beats.filter((x) => x !== b && (x.slot === "C" || x.clear)).map((x) => x.at);
          for (const e of validateFree(b, sentenceIds, sentenceTexts, { paper, formulas: ctx.formulas ?? [], otherCenterAts: others, stickers: [...stickers], strictLayout: !!ctx.strictLayout, lang: LANG_S })) errs.push(`${w} ${e}`);
          break;
        }
        if (b.things || b.form) {
          // 模型写的是"画布说明"（layout/things/marks，没有坐标），由编译器算出 cv；编译不过就把原因反馈给模型
          const r = compileCanvas(b, sentenceIds, sentenceTexts, LANG_S);
          for (const e of r.errs) errs.push(`${w} ${e}`);
          if (r.errs.length) break;
          b.cv = r.cv;
        }
        {
          // 画布存续期间不能长时间没变化：出现、移动、标记、点名弹跳之间最多隔 6.5 秒（时间按旁白字数估算）
          const evs = [];
          for (const it of b.cv ?? []) {
            evs.push(it.at, ...(it.moves ?? []).map((m) => m.at), ...(it.pulse ?? []));
          }
          const startI = sentenceIds.indexOf(b.at);
          const later = story.beats.filter((x) => x !== b && (x.slot === "C" || x.clear) && sentenceIds.indexOf(x.at) > startI).map((x) => sentenceIds.indexOf(x.at));
          const endRef = later.length ? sentenceIds[Math.min(...later)] : null;
          const totalSec = estimateSec(sentenceIds[sentenceIds.length - 1], sentenceIds, sentenceTexts) + [...(sentenceTexts[sentenceIds[sentenceIds.length - 1]] ?? "")].length / 5;
          const endSec = endRef ? estimateSec(endRef, sentenceIds, sentenceTexts) : totalSec;
          const secs = [...new Set(evs.map((r) => estimateSec(r, sentenceIds, sentenceTexts)).filter((x) => x !== null))].sort((a, c) => a - c);
          const edge = [estimateSec(b.at, sentenceIds, sentenceTexts), ...secs.filter((x) => x <= endSec), endSec];
          const sentAt = (sec) => { let best = sentenceIds[0]; for (const id of sentenceIds) if (estimateSec(id, sentenceIds, sentenceTexts) <= sec + 0.01) best = id; return best; };
          for (let q = 1; q < edge.length; q++) {
            if (edge[q] - edge[q - 1] > 6.5) {
              errs.push(`${w}：画布在大约 ${edge[q - 1].toFixed(0)} 到 ${edge[q].toFixed(0)} 秒之间（句子 ${sentAt(edge[q - 1])} 附近，${(edge[q] - edge[q - 1]).toFixed(0)} 秒）画面完全没有变化，最多 6 秒。请在这段话的关键词处让东西出现、移动，或写 {"type":"point","who":"某个东西的id","at":"句子id@短语"} 让它弹一下；如果这段话已经讲完了画布的内容，就让画布提前结束（在这句换成别的镜头）`);
              break;
            }
          }
        }
        const cv = b.cv ?? [];
        const TYPES = ["dot", "box", "vec", "axis", "arrow", "text", "ring", "brace", "bar"];
        if (cv.length < 3 || cv.length > 24) errs.push(`${w}.cv 需要 3 到 24 个原件（现在 ${cv.length}）`);
        const seen = new Set();
        const startIdx = sentenceIds.indexOf(b.at);
        // 锚点：d11 / d11+30 / d11#1 / d11@短语（短语必须是该句原文里的字）
        const anchor = (ref, where) => {
          const m = typeof ref === "string" ? ref.match(/^([^+#@]+)(?:([+#@])(.*))?$/) : null;
          if (!m || !ids.has(m[1])) { errs.push(`${where} 的时间锚点「${ref}」不对：要写成 句子id、id+帧数、id#段号 或 id@短语`); return -1; }
          if (m[2] === "@") {
            const phrase = m[3].replace(/\+\d+$/, "");
            const text = sentenceTexts[m[1]];
            if (/[，。？！、：；,.?!;:"“”‘’（）()「」『』]/.test(phrase)) errs.push(`${where} 的锚点短语「${phrase}」含标点。短语只能是句子里连续的几个字，不能跨逗号、句号`);
            else if (text && !text.includes(phrase)) errs.push(`${where} 的锚点短语「${phrase}」不在句子 ${m[1]} 的原文里`);
          }
          return sentenceIds.indexOf(m[1]);
        };
        const inX = (v) => typeof v !== "number" || (v >= 0 && v <= 1600);
        const inY = (v) => typeof v !== "number" || (v >= 0 && v <= 520);
        cv.forEach((it, j) => {
          const where = `${w}.cv[${j}]（${it.id}）`;
          if (!it.id || seen.has(it.id)) errs.push(`${where} 的 id 缺失或重复`);
          seen.add(it.id);
          if (!TYPES.includes(it.type)) errs.push(`${where}.type 必须是 ${TYPES.join("/")}`);
          const a = anchor(it.at, `${where}.at`);
          if (a >= 0 && startIdx >= 0 && a < startIdx) errs.push(`${where}.at 早于镜头开始的句子 ${b.at}`);
          if (it.until) {
            const u = anchor(it.until, `${where}.until`);
            if (u >= 0 && a >= 0 && u < a) errs.push(`${where}.until 早于 at`);
          }
          for (const [k, mv] of (it.moves ?? []).entries()) {
            const mi = anchor(mv.at, `${where}.moves[${k}].at`);
            if (mi >= 0 && a >= 0 && mi < a) errs.push(`${where}.moves[${k}].at 早于原件出现`);
            if (!inX(mv.x) || !inY(mv.y)) errs.push(`${where}.moves[${k}] 超出画布（x 0~1600，y 0~520）`);
          }
          for (const k of ["x", "x2"]) if (!inX(it[k])) errs.push(`${where}.${k} 超出画布 0~1600`);
          for (const k of ["y", "y2"]) if (!inY(it[k])) errs.push(`${where}.${k} 超出画布 0~520`);
          if (it.type !== "vec" && it.type !== "ring" && typeof it.x !== "number") errs.push(`${where} 缺少 x`);
          if (typeof it.y !== "number") errs.push(`${where} 缺少 y`);
          if (["axis", "arrow", "brace"].includes(it.type) && (typeof it.x2 !== "number" || typeof it.y2 !== "number")) errs.push(`${where}：${it.type} 需要 x2、y2`);
          if (["text", "box", "brace"].includes(it.type) && !it.text) errs.push(`${where}：${it.type} 需要 text`);
          if (it.text) {
            tooLong(it.text, 12, `${where}.text`);
            if (/[0-9０-９]/.test(it.text) || /[二三四五六七八九十百千万]+[道个次倍条种步项层成]|百分之|零点|[一二三四五六七八九]点[一二三四五六七八九]/.test(it.text))
              errs.push(`${where}.text 里出现了数字或数量：「${it.text}」。画布是示意图，不写数字，数字只由旁白讲`);
            if (LANG_S === "en" ? /[α-ωΑ-Ω∑∏√≤≥≠±×÷→\u4e00-\u9fff]/.test(it.text) : /[A-Za-z]{2,}|[α-ωΑ-Ω∑∏√≤≥≠±×÷→]/.test(it.text)) errs.push(LANG_S === "en" ? `${where}.text 含中文或数学符号：「${it.text}」，请用英文单词` : `${where}.text 含英文单词或数学符号：「${it.text}」，请用中文`);
          }
          if (it.sticker) checkSticker(it.sticker, where);
          if (it.tone && ![...TONES, "green"].includes(it.tone)) errs.push(`${where}.tone 不合法：${it.tone}`);
        });
        break;
      }
      case "stage": {
        const chars = new Set(CHARS.map((c) => c.id));
        const cast = b.cast ?? [];
        const acts = b.acts ?? [];
        if (cast.length < 1 || cast.length > 3) errs.push(`${w}.cast 需要 1 到 3 个演员`);
        const castIds = new Set();
        cast.forEach((c, j) => {
          if (!c.id || castIds.has(c.id)) errs.push(`${w}.cast[${j}].id 缺失或重复`);
          castIds.add(c.id);
          if (!chars.has(c.look)) errs.push(`${w}.cast[${j}].look「${c.look}」不是可用的角色。可用：${[...chars].join("、")}`);
          if (c.pos && !["left", "center", "right"].includes(c.pos)) errs.push(`${w}.cast[${j}].pos 必须是 left/center/right`);
          tooLong(c.tag, 5, `${w}.cast[${j}].tag`);
          if (LANG_S === "en" ? /[0-9\u4e00-\u9fff]/.test(c.tag ?? "") : /[A-Za-z0-9]/.test(c.tag ?? "")) errs.push(LANG_S === "en" ? `${w}.cast[${j}].tag「${c.tag}」含数字或中文，请用英文称呼（如 "Answer A"）` : `${w}.cast[${j}].tag「${c.tag}」含英文字母或数字，请用中文（如"回答甲""回答乙"）`);
        });
        const poses = cast.map((c) => c.pos ?? "center");
        if (new Set(poses).size !== poses.length) errs.push(`${w}.cast 里两个演员站在同一个位置，请分开（left/center/right）`);
        if (acts.length < 2 || acts.length > 8) errs.push(`${w}.acts 需要 2 到 8 步`);
        let prevIdx = -1;
        const entered = new Set();
        acts.forEach((a, j) => {
          const where = `${w}.acts[${j}]`;
          const idx = sentenceIds.indexOf(a.at);
          if (idx < 0) errs.push(`${where}.at 引用了不存在的句子 ${a.at}`);
          else if (idx < prevIdx) errs.push(`${where}.at 必须按旁白先后顺序排列`);
          prevIdx = Math.max(prevIdx, idx);
          if (!castIds.has(a.who)) errs.push(`${where}.who「${a.who}」不在 cast 里`);
          entered.add(a.who);
          if (a.do && !["enter", "bounce", "shake", "nod", "grow", "shrink", "wiggle", "idle"].includes(a.do)) errs.push(`${where}.do 必须是 enter/bounce/shake/nod/grow/shrink/wiggle/idle`);
          if (a.look && !chars.has(a.look)) errs.push(`${where}.look「${a.look}」不是可用的角色`);
          if (a.mood) checkSticker(a.mood, `${where}.mood`);
          if (a.prop) checkSticker(a.prop, `${where}.prop`);
          if (a.say) {
            tooLong(a.say, 18, `${where}.say`);
            if ([...a.say].length < 2) errs.push(`${where}.say 太短`);
            // 台词是角色演出来的，不是论文事实：不许出现数字、符号、英文单词，避免编造
            if (/[0-9０-９]/.test(a.say) || /[二三四五六七八九十百千万]+[道个次倍条种步项层成]|[二三四五六七八九十百千万]{2,}|百分之|零点|[一二三四五六七八九]点[一二三四五六七八九]/.test(a.say))
              errs.push(`${where}.say 里出现了数字或数量：「${a.say}」。台词不承载论文里的数字和数量，数字只由旁白来讲，请换成不含数字的话`);
            if (LANG_S === "en" ? /[α-ωΑ-Ω∑∏√≤≥≠±×÷→\u4e00-\u9fff]/.test(a.say) : /[A-Za-z]{2,}|[α-ωΑ-Ω∑∏√≤≥≠±×÷→]/.test(a.say)) errs.push(LANG_S === "en" ? `${where}.say 含中文或数学符号：「${a.say}」，请用口语英文` : `${where}.say 含英文单词或数学符号：「${a.say}」，请用中文`);
          }
        });
        for (const id of castIds) if (!acts.some((a) => a.who === id)) errs.push(`${w}：演员 ${id} 在 acts 里一次都没出现`);
        if (!acts.some((a) => a.say)) errs.push(`${w}.acts 里至少要有一句台词 say`);
        if (acts[0] && acts[0].at !== b.at) errs.push(`${w}：第一步 acts[0].at 必须等于镜头的 at（${b.at}）`);
        break;
      }
      case "eqx": {
        const fm = (ctx.formulas ?? []).find((f) => f.eq === b.eq);
        if (!fm) errs.push(`${w}.eq「${b.eq}」不是本场景要逐项讲解的公式（本场景的公式：${(ctx.formulas ?? []).map((f) => f.eq).join("、") || "无"}）`);
        else if (!Array.isArray(b.partSteps) || b.partSteps.length !== fm.parts.length) errs.push(`${w}：partSteps 和公式项数不一致，程序应该自动生成`);
        // 插入演示：这几句里公式缩到上方，下方换成自由动画
        {
          const ins = b.insets ?? [];
          if (ins.length > 5) errs.push(`${w}.insets 最多 5 段`);
          const eqIdx = sentenceIds.indexOf(b.at);
          const lastStep = Math.max(eqIdx, ...(b.partSteps ?? []).map((m) => sentenceIds.indexOf(m.at)));
          let prevTo = -1;
          ins.forEach((n, j) => {
            const iw = `${w}.insets[${j}]`;
            const a = sentenceIds.indexOf(n.from), z = sentenceIds.indexOf(n.to);
            if (a < 0 || z < 0 || z < a) { errs.push(`${iw} 的 from/to 不是有效的句子范围`); return; }
            if (a < eqIdx || z > lastStep) errs.push(`${iw}（${n.from}~${n.to}）必须落在这条 eqx 占用的句子里（${b.at}~${sentenceIds[lastStep]}）`);
            if (a <= prevTo) errs.push(`${iw} 和上一段重叠，请按先后顺序、不要重叠`);
            if (z - a > 3) errs.push(`${iw} 跨了 ${z - a + 1} 句，最多 4 句`);
            prevTo = z;
            if (n.motion) {
              // 公式下方的 OpenMotion 式动画：只做静态安全检查（时间锚点、出界、重叠在 motion-check.mjs 里用真浏览器查）
              if (typeof n.motion.html !== "string" || typeof n.motion.script !== "string") errs.push(`${iw}.motion 必须有 html 和 script 字符串`);
              else for (const e of [...sanitizeHtml(n.motion.html, (p) => p).errs, ...scopeCss(n.motion.css ?? "", "stage").errs, ...checkScript(n.motion.script)]) errs.push(`${iw}.motion：${e}`);
              return;
            }
            const pseudo = { at: n.from, objs: n.objs ?? [] };
            const after = z + 1 < sentenceIds.length ? [sentenceIds[z + 1]] : [];
            for (const e of validateFree(pseudo, sentenceIds, sentenceTexts, { paper, formulas: ctx.formulas ?? [], otherCenterAts: after, stickers: [...stickers], inset: true, strictLayout: !!ctx.strictLayout, lang: LANG_S })) errs.push(`${iw} ${e}`);
          });
        }
        break;
      }
      case "fig": {
        const fg = paper?.figures?.find((q) => q.id === b.ref);
        if (!fg || !fg.file) errs.push(`${w}.ref「${b.ref}」不是论文里可用的图 id`);
        const panelHint = /left|right|top|bottom|upper|lower|\(a\)|\(b\)|\(c\)|panel/i.test(fg?.caption ?? "");
        const fs2 = b.focusSteps ?? [];
        if (fs2.length < 1 || fs2.length > 5) errs.push(`${w}.focusSteps 需要 1 到 5 步`);
        fs2.forEach((st, j) => {
          if (!ids.has(st.at)) errs.push(`${w}.focusSteps[${j}].at 引用了不存在的句子 ${st.at}`);
          if (!FOCUS_NAMES.includes(st.focus)) errs.push(`${w}.focusSteps[${j}].focus 必须是 ${FOCUS_NAMES.join("/")}`);
          else if (st.focus !== "all" && !panelHint) errs.push(`${w}.focusSteps[${j}]：这张图的说明文字里没有提到左右、上下或分图，而你看不到图的内容，放大某一块很可能放大到无关的地方。请改成 all，用 label 说明这一步在看什么`);
          tooLong(st.label, 26, `${w}.focusSteps[${j}].label`);
        });
        break;
      }
      case "table": {
        const tb = paper?.tables?.find((q) => q.id === b.ref);
        if (!tb) {
          errs.push(`${w}.ref「${b.ref}」不是论文里的表 id`);
          break;
        }
        const nr = tb.rows.length;
        const nc = Math.max(...tb.rows.map((r) => r.length));
        const sr = b.showRows ?? tb.rows.map((_, i) => i);
        const sc = b.showCols ?? tb.rows[0].map((_, i) => i);
        if (sr.length > 8 || sc.length > 6) errs.push(`${w}：最多显示 8 行 6 列（现在 ${sr.length} 行 ${sc.length} 列），请用 showRows / showCols 只挑讲到的行列`);
        {
          const longCells = sr.flatMap((r) => sc.map((c) => [...(tb.rows[r]?.[c] ?? "")].length)).filter((n) => n > 60).length;
          if (longCells > 0) errs.push(`${w}：表 ${b.ref} 里有 ${longCells} 个单元格超过 60 字（是整段文本样例），放在表格里屏幕上读不了。请换成 card（摘录开头一两句）或 fig，或者只显示其他行列`);
        }
        if (!sr.includes(0)) errs.push(`${w}.showRows 必须包含表头行 0`);
        sr.forEach((i) => !(Number.isInteger(i) && i >= 0 && i < nr) && errs.push(`${w}.showRows 里的 ${i} 超出范围 0~${nr - 1}`));
        sc.forEach((i) => !(Number.isInteger(i) && i >= 0 && i < nc) && errs.push(`${w}.showCols 里的 ${i} 超出范围 0~${nc - 1}`));
        (b.hlSteps ?? []).forEach((st, j) => {
          if (!ids.has(st.at)) errs.push(`${w}.hlSteps[${j}].at 引用了不存在的句子 ${st.at}`);
          (st.rows ?? []).forEach((i) => !sr.includes(i) && errs.push(`${w}.hlSteps[${j}].rows 里的 ${i} 不在显示的行里`));
          (st.cols ?? []).forEach((i) => !sc.includes(i) && errs.push(`${w}.hlSteps[${j}].cols 里的 ${i} 不在显示的列里`));
          tooLong(st.label, 26, `${w}.hlSteps[${j}].label`);
        });
        break;
      }
      case "chart": {
        if (!["bar", "line"].includes(b.chartType)) errs.push(`${w}.chartType 必须是 bar 或 line`);
        const ss = b.series ?? [];
        if (ss.length < 1 || ss.length > 3) errs.push(`${w}.series 需要 1 到 3 组`);
        tooLong(b.label, 20, `${w}.label`);
        ss.forEach((sr2, j) => {
          const pts = sr2.points ?? [];
          if (pts.length < 2 || pts.length > 8) errs.push(`${w}.series[${j}].points 需要 2 到 8 个点`);
          pts.forEach((p, k) => {
            tooLong(p.x, 8, `${w}.series[${j}].points[${k}].x`);
            if (!(typeof p.y === "number" && p.y >= 0 && Number.isFinite(p.y))) errs.push(`${w}.series[${j}].points[${k}].y 必须是非负数字`);
            else if (paper?.text) {
              const forms = new Set([String(p.y), p.y.toFixed(1), p.y.toFixed(2), p.y.toFixed(3), String(Math.round(p.y))]);
              const found = [...forms].some((t) => paper.text.includes(t) && (t.includes(".") || p.y === Math.round(p.y)));
              if (!found) errs.push(`${w}.series[${j}].points[${k}].y=${p.y} 在论文正文和表格里找不到。图表里的数字必须是论文里出现过的`);
            }
          });
          if (j > 0 && pts.length !== (ss[0].points ?? []).length) errs.push(`${w}.series 每一组的点数必须相同`);
        });
        if (b.hlAt && !ids.has(b.hlAt)) errs.push(`${w}.hlAt 引用了不存在的句子 ${b.hlAt}`);
        break;
      }
      case "diagram": {
        const ns = b.nodes ?? [];
        const es = b.edges ?? [];
        if (ns.length < 2 || ns.length > 7) errs.push(`${w}.nodes 需要 2 到 7 个`);
        const nid = new Set(ns.map((n) => n.id));
        if (nid.size !== ns.length) errs.push(`${w}.nodes 的 id 不能重复`);
        ns.forEach((n, j) => {
          tooLong(n.label, 10, `${w}.nodes[${j}].label`);
          checkSticker(n.sticker, `${w}.nodes[${j}]`);
          if (n.at && !ids.has(n.at)) errs.push(`${w}.nodes[${j}].at 引用了不存在的句子 ${n.at}`);
        });
        es.forEach((e, j) => {
          if (!nid.has(e.from) || !nid.has(e.to)) errs.push(`${w}.edges[${j}] 的 from/to 必须是 nodes 里的 id`);
          tooLong(e.label, 8, `${w}.edges[${j}].label`);
          if (e.at && !ids.has(e.at)) errs.push(`${w}.edges[${j}].at 引用了不存在的句子 ${e.at}`);
        });
        // 不能有环
        const indeg = Object.fromEntries([...nid].map((x) => [x, 0]));
        es.forEach((e) => nid.has(e.to) && indeg[e.to]++);
        const q = [...nid].filter((x) => !indeg[x]);
        let seen = 0;
        while (q.length) {
          const x = q.shift();
          seen++;
          es.filter((e) => e.from === x).forEach((e) => --indeg[e.to] === 0 && q.push(e.to));
        }
        if (seen !== nid.size) errs.push(`${w}：节点之间有环，diagram 只能画从左到右的流程，不能有回路`);
        break;
      }
      case "flow":
        if (!Array.isArray(b.steps) || b.steps.length < 2 || b.steps.length > 4) errs.push(`${w}.steps 需要 2 到 4 步`);
        (b.steps ?? []).forEach((s, j) => {
          tooLong(s.text, 8, `${w}.steps[${j}].text`);
          checkSticker(s.sticker, `${w}.steps[${j}]`);
        });
        break;
      case "leash": {
        const DOGS = ["inside", "edge", "outside", "far"];
        const LINES = ["slack", "taut", "spring", "cut"];
        const mv = b.moves;
        if (!Array.isArray(mv) || mv.length < 2 || mv.length > 6) errs.push(`${w}.moves 需要 2 到 6 项`);
        let lastIdx = -1;
        (mv ?? []).forEach((m, j) => {
          if (!ids.has(m.at)) errs.push(`${w}.moves[${j}].at 引用了不存在的句子 ${m.at}`);
          if (!DOGS.includes(m.dog)) errs.push(`${w}.moves[${j}].dog 必须是 ${DOGS.join("/")}，你写的是 ${m.dog}`);
          if (!LINES.includes(m.line)) errs.push(`${w}.moves[${j}].line 必须是 ${LINES.join("/")}，你写的是 ${m.line}`);
          tooLong(m.label, 14, `${w}.moves[${j}].label`);
          const idx = sentenceIds.indexOf(m.at);
          if (idx >= 0 && idx < lastIdx) errs.push(`${w}.moves 必须按旁白时间顺序排列，${m.at} 出现得比前一项早`);
          if (idx >= 0 && idx === lastIdx) errs.push(`${w}.moves 里有两项落在同一句 ${m.at}，狗会一闪而过，观众看不到前一个状态。每个 move 必须落在不同的句子上；如果一句话里想表达两个状态，请只保留最后那个`);
          if (idx >= 0) lastIdx = idx;
        });
        tooLong(b.circleLabel, 8, `${w}.circleLabel`);
        break;
      }
      case "grow": {
        const rows = b.rows;
        const scale = b.scale ?? 1;
        if (!(scale > 0 && scale <= 1)) errs.push(`${w}.scale 必须在 0 到 1 之间（默认 1）`);
        if (!Array.isArray(rows) || rows.length < 1 || rows.length > 3) errs.push(`${w}.rows 需要 1 到 3 行`);
        if (b.animAt && !ids.has(b.animAt)) errs.push(`${w}.animAt 引用了不存在的句子 ${b.animAt}`);
        (rows ?? []).forEach((r, j) => {
          tooLong(r.label, 8, `${w}.rows[${j}].label`);
          checkSticker(r.sticker, `${w}.rows[${j}]`);
          if (!(typeof r.from === "number" && typeof r.to === "number")) errs.push(`${w}.rows[${j}] 的 from/to 必须是数字`);
          else if (r.from < 0 || r.to < 0 || r.from > scale || r.to > scale) errs.push(`${w}.rows[${j}] 的 from/to 必须在 0 到 scale(${scale}) 之间`);
          else if (r.from === r.to) errs.push(`${w}.rows[${j}] 的 from 和 to 相同，没有变化可画`);
        });
        break;
      }
      case "sticker":
        if (!Array.isArray(b.stickers) || b.stickers.length < 1 || b.stickers.length > 3) errs.push(`${w}.stickers 需要 1 到 3 个`);
        (b.stickers ?? []).forEach((s, j) => {
          checkSticker(s.name, `${w}.stickers[${j}]`);
          tooLong(s.caption, 8, `${w}.stickers[${j}].caption`);
        });
        break;
    }
    if (b.form !== "free" && /[α-ωΑ-Ω]/.test(JSON.stringify(b))) errs.push(`${w} 含希腊字母，请改成中文说法`); // 自由动画有自己的符号来源检查（必须出自论文公式）
  });

  // 同一句话里的多个镜头不能互相吃掉:C 与 L/R 互斥，同一位置不能放两个
  const CONFLICT = { C: ["L1", "L2", "R1", "R2"], L1: ["C"], L2: ["C"], R1: ["C"], R2: ["C"], T: [] };
  const bySentence = new Map();
  story.beats.forEach((b) => {
    if (!bySentence.has(b.at)) bySentence.set(b.at, []);
    bySentence.get(b.at).push(b);
  });
  for (const [at, list] of bySentence) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.slot === b.slot || (CONFLICT[a.slot] ?? []).includes(b.slot)) {
          errs.push(
            `句子 ${at} 里同时放了 ${a.slot} 的 ${a.kind} 和 ${b.slot} 的 ${b.kind}，两者互斥，后者会立刻把前者清掉，观众只能看到一个。` +
              `请只保留一个，或者把它们挪到相邻两句话里；想左右并排请都用 L1/L2/R1/R2，想整屏请只用 C`,
          );
        }
      }
  }

  // 旁白提到具体对象时，同一句或相邻一句的镜头里必须出现对应贴图。映射由人工维护。
  const OBJECT_STICKERS = rules.objectStickers;
  // 某一句话说出时屏幕上"正在显示"的镜头：从它出现，到被后来冲突的镜头替换为止
  const activeAt = (id) => {
    const i = sentenceIds.indexOf(id);
    return story.beats.filter((b) => {
      const st = sentenceIds.indexOf(b.at);
      if (st < 0 || st > i) return false;
      if (b.slot === "T") return st === i;
      const clashes = (o) => o !== b && o.slot !== "T" && (o.clear || b.slot === "C" || o.slot === "C" || o.slot === b.slot);
      const ends = story.beats.filter((o) => clashes(o) && sentenceIds.indexOf(o.at) > st).map((o) => sentenceIds.indexOf(o.at));
      return !ends.length || i < Math.min(...ends);
    });
  };
  const stickersAt = (id) => {
    const out = new Set();
    for (const b of activeAt(id)) {
      (b.points ?? []).forEach((p) => p.sticker && out.add(p.sticker));
      (b.list ?? []).forEach((p) => p.sticker && out.add(p.sticker));
      if (b.band) out.add("scissors");
      if (b.sticker) out.add(b.sticker);
      (b.stickers ?? []).forEach((s) => out.add(s.name));
      (b.steps ?? []).forEach((s) => s.sticker && out.add(s.sticker));
      (b.rows ?? []).forEach((r) => r.sticker && out.add(r.sticker));
      if (b.kind === "leash") ["dog", "dog-face"].forEach((s) => out.add(s)); // leash 自带人和狗
      for (const side of [b.left, b.right]) if (side?.sticker) out.add(side.sticker);
    }
    return out;
  };
  const idxOf = new Map(sentenceIds.map((id, i) => [id, i]));
  for (const [id, text] of Object.entries(sentenceTexts)) {
    for (const { word, stickers: need } of OBJECT_STICKERS) {
      if (!text.includes(word)) continue;
      // 当前句、前一句、后一句里，只要有一个镜头带了对应贴图就算满足
      const i = idxOf.get(id);
      const near = [sentenceIds[i - 1], id, sentenceIds[i + 1]].filter(Boolean);
      const have = new Set(near.flatMap((x) => [...stickersAt(x)]));
      // 上一个仍在显示的镜头也算：只要这个贴图之前出现过且没被 clear，这里不强求。为简单起见只看相邻三句
      if (!need.some((s) => have.has(s))) {
        errs.push(`${id}「${text}」提到了「${word}」，但这句话及相邻两句的画面里没有出现对应形象（需要贴图之一：${need.join(" / ")}）。请在这句话的镜头里加上`);
      }
      break; // 一句话只按最先匹配的对象检查一次
    }
  }
  // 旁白提到狗或绳子时，必须由 leash 元素来表现（本句有 leash 镜头，或落在某个 leash 的 moves 覆盖范围内）。
  // 覆盖范围 = 从它第一个 move 的句子，到最后一个 move 的下一句。
  if (rules.metaphorLeash) {
    const cover = new Set();
    for (const b of story.beats.filter((x) => x.kind === "leash")) {
      cover.add(b.at);
      const idxs = (b.moves ?? []).map((m) => sentenceIds.indexOf(m.at)).filter((i) => i >= 0);
      if (idxs.length) {
        const lo = Math.min(...idxs);
        const hi = Math.min(Math.max(...idxs) + 1, sentenceIds.length - 1);
        for (let i = lo; i <= hi; i++) cover.add(sentenceIds[i]);
      }
    }
    for (const [id, text] of Object.entries(sentenceTexts)) {
      if (/狗|绳/.test(text) && !cover.has(id)) {
        errs.push(`${id}「${text}」讲到了狗或绳子，但这一句没有被 leash 元素覆盖。请用 leash 来表现（可以把前后几句关于狗和绳子的变化，合并成同一个 leash 的多个 moves），不要用单张贴图或卡片代替`);
      }
    }
  }
  // leash 播放期间(第一个 move 到最后一个 move)，不能有别的 C/L/R 镜头把它顶掉，否则后面的 moves 根本看不到。
  for (const b of story.beats.filter((x) => x.kind === "leash")) {
    const idxs = (b.moves ?? []).map((m) => sentenceIds.indexOf(m.at)).filter((i) => i >= 0);
    if (idxs.length < 2) continue;
    const lo = Math.min(...idxs), hi = Math.max(...idxs);
    for (const o of story.beats) {
      if (o === b || o.slot === "T") continue;
      const i = sentenceIds.indexOf(o.at);
      if (i > Math.min(...idxs) && i <= hi) {
        errs.push(`${o.at} 的 ${o.slot} 位置 ${o.kind} 镜头会把正在播放的 leash(${sentenceIds[lo]}~${sentenceIds[hi]})顶掉，后面的 moves 就看不到了。请删掉这个镜头，把它要表达的内容改成 leash 的 label/line，或者把 leash 拆短`);
      }
    }
  }
  // 带数字的 T 位置大字不能停留太久，否则旁白讲到下一个数字时，屏幕上还是旧数字
  {
    const tBeats = story.beats.filter((x) => x.slot === "T" && x.kind === "text").map((x) => ({ x, i: sentenceIds.indexOf(x.at) })).sort((a, b) => a.i - b.i);
    tBeats.forEach(({ x, i }, k) => {
      if (!/[0-9]/.test(x.text ?? "")) return;
      const next = k + 1 < tBeats.length ? tBeats[k + 1].i : sentenceIds.length;
      if (next - i > 3) errs.push(`${x.at} 的 T 大字「${x.text}」带数字，但要过 ${next - i} 句才会被替换，期间旁白会讲到别的数字，屏幕上的旧数字就错了。请在旁白换数字的那一句，再给一个新的 T 镜头更新它`);
    });
  }
  const innerIds = (b) => [b.at, b.newAt, b.animAt, ...(b.partSteps ?? []).map((m) => m.at), ...(b.focusSteps ?? []).map((m) => m.at), ...(b.hlSteps ?? []).map((m) => m.at), ...(b.nodes ?? []).map((m) => m.at), ...(b.edges ?? []).map((m) => m.at), b.hlAt, ...(b.moves ?? []).map((m) => m.at), ...(b.eqs ?? []).map((m) => m.at), ...(b.list ?? []).flatMap((m) => [m.at, m.statusAt]), ...(b.points ?? []).map((m) => m.at), ...(b.curves ?? []).map((m) => m.at), ...(b.marks ?? []).map((m) => m.at)].filter(Boolean);
  for (const b of story.beats.filter((x) => ["eq", "rows", "plot", "numberline", "dist", "fig", "table", "diagram", "eqx"].includes(x.kind))) {
    const idxs = innerIds(b).map((x) => sentenceIds.indexOf(x)).filter((i) => i >= 0);
    if (idxs.length < 2) continue;
    const lo = Math.min(...idxs);
    const hi = Math.max(...idxs);
    for (const o of story.beats) {
      if (o === b || o.slot === "T") continue;
      const i = sentenceIds.indexOf(o.at);
      if (i > lo && i <= hi) {
        errs.push(`${o.at} 的 ${o.slot} 位置 ${o.kind} 镜头会把正在播放的 ${b.kind}（${sentenceIds[lo]}~${sentenceIds[hi]}）顶掉，它后面的内容就看不到了。请删掉这个镜头，或者把 ${b.kind} 里靠后的内容挪到别的镜头`);
      }
    }
  }
  // 点阵标出的数量必须和标签里说的百分比一致（total 个点里，应该标 total × 百分比 个，可以是小数）
  for (const b of story.beats.filter((x) => x.kind === "dots")) {
    const m = String(b.label ?? "").match(/百分之([零〇一二三四五六七八九十点]+)/);
    if (!m) continue;
    const pctv = parseChineseNumber(`百分之${m[1]}`);
    if (pctv == null) continue;
    const want = b.total * pctv;
    if (Math.abs((b.marked ?? 0) - want) > 0.15) {
      errs.push(`beats（at=${b.at}）的 dots：标签说「百分之${m[1]}」，${b.total} 个点里应该标出 ${Number(want.toFixed(2))} 个，你写的 marked 是 ${b.marked}。marked 可以是小数（如 7.8，最后一个点会画成部分填充）`);
    }
  }
  // 语义兜底:旁白讲的是"剪切/清零/不再更新"(PPO、GRPO、DPPO 的硬做法)时，leash 当时的绳子不能是 spring(弹簧是 DRPO 的平滑纠正)。
  for (const b of story.beats.filter((x) => x.kind === "leash")) {
    for (const m of b.moves ?? []) {
      const text = sentenceTexts[m.at] ?? "";
      if (rules.springSemantics && m.line === "spring" && /剪|清零|不再更新|撒手|硬/.test(text) && !/弹簧|换成|拉回/.test(text)) {
        errs.push(`leash 在 ${m.at}「${text}」处用了 spring，但这句话讲的是硬剪切/清零/不再更新，弹簧是 DRPO 平滑纠正的象征，不能用来表现它们。请改成 cut（剪断）或 taut（绷直）`);
      }
    }
  }  // 视觉主体占比:纯文字、纯公式的镜头太多会像幻灯片。要求至少 40% 的镜头带贴图或图形（sticker/dots/bars/compare/flow，或带 sticker 的 card）
  const visual = story.beats.filter((b) => ["sticker", "dots", "bars", "compare", "flow", "leash", "grow", ...RICH_ONLY_C].includes(b.kind) || (b.kind === "card" && b.sticker));
  const ratio = visual.length / story.beats.length;
  if (ratio < 0.4) {
    errs.push(
      `带贴图或图形的镜头只占 ${(ratio * 100).toFixed(0)}%（${visual.length}/${story.beats.length}），要求至少 40%。` +
        `请把一些纯 formula / text / 不带 sticker 的 card 镜头，改成带贴图的 card、compare、sticker 或 flow。讲到蚂蚁、大象、剪刀、狗、天平时尤其要放对应的贴图`,
    );
  }
  // 公式镜头配贴图：formula 讲的是蚂蚁或大象时，旁边应该有对应形象。这里只检查"算式镜头不能连续出现 3 个"
  let run = 0;
  for (const id of sentenceIds) {
    const here = story.beats.filter((b) => b.at === id);
    if (!here.length) continue;
    const onlyFormula = here.every((b) => b.kind === "formula" || b.kind === "text");
    run = onlyFormula ? run + 1 : 0;
    if (run >= 3) {
      errs.push(`从 ${id} 附近开始，连续 3 个镜头都只有算式或大字，没有任何形象。请把其中一两个换成 canvas（画布：东西随旁白长出来、移动，适合讲"相对基准的变化、被推高或压低、一层层叠加"）、stage（角色演出来）、diagram 或 numberline，也可以穿插贴图、compare 或 sticker`);
      break;
    }
  }
  // 覆盖率：每个中央镜头从它的 at 句开始，管到下一个中央镜头（或清屏镜头）开始为止。
  // 静态镜头（卡片、对比、流程、贴图、算式、大字）管的句子不能太多，否则整段是"换图片"；画布要有一定覆盖，让讲解内容变成演示。
  {
    const idxOf = (id) => sentenceIds.indexOf(id);
    const cs = story.beats.filter((b) => b.slot === "C" || b.clear).map((b) => ({ b, i: idxOf(b.at) })).filter((x) => x.i >= 0).sort((a, c) => a.i - c.i);
    const span = (k) => {
      const here = cs[k];
      const next = cs.slice(k + 1).find((x) => x.i > here.i);
      return (next ? next.i : sentenceIds.length) - here.i;
    };
    let staticN = 0, canvasN = 0, eqxN = 0, paperN = 0;
    cs.forEach((x, k) => {
      if (x.b.slot !== "C") return;
      const n = span(k);
      if (["card", "compare", "flow", "sticker", "formula", "text", "dots", "bars"].includes(x.b.kind)) staticN += n;
      if (x.b.kind === "canvas") canvasN += n;
      if (x.b.kind === "eqx") eqxN += n;
      if (["fig", "table", "chart"].includes(x.b.kind)) paperN += n;
    });
    // 必须演出来的片段（demos）：每一处要有动画镜头覆盖、事件够多、有人物就要出场
    for (const d of ctx.demos ?? []) {
      const a = sentenceIds.indexOf(d.from), bI = sentenceIds.indexOf(d.to);
      if (a < 0 || bI < 0) continue;
      const cover = [];
      cs.forEach((x, k) => {
        if (x.b.slot !== "C") return;
        const next = cs.slice(k + 1).find((y) => y.i > x.i);
        const endI = (next ? next.i : sentenceIds.length) - 1;
        if (x.i <= bI && endI >= a) cover.push({ b: x.b, from: x.i, to: endI });
      });
      const range = `${d.from}${d.to !== d.from ? "~" + d.to : ""}`;
      const anim = cover.filter((c) => c.b.kind === "canvas" || c.b.kind === "stage");
      // eqx 的插入演示（insets）也算：落在这个范围里的 inset，把它当成一个自由画布
      for (const c of cover.filter((x) => x.b.kind === "eqx")) {
        for (const n of c.b.insets ?? []) {
          const ia = sentenceIds.indexOf(n.from), iz = sentenceIds.indexOf(n.to);
          if (ia <= bI && iz >= a) anim.push({ b: { kind: "canvas", form: "free", objs: n.objs, at: n.from }, from: ia, to: iz });
        }
      }
      if (!anim.length) {
        // 论文原图、原表、数据图本身就是演示（有聚焦、高亮、逐步显示），不再强求另画示意图（也避免编造数据）
        if (cover.some((c) => ["fig", "table", "chart", "stream"].includes(c.b.kind))) continue;
        const eqxCover = cover.find((c) => c.b.kind === "eqx");
        errs.push(`旁白 ${range} 需要演出来：${d.summary}。现在这几句的画面是 ${cover.map((c) => c.b.kind).join("、") || "空"}，没有动画。${eqxCover ? `这几句在公式 ${eqxCover.b.eq} 的 eqx 讲解范围内，请给那个 eqx 加 insets（{"from":"${d.from}","to":"${d.to}","objs":[自由动画对象]}），公式会缩到上方，下面演示。` : ""}请在 ${d.from} 放一个 canvas（form:"free"，用 char 和 icon 演人物和道具，或柱子、曲线、箭头演变化）或 stage，按这些画面事件演出来：${d.beats.map((x) => x.at + "→" + x.what).join("；")}`);
        continue;
      }
      // 逐个动作对时间：清单里每条画面事件的前后 2 秒内，动画必须有事件（不能全堆在句子开头，旁白讲到那个动作时画面却不动）
      {
        const times = anim.flatMap((c) => eventTimes(c.b, sentenceIds, sentenceTexts));
        for (const c of cover.filter((x) => x.b.kind === "eqx")) for (const n of c.b.insets ?? []) times.push(...eventTimes({ kind: "canvas", form: "free", objs: n.objs }, sentenceIds, sentenceTexts));
        const missed = (d.beats ?? []).filter((bt) => {
          const s = estimateSec(bt.at, sentenceIds, sentenceTexts);
          return s !== null && !times.some((t) => Math.abs(t - s) <= 2.0);
        });
        if (missed.length > Math.floor((d.beats?.length ?? 0) / 4)) {
          errs.push(`旁白 ${range} 里这些动作的那一刻，画面完全没有事件（前后 2 秒内没有任何对象出现、移动、变化、弹一下），观众听到了却看不到：${missed.map((x) => `${x.at}（${x.what}）`).join("；")}。请给这些时刻各写一个关键帧或让对象出现，时间锚点就用这些原话`);
        }
      }
      if ((d.actors?.length ?? 0) > 0) {
        const hasChar = anim.some((c) => (c.b.kind === "stage" && (c.b.cast?.length ?? 0) >= 1) || (c.b.kind === "canvas" && c.b.form === "free" && (c.b.objs ?? []).filter((o) => o.type === "char").length >= Math.min(2, d.actors.length)) || (c.b.kind === "canvas" && c.b.form === "motion" && (String(c.b.motion?.html ?? "").match(/<x-person\b/g) ?? []).length >= Math.min(1, d.actors.length)));
        if (!hasChar) errs.push(`旁白 ${range} 讲的是人物的事（${d.actors.map((x) => x.as).join("、")}），必须让这些人物出场演出来：在 free 画布里加 char 角色（${d.actors.map((x) => x.as + "=" + x.id).join("、")}）和需要的 icon 道具，让他们按旁白互动`);
      }
    }
    const total = sentenceIds.length;
    if (total >= 6 && story.beats.some((x) => x.kind === "eqx") && !story.beats.some((x) => x.kind === "canvas" || (x.kind === "eqx" && (x.insets?.length ?? 0) > 0))) {
      errs.push('场景里逐项讲了公式（eqx），还必须至少有一个 canvas 把这条公式"在做什么"演示出来，不能只有公式高亮。用 form:"free" 自己搭：比如柱子被乘上权重再归一化、曲线随参数变陡、几个量合成一个量。画布放在 eqx 之前或之后的句子上（中央同一时刻只能放一个镜头）');
    }
    if (total >= 6 && staticN / total > 0.3) {
      errs.push(`静态镜头（card、compare、flow、sticker、formula、text）占了 ${staticN}/${total} 句，超过 30%，画面会变成"换图片"。请把其中一些换成 canvas（边讲边演示：东西长出来、移动、涨落、分叉），或 stage、diagram`);
    }
    // 公式讲解为主、或论文原图原表占了四分之一以上的场景，不强求画布（实验结果要用论文里的真数字，不能画示意图代替）
    if (total >= 8 && eqxN / total < 0.5 && paperN / total < 0.25 && canvasN / total < 0.25) {
      errs.push(`画布（canvas）只覆盖 ${canvasN}/${total} 句，要求至少 25%。讲"怎么做、怎么变、怎么比"的地方请用 canvas 演示（版式：line 尺子上的点移动、bars 柱子涨落、row 流水线、tree 一生多或多合一），不要用卡片或大字转述`);
    }
  }
  // 整体节奏:不能长时间没有画面变化。要求每 4 句话内至少有 1 个新 beat。
  const order = sentenceIds;
  const withBeat = new Set(story.beats.flatMap(innerIds));
  let gap = 0;
  for (const id of order) {
    gap = withBeat.has(id) ? 0 : gap + 1;
    if (gap >= 5) {
      errs.push(`从 ${id} 附近开始，连续 5 句话没有新的画面，观众会觉得静止。请在其中补充镜头`);
      break;
    }
  }
  // 引用覆盖:前半段和后半段都要有 beat
  const half = Math.floor(order.length / 2);
  if (!order.slice(0, half).some((id) => withBeat.has(id))) errs.push("前半段旁白没有任何镜头");
  if (!order.slice(half).some((id) => withBeat.has(id))) errs.push("后半段旁白没有任何镜头");
  // 本场景要逐项讲解的每条公式，都必须有一个 eqx 镜头
  for (const fm of ctx.formulas ?? []) {
    if (!story.beats.some((x) => x.kind === "eqx" && x.eq === fm.eq)) errs.push(`本场景要逐项讲解公式 ${fm.eq}，但分镜里没有对应的 eqx 镜头。请加一个 {"kind":"eqx","slot":"C","eq":"${fm.eq}","at":"讲到这条公式的第一句"}（逐项的步骤由程序按旁白自动生成）`);
  }
  // ---- 多样性：避免像 PPT ----
  const main = story.beats.filter((b) => !(b.slot === "T" && b.kind === "text"));
  const count = {};
  main.forEach((b) => { if (b.kind === "canvas" && b.form === "motion") return; count[b.kind] = (count[b.kind] ?? 0) + 1; });
  const LIMIT = { card: 2, sticker: 2, compare: 3, text: 3, formula: 3, flow: 3, leash: 4, grow: 3, bars: 2, dots: 3, fig: 4, table: 3, chart: 3, diagram: 3, eqx: 3, stage: 4, canvas: 3 };
  for (const [k, n] of Object.entries(count)) {
    const lim = LIMIT[k] ?? 4;
    if (n > lim) errs.push(`整个场景里 ${k} 用了 ${n} 次，上限 ${lim} 次。重复用同一种元素会像 PPT，请把其中一些换成别的元素（dist、numberline、plot、eq、rows、leash、grow 等）`);
  }
  const RICH = new Set(["leash", "grow", "dist", "numberline", "plot", "eq", "rows", "title", "dots", "bars", "fig", "table", "chart", "diagram", "eqx", "stage", "canvas"]);
  const richN = main.filter((b) => RICH.has(b.kind)).length;
  if (richN / Math.max(main.length, 1) < 0.5) {
    errs.push(`有动画或数据图的镜头只占 ${richN}/${main.length}，要求至少一半。card、text、formula、compare、flow、sticker 都是静态的，只能当配角；请把更多镜头换成 leash、grow、dist、numberline、plot、eq、rows、dots`);
  }
  // 项目模式：旁白够长的场景至少要有一个角色小剧场，大字、卡片这类纯文字镜头合计不能占一半以上
  if (ctx.paper) {
    if (sentenceIds.length >= 7 && !story.beats.some((b) => b.kind === "stage" || b.kind === "canvas")) {
      errs.push(`整个场景没有 stage（角色小剧场）。旁白里有比喻、对比、提问、"想象一下"的地方，请用 stage 让角色演出来，代替大字或卡片`);
    }
    const textual = main.filter((b) => ["text", "card", "formula", "compare", "flow"].includes(b.kind)).length;
    if (textual / Math.max(main.length, 1) > 0.4) errs.push(`以文字为主的镜头（text、card、formula、compare、flow）占了 ${textual}/${main.length}，超过 40%，画面会很枯燥。请把其中一些换成 stage（角色演出来）、diagram、numberline 等`);
  }
  // 元素种类：canvas 按版式分开算（line/row/bars/tree/free 是不同的演示方式），eqx 带 insets 也多算一种
  const kindSig = (b) => (b.kind === "canvas" ? `canvas:${b.form ?? "x"}` : b.kind);
  const kindSet = new Set([...main.map(kindSig), ...main.filter((b) => b.kind === "eqx" && (b.insets?.length ?? 0) > 0).map(() => "eqx+演示")]);
  if (kindSet.size < Math.min(4, Math.ceil(sentenceIds.length / 3))) {
    errs.push(`整个场景只用了 ${kindSet.size} 种元素，太单一，请至少用 4 种不同的元素（canvas 的 line、row、bars、tree、free 版式各算一种；eqx 加 insets 也算一种）`);
  }
  {
    const cs = story.beats.filter((b) => b.slot === "C").sort((a, b) => sentenceIds.indexOf(a.at) - sentenceIds.indexOf(b.at));
    for (let i = 1; i < cs.length; i++) {
      // canvas、stage 是一个个独立的演示（内容不同），连续出现是正常的（每个演示自己有"不能停住"的约束）
      if (cs[i].kind === cs[i - 1].kind && !(cs[i].clear === false) && cs[i].kind !== "canvas" && cs[i].kind !== "stage") {
        errs.push(`中央位置连续两个镜头都是 ${cs[i].kind}（${cs[i - 1].at} 和 ${cs[i].at}），请在中间换一种元素，或者把它们合并成一个有多个变化的镜头`);
        break;
      }
    }
  }
  return errs;
}

const STREAM_DOC = `
23. stream（模型输出样例，逐字打出）：**旁白在讲论文里"模型实际输出了什么"（生成的文字、退化的输出、前后对比的样例）时用它，不要用 card 或 text 转述。** 文字一个字一个字打出来，关键短语依次高亮。
   {"kind":"stream","slot":"C","at":"g11","label":"论文里模型的真实输出","text":"girl when when when when when","phrases":["when"]}
   - **text 必须是论文原文里逐字出现的片段**（8 到 160 字符），从论文里的样例原样复制，不能改写、不能自己编。校验器会去论文里核对。
   - phrases：要点亮的关键短语（最多 5 个），必须是 text 里的原样片段，按出现先后依次点亮。
   - label：不超过 20 字，写明这是什么（如"论文里模型的真实输出"），观众要知道这是真实样例而不是示意。
`;
const STAGE_DOC = () => `
22. stage（角色小剧场）：**旁白在打比方、讲故事、做对比、提问、表达"想不通/恍然大悟"的地方，用它代替大字和卡片。** 1 到 3 个角色站在台上，随旁白出场、做动作、说一句话、头上冒出表情、手边出现道具。观众看到的是"人在演"，而不是一行字。
   {"kind":"stage","slot":"C","at":"i5","cast":[{"id":"t","look":"teacher","tag":"老师","pos":"left"},{"id":"s","look":"student","tag":"学生","pos":"right"}],"acts":[{"at":"i5","who":"t","do":"enter","say":"这道题谁答得好？"},{"at":"i6","who":"s","do":"enter","mood":"thinking-face"},{"at":"i7","who":"s","do":"bounce","say":"我选左边那个！","mood":"light-bulb","look":"person-raising-hand"},{"at":"i8","who":"t","do":"nod","say":"对，要多奖励好答案","prop":"thumbs-up"}]}
   - cast：每个演员 {id, look, tag, pos}。look 从下面"可用角色"里选；tag 是头像下的小标签，不超过 5 字，用来说明这个角色代表什么（"老师""新模型""评委""厨师"）；pos 取 left/center/right，两个演员不能同位置。
   - acts：2 到 8 步，按旁白先后顺序，第一步的 at 必须等于镜头的 at。每步 {at, who, do, say, look, mood, prop}，只有 at 和 who 必填：
     · do：enter 出场（演员第一次出现时用）/ bounce 蹦一下（高兴、恍然大悟）/ shake 左右摇（否定、不对）/ nod 点头 / wiggle 晃一晃（困惑）/ grow 变大（变强、变重要，持续到后面）/ shrink 变小 / idle 不动。
     · say：这一步说的一句台词，**不超过 18 字，不含数字、英文和符号**，口语化，像对话。台词不承载论文里的事实，数字和结论仍由旁白来讲。
     · look：这一步起换成另一个姿势或角色（比如 person-raising-hand 举手、person-gesturing-no 摆手、person-facepalming 捂脸、person-lifting-weights 费力、person-cartwheeling 兴奋）。
     · mood：头上冒出一个小贴图（thinking-face 想、light-bulb 想通了、exploding-head 懵了、sparkles、fire、warning、check-mark-button、cross-mark），从贴图名里选。
     · prop：手边出现一个道具贴图（books、memo、coin、trophy、magnifying-glass-tilted-left、scissors、balance-scale、thumbs-up、cross-mark、key、locked、gear 等），从贴图名里选。
   - 用法：一个比喻用一个 stage 演完，不要每句都换演员。比喻里的角色要和旁白一致：旁白说"厨师和评委"，就用 cook 和 judge；旁白说"老师批改卷子"，就用 teacher。
   - stage 占用中央位置，演出期间不要在 C 放别的镜头。
   - 可用角色（look 的取值）：
${CHARS.map((c) => `     ${c.id}（${c.zh}）`).join("\n")}
`;
const GENERIC_DOC = `
21. eqx（公式逐项讲解）：**讲一条公式，必须用它。** 整条公式放大居中，旁白讲到公式的哪一项，那一项就高亮（其余变淡），下面画下划线和名字标签，再写出"为什么"。
   {"kind":"eqx","slot":"C","eq":"eq4","at":"讲到这条公式的第一句"}
   - eq 是"本场景要逐项讲解的公式"清单里的 id；每条清单里的公式都必须有一个 eqx 镜头。
   - 你只需要写 eq 和 at。每一项什么时候高亮，由程序按旁白里的关键词自动对齐，不要自己写 steps。
   - eqx 占用的时间段（从 at 到最后一项）里，不要再放别的中央镜头。eqx 之前可以先用 numberline、diagram 等把例子讲清楚。
17. fig（论文原图）：把论文里的图原样放上来，并随旁白逐步放大到图的某一块，配一句说明。**旁白在讲论文的某张图（实验曲线、结构图、对比图）时必须用它，不要自己画。**
   {"kind":"fig","slot":"C","ref":"F3","focusSteps":[{"at":"e6","focus":"all","label":"六组实验的总体结果"},{"at":"e8","focus":"left","label":"比例类方法在低精度下崩了"}]}
   - ref 是论文图的编号（见"可用的图"清单）；focus 取 all 整图 / left 左半 / right 右半 / top 上半 / bottom 下半 / tl tr bl br 四个角 / center 中心放大；至少 1 步，最多 5 步，at 是切换到这一块的句子；label 不超过 26 字。
   - 你看不到图的内容，只能根据图的说明文字（caption）和旁白判断看哪一块；拿不准就用 all，不要乱猜左右。
18. table（论文原表）：把论文里的表放上来，只显示讲到的行列，随旁白高亮某些行或列。
   {"kind":"table","slot":"C","ref":"T1","showRows":[0,1,3],"showCols":[0,2,3],"hlSteps":[{"at":"s4","rows":[1],"label":"SPO 的权重没有上限"},{"at":"s6","rows":[3],"label":"DRPO 有界"}]}
   - ref 是论文表的编号（见"可用的表"清单，清单里给出了每一行每一列的序号，从 0 开始）；showRows 必须包含表头 0，最多 8 行 6 列；hlSteps 的 rows/cols 必须是 showRows/showCols 里的序号；label 不超过 26 字。
19. chart（数据图）：把论文里出现过的数字画成条形图或折线图。**每个 y 值必须是论文正文或表格里出现过的数字，不能估算、不能编。**
   {"kind":"chart","slot":"C","chartType":"bar","label":"AIME 准确率","series":[{"name":"GRPO","points":[{"x":"4B","y":0.17},{"x":"30B","y":0.31}]}],"hlAt":"e11","hlX":"4B"}
   - chartType 是 bar 或 line；series 1 到 3 组，每组 2 到 8 个点，每组点数相同；x 是类别名，不超过 8 字；hlAt/hlX 可选，在某句话时把某一类高亮。
20. diagram（架构图/流程图）：用节点和箭头画出方法的结构，节点逐个弹出，箭头上有小圆点流动。**讲方法的整体流程、模块之间的关系时用它。**
   {"kind":"diagram","slot":"C","layout":"lr","nodes":[{"id":"a","label":"提示词","sticker":"memo","at":"m1"},{"id":"b","label":"模型","sticker":"robot","at":"m2"},{"id":"c","label":"奖励","sticker":"trophy","at":"m3"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"c","label":"打分"}]}
   - 2 到 7 个节点，label 不超过 10 字，不能有环（只能画单向流程）；at 是节点弹出的句子，省略则和镜头同时；边的 label 不超过 8 字。
`;

/**
 * 按项目生成给模型看的说明书。
 *  opts.leash:是否保留"遛狗"比喻的 leash 元素（只有 DRPO 这支视频用）
 *  opts.drpoPlots:是否保留 plot 预设和公式库（同上）
 *  opts.paper:{ equations, figures, tables } 用来列出"可用的公式、图、表"清单
 */
export function buildElementDoc(opts = {}) {
  let d = ELEMENT_DOC;
  if (!opts.leash) {
    d = d.replace(/\n9\. leash[\s\S]*?(?=\n10\. grow)/, "").replace(/leash、/g, "").replace(/[，、]?leash/g, "");
  }
  if (!opts.drpoPlots) {
    d = d.replace(/\n14\. plot[\s\S]*?(?=\n15\. eq)/, "");
    d = d.replace(/\n15\. eq[\s\S]*?(?=\n16\. rows)/, `
15. eq（推导步骤栈）：把论文里的公式一行一行叠起来，每行在对应句子弹出，最新一行高亮。**这个 eq 只用来一闪而过地引用某条公式；要讲解一条公式，一律用 eqx。**公式只能引用论文里的原式，不要自己写。
   {"kind":"eq","slot":"C","eqs":[{"at":"v2","eq":"eq5","title":"目标函数","note":"多乘了旧概率","hl":["\\\\mu(y_t|s_t)"]},{"at":"v6","eq":"eq9","title":"梯度权重"}]}
   - eq 是"可用的公式"清单里的 id；hl 是要高亮的 LaTeX 片段，必须从那条公式里原样复制（括号要成对）；注意 JSON 里的反斜杠要写成两个，如 \\\\mu；title 不超过 8 字，note 不超过 18 字；eqs 1 到 4 行，at 是该行弹出的句子。
`);
    d = d.replace("plot、", "").replace("、plot", "");
  }
  d = d.replace("【分镜整体结构】", GENERIC_DOC + STAGE_DOC() + STREAM_DOC + CANVAS_DOC + "【分镜整体结构】");
  if (opts.paper) {
    const P = opts.paper;
    const lines = [];
    if (opts.listEquations !== false && P.equations?.length) {
      lines.push("【可用的公式】（只能用 eq 引用这些 id）");
      for (const e of P.equations.filter((q) => !opts.eqIds || opts.eqIds.includes(q.id))) lines.push(`  ${e.id}${e.num ? " " + e.num : ""}：${e.tex.slice(0, 160)}`);
    }
    if (P.figures?.length) {
      lines.push("【可用的图】（fig 的 ref）");
      for (const f of P.figures.filter((q) => q.file && (!opts.figIds || opts.figIds.includes(q.id)))) lines.push(`  ${f.id}：${(f.caption ?? "").slice(0, 160)}`);
    }
    if (P.tables?.length) {
      lines.push("【可用的表】（table 的 ref；行列序号从 0 开始）");
      for (const t of P.tables.filter((q) => !opts.tableIds || opts.tableIds.includes(q.id))) {
        lines.push(`  ${t.id}：${(t.caption ?? "").slice(0, 100)}`);
        t.rows.slice(0, 10).forEach((r, i) => lines.push(`     行${i}：${r.map((c, j) => `[${j}]${c.slice(0, 40)}`).join(" ")}`));
      }
    }
    d += "\n" + lines.join("\n");
  }
  return d;
}

/**
 * 公式逐项讲解的对齐：把每个 eqx 镜头的"第几项在哪一句话出现"，按旁白里的关键词自动算出来。
 * 规则：从上一项所在句的下一句起，第一个含有该项 say 词之一的句子，就是这一项出现的时间。
 * 这样画面和旁白一定同步，不靠模型猜。formulas 来自 plan.json 里该场景的 formulas。
 */
export function syncEqx(story, formulas, sentences) {
  // 一个场景里有多条公式时，按旁白先后依次处理：后一条公式的各项从前一条讲完之后才开始找说出词。
  // 否则两条公式共用的词（比如都有"惩罚系数"）会让后一条匹配到前一条的讲解范围里，两个 eqx 时间段重叠，永远过不了校验
  let floor = -1;
  const order = (x) => formulas?.findIndex((f) => f.eq === x.eq);
  const eqxBeats = (story?.beats ?? []).filter((b) => b.kind === "eqx").sort((a, b) => order(a) - order(b));
  for (const b of eqxBeats) {
    const fm = (formulas ?? []).find((f) => f.eq === b.eq);
    if (!fm) continue;
    b.parts = fm.parts.map((p) => ({ tex: p.tex, name: p.name, role: p.role, why: p.why, ...(p.actor ? { actor: p.actor } : {}) }));
    b.overview = fm.overview;
    // 后一条公式要给自己的 eqx 留出开场的一句（镜头在第一项的前一句出现），所以第一项至少在前一条讲完之后的第二句
    let prev = floor >= 0 ? floor + 1 : -1;
    const steps = [];
    fm.parts.forEach((p, k) => {
      let idx = sentences.findIndex((s, i) => i > prev && p.say.some((w) => s.text.toLowerCase().includes(String(w).toLowerCase())));
      if (idx < 0) idx = Math.min(sentences.length - 1, prev + 1);
      steps.push({ at: sentences[idx].id, part: k });
      prev = idx;
    });
    b.partSteps = steps;
    floor = prev;
    // 镜头至少在第一项的前一句出现，让观众先看到整条公式
    const first = sentences.findIndex((s) => s.id === steps[0].at);
    const cur = sentences.findIndex((s) => s.id === b.at);
    if (cur < 0 || cur > Math.max(0, first - 1)) b.at = sentences[Math.max(0, first - 1)].id;
  }
}
