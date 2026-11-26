// 手绘强调：借鉴 Lunamos/paper2video 的 Hand.tsx / core.tsx 的做法（MIT），改成用元素自己的局部坐标，
// 这样放在任何槽位里的元素都能用，不依赖整屏 1920×1080 的绝对坐标。
// 原则：强调落在元素上（一圈、一个勾、一句旁注），不放大整个画面。
import React from "react";
import { C, FONT } from "../theme";

export const PEN = "#D6336C"; // 笔色：用项目的强调粉色，让手绘标记像讲解者的笔迹，而不是数据

const rand = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/** Catmull-Rom 过一串点 → 三次贝塞尔路径 */
const smooth = (pts: [number, number][]) => {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
};

/**
 * 手绘圈：围着一个矩形画一圈，笔画随 p（0~1）画出来，略有手抖，起笔处会多画一点，像真的笔迹。
 * (x, y, w, h) 是要圈住的区域，坐标相对于父容器（父容器需要 position: relative/absolute）。
 */
export const HandLoop: React.FC<{ x: number; y: number; w: number; h: number; p: number; seed?: number; stroke?: string; width?: number; pad?: number }> = ({
  x,
  y,
  w,
  h,
  p,
  seed = 3,
  stroke = PEN,
  width = 4,
  pad = 10,
}) => {
  if (p <= 0) return null; // 圆头线帽会在 p=0 时留下一个小点
  const r = rand(seed);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2 + pad + 6;
  const ry = h / 2 + pad;
  const n = 28;
  const start = -2.4 + r() * 0.4;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n + 3; i++) {
    const a = start + (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const k = 0.62; // 超椭圆：宽的区域保持方正
    const ex = Math.sign(ca) * Math.pow(Math.abs(ca), k);
    const ey = Math.sign(sa) * Math.pow(Math.abs(sa), k);
    const drift = 1 + (i / n) * 0.05; // 圈不会严丝合缝合上
    pts.push([cx + rx * ex * drift + (r() - 0.5) * 3.6, cy + ry * ey * drift + (r() - 0.5) * 3.6]);
  }
  const d = smooth(pts);
  const L = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2) * 1.3;
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - p)} opacity={0.92} />
    </svg>
  );
};

/** 两笔画出来的勾。 */
export const HandCheck: React.FC<{ x: number; y: number; size?: number; p: number; stroke?: string }> = ({ x, y, size = 40, p, stroke = "#12A57A" }) => {
  if (p <= 0) return null;
  const s = size / 26;
  const a = Math.min(1, p * 2);
  const b = Math.max(0, p * 2 - 1);
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
      <path d={`M${x} ${y + 13 * s} L${x + 9 * s} ${y + 22 * s}`} stroke={stroke} strokeWidth={5} strokeLinecap="round" fill="none" strokeDasharray={14 * s} strokeDashoffset={14 * s * (1 - a)} />
      <path d={`M${x + 9 * s} ${y + 22 * s} L${x + 27 * s} ${y - 2 * s}`} stroke={stroke} strokeWidth={5} strokeLinecap="round" fill="none" strokeDasharray={31 * s} strokeDashoffset={31 * s * (1 - b)} />
    </svg>
  );
};

/** 手写旁注：略微倾斜，从下方浮出。用系统里的手写/楷体风格字体（找不到就退回项目字体）。 */
export const HandNote: React.FC<{ x: number; y: number; p: number; children: React.ReactNode; size?: number; rotate?: number; color?: string }> = ({ x, y, p, children, size = 38, rotate = -3, color = PEN }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      fontFamily: `"STKaiti", "KaiTi", "Kaiti SC", "Comic Sans MS", ${FONT}`,
      fontWeight: 700,
      fontSize: size,
      lineHeight: 1.1,
      color,
      whiteSpace: "nowrap",
      transform: `rotate(${rotate}deg) translateY(${(1 - p) * 8}px)`,
      transformOrigin: "left center",
      opacity: p,
      textShadow: "0 2px 6px rgba(255,255,255,0.9)",
    }}
  >
    {children}
  </div>
);

/** 从左到右"写出来"的显示：内容被一条带羽化边的蒙版从左扫开。p：0~1 */
export const WipeReveal: React.FC<{ p: number; children: React.ReactNode; style?: React.CSSProperties; feather?: number }> = ({ p, children, style, feather = 8 }) => {
  const edge = p * (100 + feather);
  const mask = `linear-gradient(90deg, black ${edge - feather}%, transparent ${edge}%)`;
  return (
    <div style={{ display: "inline-block", maskImage: mask, WebkitMaskImage: mask, ...style }}>{children}</div>
  );
};

/**
 * 逐字打出的文字，关键短语依次"点亮"（变色、荧光笔底色、微光）。用来展示论文里真实的模型输出样例。
 * reveal：已打出的字符比例 0~1；ignite：点亮进度 0~1，按短语出现的先后依次点亮。
 */
export const highlightRuns = (text: string, phrases: string[]): { t: string; hl: number }[] => {
  const marks: [number, number][] = [];
  for (const ph of phrases) {
    if (!ph) continue;
    let from = 0;
    for (;;) {
      const i = text.indexOf(ph, from);
      if (i < 0) break;
      marks.push([i, i + ph.length]);
      from = i + ph.length;
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const runs: { t: string; hl: number }[] = [];
  let cur = 0;
  let k = 0;
  for (const [s, e] of marks) {
    if (s < cur) continue;
    if (s > cur) runs.push({ t: text.slice(cur, s), hl: -1 });
    runs.push({ t: text.slice(s, e), hl: k++ });
    cur = e;
  }
  if (cur < text.length) runs.push({ t: text.slice(cur), hl: -1 });
  return runs;
};

export const StreamText: React.FC<{ text: string; phrases?: string[]; reveal?: number; ignite?: number; hlColor?: string }> = ({ text, phrases = [], reveal = 1, ignite = 1, hlColor = C.pink }) => {
  const runs = highlightRuns(text, phrases);
  const nHl = runs.filter((r) => r.hl >= 0).length || 1;
  const chars = [...text];
  const cut = Math.floor(chars.length * reveal);
  let pos = 0;
  return (
    <>
      {runs.map((r, i) => {
        const rc = [...r.t];
        const start = pos;
        pos += rc.length;
        if (start >= cut) return null;
        const visible = rc.slice(0, Math.max(0, cut - start)).join("");
        if (r.hl < 0) return <span key={i}>{visible}</span>;
        const on = Math.min(1, Math.max(0, (ignite * nHl - r.hl) / 0.6));
        return (
          <span
            key={i}
            style={{
              color: on > 0.5 ? hlColor : undefined,
              backgroundImage: `linear-gradient(transparent 58%, ${hlColor}${Math.round(60 * on).toString(16).padStart(2, "0")} 58%)`,
              textShadow: on > 0 ? `0 0 ${10 * on}px ${hlColor}55` : undefined,
              fontWeight: on > 0.5 ? 900 : undefined,
            }}
          >
            {visible}
          </span>
        );
      })}
    </>
  );
};
