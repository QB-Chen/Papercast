import { Easing, interpolate } from "remotion";
import { FPS } from "./script";

// 0→1 的缓出进度。start、dur 单位都是帧
export const ramp = (frame: number, start: number, dur = 12): number =>
  interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

// ---------------------------------------------------------------------------
// 缓动库：借鉴 OpenMotion（Apache 2.0）动画里按"这个东西像什么"选缓动的做法。
// 每个函数把 0~1 的线性进度 t 映射成带性格的 0~1（过冲的会短暂超过 1）。
//   out    快出慢停（标题、卡片的利落入场）      pop    轻微过冲（主标题、重点）
//   bounce 明显弹出（针、徽章、贴图）              spring 弹簧晃几下（庆祝、"叮"一下）
//   soft   匀速平滑（线条绘制、持续运动）          snap   先蓄势后猛地到位（落定）
// ---------------------------------------------------------------------------
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const ease = {
  out: (t: number) => 1 - Math.pow(1 - clamp01(t), 4), // ≈ expo.out 的温和版
  circ: (t: number) => Math.sqrt(1 - Math.pow(clamp01(t) - 1, 2)),
  soft: (t: number) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2, // sine.inOut
  pop: (t: number) => backOut(t, 1.45),
  bounce: (t: number) => backOut(t, 2.6),
  spring: (t: number) => {
    const x = clamp01(t);
    if (x === 0 || x === 1) return x;
    // 标准衰减振荡：1 - e^(-k x)·cos(w x)。x=0 时为 0，x→1 时趋近 1；k 控制衰减快慢，w 控制晃几下（这里约 1.5 圈）
    return 1 - Math.exp(-6 * x) * Math.cos(2 * Math.PI * 1.5 * x);
  },
  snap: (t: number) => {
    const x = clamp01(t);
    return x < 0.35 ? -0.12 * Math.sin((x / 0.35) * Math.PI) : 1 - Math.pow(1 - (x - 0.35) / 0.65, 3) * (1 - 0);
  },
};
function backOut(t: number, s: number) {
  const x = clamp01(t) - 1;
  return 1 + x * x * ((s + 1) * x + s);
}
export type EaseName = keyof typeof ease;

/** 带性格的 0→1 进度：从 start 帧起，持续 dur 帧，按 kind 选缓动。超出 [0,1] 的部分（过冲）保留，调用者要能接受 >1。 */
export const prog = (frame: number, start: number, dur: number, kind: EaseName = "out"): number => ease[kind](Math.min(1, Math.max(0, (frame - start) / Math.max(1, dur))));

/**
 * 进场短句：一组元素按固定间隔错峰进场，每个元素有自己的缓动。
 * 返回第 i 个元素的进度。用法：const p = stagger(frame, t0, i, { gap: 4, dur: 14, kind: "pop" })
 * gap 是相邻元素的间隔帧数（30fps 下 3~6 帧 = 0.1~0.2 秒，是 OpenMotion 示例里常见的错峰量）。
 */
export const stagger = (frame: number, start: number, i: number, o: { gap?: number; dur?: number; kind?: EaseName } = {}): number => prog(frame, start + i * (o.gap ?? 4), o.dur ?? 14, o.kind ?? "out");

// 秒 → 帧
export const sec = (s: number): number => Math.round(s * FPS);
