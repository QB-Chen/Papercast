// 分镜脚本(由大语言模型设计)的类型定义。渲染器与校验器共用这份约定。

/** 画面位置:把画布分成 6 个格子 + 顶部横条 + 整屏。同一位置后出现的元素会替换先前的,所以不会重叠 */
export const SLOTS = ["T", "C", "L1", "L2", "R1", "R2"] as const;
export type Slot = (typeof SLOTS)[number];

/** 位置对应的画面矩形(1920×1080 画布,字幕在 y≥930 的区域) */
export const SLOT_RECT: Record<Slot, { x: number; y: number; w: number; h: number }> = {
  T: { x: 70, y: 130, w: 1780, h: 150 }, // 顶部横条:标题、一句话结论
  C: { x: 70, y: 300, w: 1780, h: 600 }, // 整屏中央:大图、对比、流程
  L1: { x: 70, y: 300, w: 870, h: 290 }, // 左上
  L2: { x: 70, y: 610, w: 870, h: 290 }, // 左下
  R1: { x: 980, y: 300, w: 870, h: 290 }, // 右上
  R2: { x: 980, y: 610, w: 870, h: 290 }, // 右下
};

/**
 * 位置互斥:C 占满中央,会同时清掉 L1 L2 R1 R2;反过来在 L/R 位置放元素,会清掉 C。
 * 这样中央大图和左右小图不会叠在一起。
 */
export const CONFLICTS: Record<Slot, Slot[]> = {
  T: [],
  C: ["L1", "L2", "R1", "R2"],
  L1: ["C"],
  L2: ["C"],
  R1: ["C"],
  R2: ["C"],
};

export type Tone = "teal" | "orange" | "pink" | "navy" | "gray";

/** 元素种类。每种的字段见 ELEMENT_DOC(给模型看)与 validate.ts(校验) */
export type ElementKind = "text" | "card" | "formula" | "compare" | "dots" | "bars" | "flow" | "sticker" | "leash" | "grow" | "title" | "dist" | "numberline" | "plot" | "eq" | "rows" | "fig" | "table" | "chart" | "diagram" | "eqx" | "stage" | "stream" | "paperbar" | "canvas";

/** leash 里狗的位置(以信任区域圆的半径为单位:inside 圈内,edge 在边界,outside 刚出圈,far 跑远了) */
export type DogPos = "inside" | "edge" | "outside" | "far";
/** 绳子的样子:slack 松垂,taut 绷直,spring 弹簧,cut 剪断 */
export type LineKind = "slack" | "taut" | "spring" | "cut";
export type LeashMove = { at: string; dog: DogPos; line: LineKind; label?: string };
export type GrowRow = { label: string; sticker?: string; from: number; to: number; tone?: Tone };

