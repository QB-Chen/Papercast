// 渲染器里固定出现的界面文字（"示意图"、"为什么："……）和字幕切分，按视频语言切换。
// 和 setStickerPack 一样用模块级变量：StoryVideoView 在渲染开头设置一次，下面的元素直接读，不用逐层传参。
export type Lang = "zh" | "en";
let LANG: Lang = "zh";
export const setLang = (l?: string) => {
  LANG = l === "en" ? "en" : "zh";
};
export const getLang = (): Lang => LANG;

const STR = {
  zh: {
    schematic: "示意图",
    why: "为什么：",
    partOf: (i: number, n: number) => `第 ${i} / ${n} 项`,
    step: (i: number) => `第 ${i} 步`,
    formula: "公式",
    codeError: "动画代码出错：",
  },
  en: {
    schematic: "Illustration",
    why: "Why: ",
    partOf: (i: number, n: number) => `Part ${i} of ${n}`,
    step: (i: number) => `Step ${i}`,
    formula: "Formula",
    codeError: "Animation error: ",
  },
};
export const T = () => STR[LANG];

/** 底部字幕按标点切成一行放得下的几段。中文按字符数，英文按词（不在单词中间断开） */
export const splitCaptionLang = (text: string, lang: Lang, maxZh = 30, maxEn = 52): string[] => {
  if (lang !== "en") return splitZh(text, maxZh);
  // 先按标点切成子句（小数点 4.1 后面没有空格，不会被切开），再贪心合并到一行放得下；太长的子句按词均分
  const clauses = text.trim().split(/(?<=[,;:.?!]["')\]]?)\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const c of clauses) {
    if (!cur || (cur + " " + c).length <= maxEn) cur = cur ? `${cur} ${c}` : c;
    else {
      out.push(cur);
      cur = c;
    }
  }
  if (cur) out.push(cur);
  return out.flatMap((seg) => {
    if (seg.length <= maxEn + 10) return [seg];
    const words = seg.split(" ");
    const n = Math.ceil(seg.length / maxEn);
    const size = Math.ceil(words.length / n);
    return Array.from({ length: n }, (_, i) => words.slice(i * size, (i + 1) * size).join(" ")).filter(Boolean);
  });
};

const splitZh = (text: string, max: number): string[] => {
  const parts = text.match(/[^，。？！；：、]+[，。？！；：、]?/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (!cur || [...cur + p].length <= max) cur += p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out.flatMap((seg) => {
    const chars = [...seg];
    if (chars.length <= max + 6) return [seg];
    const n = Math.ceil(chars.length / max);
    const size = Math.ceil(chars.length / n);
    return Array.from({ length: n }, (_, i) => chars.slice(i * size, (i + 1) * size).join(""));
  });
};
