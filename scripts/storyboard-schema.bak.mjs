// 分镜脚本的校验器与"给模型看的元素说明书"。字段约定与 src/story/types.ts 保持一致。
import { readdirSync, readFileSync } from "node:fs";

export const SLOTS = ["T", "C", "L1", "L2", "R1", "R2"];
export const KINDS = ["text", "card", "formula", "compare", "dots", "bars", "flow", "sticker", "leash", "grow", "title", "dist", "numberline", "plot", "eq", "rows"];
const RICH_ONLY_C = ["title", "dist", "numberline", "plot", "eq", "rows"];
export const EQLIB = JSON.parse(readFileSync("src/story/eqlib.json", "utf8"));
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

/** 校验分镜;sentenceIds 为本场景旁白的句子 id 列表 */
export function validateStoryboard(story, sentenceIds, sentenceTexts = {}) {
  const errs = [];
  const ids = new Set(sentenceIds);
  const stickers = new Set(stickerNames());
  if (!story || typeof story !== "object") return ["顶层必须是对象"];
  if (typeof story.tag !== "string" || !story.tag.trim()) errs.push("缺少 tag");
  if (story.heading) {
    if (!ids.has(story.heading.at)) errs.push(`heading.at 引用了不存在的句子 ${story.heading.at}`);
    if ([...(story.heading.text ?? "")].length > 14) errs.push(`heading.text 太长（${[...story.heading.text].length} 字，上限 14）`);
    if (story.heading.sticker && !stickers.has(story.heading.sticker)) errs.push(`heading.sticker 不存在：${story.heading.sticker}`);
  }
  if (!Array.isArray(story.beats) || story.beats.length < 6) return [...errs, "beats 至少 6 个"];

  const checkSticker = (name, where) => {
    if (name && !stickers.has(name)) errs.push(`${where} 的贴图 "${name}" 不存在。可用贴图：${[...stickers].join("、")}`);
  };
  const tooLong = (s, max, where) => {
    if ([...(s ?? "")].length > max) errs.push(`${where} 太长（${[...s].length} 字，上限 ${max}）：「${s}」`);
  };

  story.beats.forEach((b, i) => {
    const w = `beats[${i}]（at=${b.at}）`;
    if (!ids.has(b.at)) errs.push(`${w} 引用了不存在的句子 id`);
    if (!SLOTS.includes(b.slot)) errs.push(`${w} 的 slot 不合法：${b.slot}`);
    if (!KINDS.includes(b.kind)) errs.push(`${w} 的 kind 不合法：${b.kind}`);
    if (b.tone && !TONES.includes(b.tone)) errs.push(`${w} 的 tone 不合法：${b.tone}`);
    const smallSlot = ["L1", "L2", "R1", "R2"].includes(b.slot);
    if (b.slot === "T" && !["text", "formula"].includes(b.kind)) errs.push(`${w}：T 位置太矮，只能放 text 或 formula`);
    if (smallSlot && ["compare", "flow", "dots", "leash", "grow"].includes(b.kind)) errs.push(`${w}：${b.kind} 太大，请放在 C 位置`);
    if (b.slot === "T" && ["leash", "grow"].includes(b.kind)) errs.push(`${w}：${b.kind} 只能放在 C 位置`);
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
    if (/[α-ωΑ-Ω]/.test(JSON.stringify(b))) errs.push(`${w} 含希腊字母，请改成中文说法`);
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
  const OBJECT_STICKERS = [
    { word: "蚂蚁", stickers: ["ant"] },
    { word: "大象", stickers: ["elephant"] },
    { word: "剪切", stickers: ["scissors"] },
    { word: "剪掉", stickers: ["scissors"] },
    { word: "天平", stickers: ["balance-scale"] },
  ];
  const stickersAt = (id) => {
    const out = new Set();
    for (const b of story.beats.filter((x) => x.at === id)) {
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
  {
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
      if (m.line === "spring" && /剪|清零|不再更新|撒手|硬/.test(text)) {
        errs.push(`leash 在 ${m.at}「${text}」处用了 spring，但这句话讲的是硬剪切/清零/不再更新，弹簧是 DRPO 平滑纠正的象征，不能用来表现它们。请改成 cut（剪断）或 taut（绷直）`);
      }
    }
  }  // 视觉主体占比:纯文字、纯公式的镜头太多会像幻灯片。要求至少 40% 的镜头带贴图或图形（sticker/dots/bars/compare/flow，或带 sticker 的 card）
  const visual = story.beats.filter((b) => ["sticker", "dots", "bars", "compare", "flow", "leash", "grow"].includes(b.kind) || (b.kind === "card" && b.sticker));
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
      errs.push(`从 ${id} 附近开始，连续 3 个镜头都只有算式或大字，没有任何形象。请在其中穿插贴图、compare 或 sticker`);
      break;
    }
  }
  // 整体节奏:不能长时间没有画面变化。要求每 4 句话内至少有 1 个新 beat。
  const order = sentenceIds;
  const withBeat = new Set(story.beats.map((b) => b.at));
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
  return errs;
}