export type Beat = {
  at: string; // 在哪句旁白开始时出现(句子 id)
  slot: Slot;
  kind: ElementKind;
  tone?: Tone;
  // text
  text?: string;
  // card
  title?: string;
  lines?: string[];
  sticker?: string;
  // formula
  formula?: string; // 用 {{ }} 包住要高亮的部分
  note?: string;
  // compare
  left?: SideSpec;
  right?: SideSpec;
  vs?: string;
  // dots
  total?: number;
  marked?: number;
  unitNote?: string;
  label?: string;
  // bars
  items?: { label: string; value: number; display?: string; tone?: Tone }[];
  // flow
  steps?: { text: string; sticker?: string; tone?: Tone }[];
  // sticker(s)
  stickers?: { name: string; caption?: string }[];
  // leash:狗和牵引绳的运动，moves 里每一项在对应句子开始时切换状态
  moves?: LeashMove[];
  circleLabel?: string;
  // grow:同一把尺子下的数值增长
  rows?: GrowRow[];
  scale?: number;
  animAt?: string;
  // title:标题页(paper=true 时显示论文名和单位)
  paper?: boolean;
  // dist:概率分布柱状图。preset="longtail" 画长尾词表示意；否则用 tokens 画旧→新的概率变化
  preset?: "longtail" | "weight" | "blowup";
  tokens?: { label: string; old: number; new?: number }[];
  newAt?: string; // 在这句旁白开始时，柱子从旧值变成新值
  highlight?: number[]; // 要高亮的柱子序号(从 0 开始)
  // numberline:数轴
  axis?: { min: number; max: number; step?: number; fmt?: "num" | "pct" };
  band?: { from: number; to: number; label: string };
  points?: { at: string; label: string; sticker?: string; from: number; to?: number; tone?: Tone }[];
  // plot:函数曲线(preset = weight | blowup)
  curves?: { id: string; at: string; label?: string }[];
  marks?: { at: string; x: number; on?: string }[];
  delta?: number;
  // eq:推导步骤栈，ref 只能是 eqlib.json 里的公式 id
  // 每行可以引用公式库(ref)，或者引用论文原文里的公式(eq = equations.json 的 id，hl = 要高亮的 LaTeX 片段；tex 由构建脚本填入)
  eqs?: { at: string; ref?: string; eq?: string; hl?: string[]; title?: string; note?: string; tex?: string }[];
  // eqx:公式逐项讲解。eq = equations.json 的 id；parts/overview/partSteps 由程序按 plan 和旁白自动生成；tex 由 build-props 填入
  eq?: string;
  tex?: string;
  overview?: string;
  parts?: { tex: string; name: string; role: string; why: string; actor?: { look: string; mood?: string; prop?: string } }[];
  partSteps?: { at: string; part: number }[];
  // eqx 的插入演示：这几句里公式缩到上方，下方换成自由动画（objs 的写法同 canvas 的 form:"free"）
  insets?: { from: string; to: string; objs?: FreeObj[]; motion?: { html: string; css?: string; script: string; w?: number; h?: number; plan?: string } }[];
  // fig:论文原图。ref = figures.json 的 id；figInfo 由构建脚本填入；focusSteps 里的 focus 取 all/left/right/top/bottom/tl/tr/bl/br/center
  ref?: string;
  figInfo?: { file: string | null; w: number; h: number; caption?: string; parts?: { file: string; w: number; h: number }[] };
  focusSteps?: { at: string; focus: string; label?: string }[];
  // table:论文原表。ref = tables.json 的 id
  tableInfo?: { rows: string[][]; caption?: string };
  showRows?: number[];
  showCols?: number[];
  hlSteps?: { at: string; rows?: number[]; cols?: number[]; label?: string }[];
  // chart:条形图/折线图，数据必须是论文里出现过的数字
  chartType?: "bar" | "line";
  series?: { name: string; points: { x: string; y: number }[] }[];
  hlAt?: string;
  hlX?: string;
  // diagram:架构图/流程图
  nodes?: { id: string; label: string; sticker?: string; tone?: Tone; at?: string }[];
  edges?: { from: string; to: string; label?: string; at?: string }[];
  layout?: "lr" | "tb";
  // rows:清单
  list?: { at: string; label: string; sub?: string; sticker?: string; status?: "ok" | "bad" | "warn" | "idea"; statusAt?: string; verdict?: string; tone?: Tone }[];
  // stage:角色小剧场。cast 是演员（look 取自 chars.json），acts 按旁白句子安排出场、动作、台词、表情、道具
  cast?: { id: string; look: string; tag?: string; pos?: "left" | "center" | "right" }[];
  acts?: { at: string; who: string; do?: "enter" | "bounce" | "shake" | "nod" | "grow" | "shrink" | "wiggle" | "idle"; say?: string; look?: string; mood?: string; prop?: string }[];
  // stream:论文里真实的模型输出，逐字打出（text 必须是论文原文），phrases 是依次点亮的关键短语，label 说明这是什么
  phrases?: string[];
  // paperbar:论文条，数据由程序填入（不让模型写，避免拼错人名）：论文名、作者、发表信息、首页缩略图
  paperInfo?: { title: string; authors: string; venue: string; shot?: string };
  // canvas:画布。cv 是图形原件列表（dot/box/vec/axis/arrow/text/ring/brace），坐标按 1600×520；schematic=false 时不显示"示意图"角标
  cv?: CanvasItem[];
  // canvas 的 form:"free" 时用 objs：模型自己搭的动画对象（见 free.tsx）
  form?: string;
  objs?: FreeObj[];
  // canvas 的 form:"motion"：模型写的 HTML + CSS + GSAP 时间线脚本（见 motion.tsx）
  motion?: { html: string; css?: string; script: string; w?: number; h?: number; plan?: string };
  schematic?: boolean;
  // 在这句旁白开始时清空所有位置(用于换场景阶段)
  clear?: boolean;
};

