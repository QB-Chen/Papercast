import React, { createContext, useContext } from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import { ramp } from "../anim";
import { C, FONT } from "../theme";
import type { TScene } from "./types";

export const MATH = '"Cambria Math", "Times New Roman", "Microsoft YaHei", serif';

// ---------- 与旁白对齐的触发器 ----------
export const SceneCtx = createContext<TScene | null>(null);

/** 场景内的时间工具:at(句id)=该句起始帧;prog(句id)=该句开始后的 0~1 进度 */
export function useCue() {
  const scene = useContext(SceneCtx);
  if (!scene) throw new Error("useCue 必须在 SceneCtx 内使用");
  const frame = useCurrentFrame();
  const at = (id: string): number => {
    const s = scene.sentences.find((x) => x.id === id);
    if (!s) throw new Error(`场景 ${scene.id} 里没有句子 ${id}`);
    return s.local;
  };
  const prog = (id: string, dur = 14, delay = 0): number => ramp(frame, at(id) + delay, dur);
  const on = (from: string, to?: string): boolean => frame >= at(from) && (to === undefined || frame < at(to));
  return { frame, at, prog, on, scene };
}

// ---------- 基础元素 ----------
// 贴图包：timeline.stickerPack 指定的包（public/stickers-<包名>/）里有这个贴图就用它，没有就回退到默认的 public/stickers/。
// packNames 是该包里实际有的贴图名清单（由 build-props 生成），避免渲染时去请求不存在的文件。
let STICKER_PACK: { dir: string; names: Set<string> } | null = null;
export const setStickerPack = (pack: string | undefined, names: string[] | undefined) => {
  STICKER_PACK = pack && names ? { dir: `stickers-${pack}`, names: new Set(names) } : null;
};
export const stickerSrc = (name: string) => (STICKER_PACK?.names.has(name) ? `${STICKER_PACK.dir}/${name}.svg` : `stickers/${name}.svg`);
export const Sticker: React.FC<{ name: string; size: number; style?: React.CSSProperties }> = ({ name, size, style }) => (
  <Img src={staticFile(stickerSrc(name))} style={{ width: size, height: size, ...style }} />
);

/** 绝对定位 + 淡入上浮。center=true 时 (x,y) 是元素中心 */
export const Abs: React.FC<{
  x: number;
  y: number;
  p?: number;
  rise?: number;
  center?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  pm?: number; // 运动进度（位移和缩放用），可以超过 1 做出过冲；不传就和 p 一样（旧行为不变）
  grow?: number; // 进场时从多小开始缩放，默认 0.94（0.06 的变化）
}> = ({ x, y, p = 1, pm, grow = 0.94, rise = 22, center = false, children, style }) => {
  const m = pm ?? p;
  return (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      opacity: Math.min(1, p),
      transform: `${center ? "translate(-50%, -50%) " : ""}translateY(${(1 - m) * rise}px) scale(${grow + (1 - grow) * m})`,
      fontFamily: FONT,
      // 绝对定位元素默认只能用到 (屏宽 - left) 的宽度,居中的长文字会被折行。按内容宽度排版
      width: "max-content",
      ...style,
    }}
  >
    {children}
  </div>
  );
};

export const Chip: React.FC<{ text: string; bg?: string; color?: string; size?: number; style?: React.CSSProperties }> = ({
  text,
  bg = C.navy,
  color = C.white,
  size = 38,
  style,
}) => (
  <div
    style={{
      display: "inline-block",
      padding: `${size * 0.22}px ${size * 0.6}px`,
      borderRadius: size * 0.5,
      background: bg,
      color,
      fontSize: size,
      fontWeight: 800,
      fontFamily: FONT,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {text}
  </div>
);

export const Card: React.FC<{ w: number; h: number; border?: string; children?: React.ReactNode; style?: React.CSSProperties }> = ({
  w,
  h,
  border = C.teal,
  children,
  style,
}) => (
  <div
    style={{
      width: w,
      height: h,
      boxSizing: "border-box",
      borderRadius: 28,
      background: "rgba(255,255,255,0.88)",
      border: `5px solid ${border}`,
      position: "relative",
      ...style,
    }}
  >
    {children}
  </div>
);

export const Heading: React.FC<{ text: string; p?: number; sticker?: string; y?: number }> = ({ text, p = 1, sticker, y = 90 }) => (
  <Abs x={960} y={y} p={p} center style={{ display: "flex", alignItems: "center", gap: 24 }}>
    {sticker && <Sticker name={sticker} size={96} />}
    <div style={{ fontSize: 76, fontWeight: 900, color: C.navy, letterSpacing: 3, whiteSpace: "nowrap" }}>{text}</div>
  </Abs>
);

export const SceneTag: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      position: "absolute",
      left: 56,
      top: 34,
      fontFamily: FONT,
      fontSize: 30,
      fontWeight: 800,
      color: C.teal,
      opacity: 0.9,
    }}
  >
    {text}
  </div>
);

