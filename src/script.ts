// 文案时间表:画面时序与字幕全部由这里驱动。
// 以后接入配音时,只需要把每个场景的 dur 和 cues 的时间换成语音实际时长,画面代码不用改。
export const FPS = 30;

export type Cue = { from: number; to: number; text: string }; // 秒,相对场景开头

export type SceneId =
  | "hook"
  | "problem"
  | "titlecard"
  | "numbers"
  | "space"
  | "pull"
  | "vector"
  | "outro";

export type SceneSpec = { id: SceneId; dur: number; cues: Cue[] }; // dur 单位:秒

export const SCENES: SceneSpec[] = [
  {
    id: "hook",
    dur: 8,
    cues: [
      { from: 0, to: 3, text: "这句话，你一眼就能读懂" },
      { from: 3, to: 6, text: "但计算机，会被它绕晕" },
      { from: 6, to: 8, text: "为什么？" },
    ],
  },
  {
    id: "problem",
    dur: 16,
    cues: [
      { from: 0, to: 4, text: "5 个字里，有 3 个「行」" },
      { from: 4, to: 9, text: "第一个读 háng，是「银行」" },
      { from: 9, to: 13, text: "后两个读 xíng，是「可以」" },
      { from: 13, to: 16, text: "同一个字，意思却不一样" },
    ],
  },
  {
    id: "titlecard",
    dur: 5,
    cues: [{ from: 0, to: 5, text: "计算机该怎么理解每个字的含义？" }],
  },
  {
    id: "numbers",
    dur: 18,
    cues: [
      { from: 0, to: 5, text: "计算机只认识数字，先要把字变成编号" },
      { from: 5, to: 11, text: "最简单的办法：用字符编码，比如 Unicode" },
      { from: 11, to: 15, text: "可三个「行」拿到的是同一个编号" },
      { from: 15, to: 18, text: "编号只是数字，装不下任何含义" },
    ],
  },
  {
    id: "space",
    dur: 28,
    cues: [
      { from: 0, to: 5, text: "于是，我们想象一个二维坐标系" },
      { from: 5, to: 10, text: "横轴：这个词和金钱有多相关" },
      { from: 10, to: 15, text: "纵轴：这个词有多接近「可以」" },
      { from: 15, to: 20, text: "银行、存款、利息，落在右下角" },
      { from: 20, to: 25, text: "可以、没问题、靠谱，落在左上角" },
      { from: 25, to: 28, text: "意思相近的词，位置也靠得很近" },
    ],
  },
  {
    id: "pull",
    dur: 15,
    cues: [
      { from: 0, to: 5, text: "单独看一个「行」，它只能站在中间" },
      { from: 5, to: 10, text: "结合前面的「银」，它被拉向银行" },
      { from: 10, to: 15, text: "结合后面的「不」，它被拉向「可以」" },
    ],
  },
  {
    id: "vector",
    dur: 12,
    cues: [
      { from: 0, to: 4, text: "每个位置，都是一组坐标，也就是一组数字" },
      { from: 4, to: 8, text: "这组数字就叫向量，也叫 embedding" },
      { from: 8, to: 12, text: "维度越多，能装下的语义就越细" },
    ],
  },
  {
    id: "outro",
    dur: 6,
    cues: [{ from: 0, to: 6, text: "下一讲：模型怎样判断该看哪些词？" }],
  },
];

export const TOTAL_FRAMES = SCENES.reduce((s, sc) => s + Math.round(sc.dur * FPS), 0);