type EaseN = "out" | "circ" | "soft" | "pop" | "bounce" | "spring" | "snap";
export type CanvasItem = {
  id: string;
  type: "dot" | "box" | "vec" | "axis" | "arrow" | "text" | "ring" | "brace" | "bar";
  at: string; // 在这句旁白开始时出现
  until?: string; // 在这句旁白开始时淡出
  x?: number; y?: number; x2?: number; y2?: number; w?: number; h?: number; r?: number;
  n?: number; cw?: number; ch?: number;
  text?: string; size?: number; tone?: Tone | "green"; sticker?: string; fill?: boolean;
  enter?: EaseN;
  dur?: number;
  moves?: { at: string; x: number; y?: number; h?: number; dur?: number; ease?: EaseN }[];
  arrow?: boolean; flow?: boolean; pulse?: string[]; width?: number; bend?: number; align?: "left" | "center"; dir?: "up" | "down"; seed?: number; pad?: number;
};

type EaseF = "out" | "circ" | "soft" | "pop" | "bounce" | "spring" | "snap";
/** 自由动画的关键帧：到 at 这个时刻，列出的属性平滑过渡到目标值（text、tone 是瞬间切换） */
export type FreeKey = {
  at: string; dur?: number; ease?: EaseF;
  x?: number; y?: number; w?: number; h?: number; r?: number; o?: number; s?: number; rot?: number; mark?: number;
  vals?: number[]; params?: Record<string, number>; text?: string; tone?: string;
  look?: string; say?: string; mood?: string; act?: "bounce" | "shake" | "nod" | "wiggle" | "jump";
};
export type FreeRef = string | { x: number; y: number };
export type FreeObj = {
  id: string;
  type: "shape" | "text" | "line" | "bars" | "curve" | "ring" | "brace" | "char" | "icon";
  at: string; until?: string;
  x?: number; y?: number; w?: number; h?: number; r?: number; o?: number; s?: number; rot?: number; mark?: number;
  look?: string; say?: string; mood?: string; tag?: string; flip?: boolean; prop?: string;
  shape?: "circle" | "rect" | "pill";
  text?: string; size?: "s" | "m" | "l" | "xl"; tone?: string; fill?: boolean; sticker?: string;
  from?: FreeRef; to?: FreeRef; arrow?: boolean; flow?: boolean; dash?: boolean; width?: number; bend?: number; dir?: "up" | "down";
  vals?: number[]; labels?: string[]; tones?: string[];
  fn?: string; fn2?: string; params?: Record<string, number>; xmin?: number; xmax?: number; ymin?: number; ymax?: number; markOn?: boolean; markTone?: string; tone2?: string;
  of?: string; pad?: number; seed?: number;
  pulse?: string[]; keys?: FreeKey[];
};

export type SideSpec = { title: string; sticker?: string; big?: string; small?: string; tone?: Tone };

export type Storyboard = {
  sceneId: string;
  tag: string; // 左上角小标签,如"② 比例尺的毛病"
  heading?: { text: string; sticker?: string; at: string };
  beats: Beat[];
  // "classic"：原来的统一淡入上浮 + 8 帧叠化；不写（默认）：按元素种类选缓动的进场短句 + 旧镜头先收、新镜头后出的接力转场
  motionStyle?: "classic";
};