// ---------- 弹簧 / 牵引绳 ----------
/** 沿 (x1,y1)→(x2,y2) 画锯齿弹簧 */
export const Spring: React.FC<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  coils?: number;
  amp?: number;
  color?: string;
  width?: number;
  opacity?: number;
}> = ({ x1, y1, x2, y2, coils = 9, amp = 16, color = C.teal, width = 6, opacity = 1 }) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const pts: string[] = [`${x1},${y1}`];
  const lead = 0.1; // 两端留直线
  for (let i = 0; i < coils * 2; i++) {
    const t = lead + ((1 - 2 * lead) * (i + 0.5)) / (coils * 2);
    const s = i % 2 === 0 ? 1 : -1;
    pts.push(`${x1 + dx * t + nx * amp * s},${y1 + dy * t + ny * amp * s}`);
  }
  pts.push(`${x2},${y2}`);
  return (
    <polyline
      points={pts.join(" ")}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinejoin="round"
      strokeLinecap="round"
      opacity={opacity}
    />
  );
};

/** 微微下垂的牵引绳;broken=true 画成断开的虚线 */
export const Leash: React.FC<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sag?: number;
  color?: string;
  broken?: boolean;
  opacity?: number;
}> = ({ x1, y1, x2, y2, sag = 40, color = C.orange, broken = false, opacity = 1 }) => {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 + sag;
  return (
    <path
      d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
      fill="none"
      stroke={color}
      strokeWidth={7}
      strokeLinecap="round"
      strokeDasharray={broken ? "4 22" : undefined}
      opacity={opacity}
    />
  );
};

// ---------- 梯度权重图 ----------
export const CH = { left: 130, right: 1130, top: 215, bottom: 800, ymin: -1, ymax: 2.8, dmax: 1.6 };
/** 偏移 D(单位 δ) → 画面 x */
export const cx = (d: number): number => CH.left + (d / CH.dmax) * (CH.right - CH.left);
/** 权重 w → 画面 y */
export const cy = (w: number): number => CH.bottom - ((w - CH.ymin) / (CH.ymax - CH.ymin)) * (CH.bottom - CH.top);

export const pathOf = (pts: [number, number][]): string =>
  pts.map(([d, w], i) => `${i === 0 ? "M" : "L"} ${cx(d)} ${cy(w)}`).join(" ");

/** 曲线逐段画出;p 为 0~1 */
export const Curve: React.FC<{ pts: [number, number][]; color: string; p: number; dashed?: boolean; width?: number }> = ({
  pts,
  color,
  p,
  dashed = false,
  width = 9,
}) => (
  <path
    d={pathOf(pts)}
    pathLength={1}
    fill="none"
    stroke={color}
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeDasharray={dashed ? undefined : 1}
    strokeDashoffset={dashed ? undefined : 1 - p}
    opacity={dashed ? p : 1}
    {...(dashed ? { style: { strokeDasharray: "18 14" } } : {})}
  />
);

/** 坐标轴 + δ 边界线。横轴放在 w=0 处,负权重在轴下方 */
export const ChartFrame: React.FC<{ p?: number; children?: React.ReactNode }> = ({ p = 1, children }) => (
  <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: p }}>
    {/* 负权重区底色 */}
    <rect x={CH.left} y={cy(0)} width={CH.right - CH.left} height={CH.bottom - cy(0)} fill={C.pink} opacity={0.07} />
    <line x1={CH.left} y1={CH.top - 20} x2={CH.left} y2={CH.bottom} stroke={C.navy} strokeWidth={5} strokeLinecap="round" />
    <line x1={CH.left} y1={cy(0)} x2={CH.right + 30} y2={cy(0)} stroke={C.navy} strokeWidth={5} strokeLinecap="round" />
    <line x1={cx(1)} y1={CH.top} x2={cx(1)} y2={CH.bottom} stroke={C.pink} strokeWidth={4} strokeDasharray="12 10" />
    {[1, 2].map((w) => (
      <g key={w}>
        <line x1={CH.left - 10} y1={cy(w)} x2={CH.left + 10} y2={cy(w)} stroke={C.navy} strokeWidth={4} />
        <text x={CH.left - 24} y={cy(w) + 12} textAnchor="end" fontFamily={FONT} fontSize={34} fontWeight={700} fill={C.navy}>
          {w}
        </text>
      </g>
    ))}
    <text x={CH.left - 24} y={cy(0) + 12} textAnchor="end" fontFamily={FONT} fontSize={34} fontWeight={700} fill={C.navy}>
      0
    </text>
    <text x={CH.left + 18} y={CH.top - 28} fontFamily={FONT} fontSize={36} fontWeight={800} fill={C.navy}>
      梯度权重 w
    </text>
    <text x={CH.right} y={cy(0) - 18} textAnchor="end" fontFamily={FONT} fontSize={34} fontWeight={800} fill={C.navy}>
      概率偏移 D →
    </text>
    <text x={cx(1)} y={CH.bottom + 46} textAnchor="middle" fontFamily={FONT} fontSize={36} fontWeight={800} fill={C.pink}>
      δ（信任区域边界）
    </text>
    {children}
  </svg>
);
