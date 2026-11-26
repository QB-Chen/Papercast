import React from "react";
import { C, FONT } from "../theme";
import { T, getLang } from "./i18n";
import { useCue } from "../drpo/kit";
import { ease, prog, type EaseName } from "../anim";
import { fitFont } from "./elements";
import { Sticker } from "../drpo/kit";
import type { Beat, CanvasItem } from "./types";
import type { TScene } from "../drpo/types";
import { HandLoop } from "./hand";

type Box = { w: number; h: number };

// 画布的逻辑尺寸：所有原件的坐标、尺寸都按 1600×520 写，渲染时整体缩放到实际格子
export const CW = 1600;
export const CH = 520;

const TONES: Record<string, string> = { teal: C.teal, pink: C.pink, orange: C.orange, navy: C.navy, gray: "#8A98A6", green: "#12A57A" };
const col = (t?: string) => TONES[t ?? "navy"] ?? C.navy;

/**
 * 画布（canvas）：同一块画布上，图形原件随旁白一个个长出来、移动、被圈住、再被清走。
 * 借鉴 Lunamos/paper2video 和 OpenMotion 的做法：好的讲解动画不是"一个固定组件浮出来停住"，
 * 而是画布持续生长或变形，每个原件有自己的出场方式和缓动。
 * 原件：dot 点、box 方块、vec 向量格、axis 坐标轴/直线、arrow 箭头、text 文字、ring 手绘圈、brace 大括号。
 * 位置动画：任何原件都可以带 moves，在对应句子起点从当前位置移动到新位置（点真的会动）。
 */
/**
 * 时间锚点（原件的 at / until / moves[].at 都用它）：
 *   "d11"        该句开口的帧
 *   "d11+30"     该句开口后再过 30 帧
 *   "d11#1"      该句第 2 段字幕的起点（caps 由真实配音时间算出）
 *   "d11@拉大"    该句里这个短语开口的大致帧：在它所属的字幕段内按字数插值（误差约 ±0.3 秒）
 */
export function cueAt(scene: TScene, ref: string): number {
  const m = ref.match(/^([^+#@]+)(?:([+#@])(.*))?$/);
  if (!m) throw new Error(`画布时间锚点写错：${ref}`);
  const s = scene.sentences.find((x) => x.id === m[1]);
  if (!s) throw new Error(`场景 ${scene.id} 里没有句子 ${m[1]}`);
  if (!m[2]) return s.local;
  if (m[2] === "+") return s.local + Number(m[3]);
  const caps = s.caps && s.caps.length ? s.caps : [{ at: 0, text: s.text }];
  if (m[2] === "#") return s.local + (caps[Number(m[3])]?.at ?? 0);
  const off = m[3].match(/^(.*)\+(\d+)$/); // "d11@压小+30"：短语之后再过 30 帧
  const phrase = off ? off[1] : m[3];
  const extra = off ? Number(off[2]) : 0;
  for (let i = 0; i < caps.length; i++) {
    const idx = caps[i].text.indexOf(phrase);
    if (idx < 0) continue;
    const end = i + 1 < caps.length ? caps[i + 1].at : s.dur;
    return s.local + extra + Math.round(caps[i].at + ((end - caps[i].at) * idx) / Math.max(1, caps[i].text.length));
  }
  // 短语跨了字幕分段（里面有标点）：在整句原文里找，按字符位置在 onset..dur 之间线性插值
  const whole = s.text.indexOf(phrase);
  if (whole >= 0) return s.local + extra + Math.round((s.onset ?? 0) + ((s.dur - (s.onset ?? 0)) * whole) / Math.max(1, s.text.length));
  throw new Error(`句子 ${s.id} 里找不到短语「${phrase}」`);
}

export const CanvasEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, scene } = useCue();
  const at = (ref: string) => cueAt(scene, ref);
  const items = b.cv ?? [];
  const k = Math.min(box.w / CW, box.h / CH);
  const ox = (box.w - CW * k) / 2;
  const oy = (box.h - CH * k) / 2;
  const enterB = Math.min(1, prog(frame, at(b.at), 10, "out"));

  return (
    <div style={{ width: box.w, height: box.h, position: "relative", opacity: enterB }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 32, background: "rgba(255,255,255,0.55)", border: "3px solid rgba(31,58,95,0.10)" }} />
      <div style={{ position: "absolute", left: ox, top: oy, width: CW, height: CH, transform: `scale(${k})`, transformOrigin: "0 0" }}>
        {items.map((it) => (
          <Item key={it.id} it={it} frame={frame} at={at} />
        ))}
      </div>
      {b.schematic !== false && (
        <div style={{ position: "absolute", right: 22, bottom: 14, fontFamily: FONT, fontWeight: 800, fontSize: 24, color: C.navy, opacity: 0.45, letterSpacing: getLang() === "en" ? 0.5 : 2 }}>{T().schematic}</div>
      )}
    </div>
  );
};

/** 位置：起点 + 一串 moves，每次移动在对应句子起点开始、用指定缓动过渡 */
function posAt(it: CanvasItem, frame: number, at: (id: string) => number): { x: number; y: number; h: number } {
  let x = it.x ?? 0, y = it.y ?? 0, h = it.h ?? 0;
  for (const m of it.moves ?? []) {
    const f0 = at(m.at);
    const p = prog(frame, f0, m.dur ?? 24, (m.ease as EaseName) ?? "soft");
    x = x + (m.x - x) * p;
    y = y + ((m.y ?? y) - y) * p;
    if (m.h !== undefined) h = h + (m.h - h) * p;
  }
  return { x, y, h };
}

const Item: React.FC<{ it: CanvasItem; frame: number; at: (id: string) => number }> = ({ it, frame, at }) => {
  const t0 = at(it.at);
  if (frame < t0) return null;
  const outAt = it.until ? at(it.until) : Infinity;
  if (frame >= outAt + 10) return null;
  const kind = (it.enter as EaseName) ?? (it.type === "dot" || it.type === "box" ? "pop" : "out");
  const p = prog(frame, t0, it.dur ?? 16, kind);
  const op = Math.min(1, prog(frame, t0, 8, "out")) * (frame >= outAt ? 1 - Math.min(1, (frame - outAt) / 10) : 1);
  const pos = posAt(it, frame, at);
  // 闲置浮动：点出场后一直有极轻的上下起伏（每个点相位不同），画面不会"停住"
  if (it.type === "box" && !it.fill) pos.y += Math.sin((frame - t0) / 17 + it.id.length * 2.3) * 2.5 * Math.min(1, (frame - t0) / 24);
  if (it.type === "dot") pos.y += Math.sin((frame - t0) / 13 + it.id.length * 1.7) * 3.5 * Math.min(1, (frame - t0) / 20);
  const c = col(it.tone);
  // 被旁白提到时弹一下：放大再回落（0.5 秒）。出场后 14 帧内的提到不算，避免和进场动画叠在一起
  let bump = 0;
  for (const a of it.pulse ?? []) {
    let fa: number;
    try { fa = at(a); } catch { continue; } // 提到的词跨了字幕分段、找不到时直接跳过，不能让渲染崩
    const d = frame - fa;
    if (fa < t0 + 14) continue;
    if (d >= 0 && d < 20) bump = Math.max(bump, Math.sin((Math.PI * d) / 20));
  }

  switch (it.type) {
    case "dot": {
      const r = (it.r ?? 22) * Math.max(0.01, p) * (1 + 0.4 * bump);
      return (
        <>
          <div style={{ position: "absolute", left: pos.x - r, top: pos.y - r, width: r * 2, height: r * 2, borderRadius: "50%", background: c, opacity: op, boxShadow: `0 4px 0 ${c}33` }} />
          {it.sticker && <div style={{ position: "absolute", left: pos.x - 30, top: pos.y - 30, opacity: op }}><Sticker name={it.sticker} size={60} /></div>}
          {it.text && <div style={{ position: "absolute", left: pos.x - 150, width: 300, top: pos.y + (it.r ?? 22) + 10, textAlign: "center", fontFamily: FONT, fontWeight: 900, fontSize: it.size ?? 38, color: c, opacity: op }}>{it.text}</div>}
        </>
      );
    }
    case "bar": {
      // 柱子：x 是中心，y 是底边，h 是当前高度；moves 里的 h 让它涨或落
      const w = (it.w ?? 120) * (1 + 0.2 * bump);
      const hh = Math.max(0, pos.h) * Math.min(1, p);
      return <div style={{ position: "absolute", left: pos.x - w / 2, top: pos.y - hh, width: w, height: hh, borderRadius: "16px 16px 4px 4px", background: c, opacity: op, boxShadow: `0 6px 0 ${c}33` }} />;
    }
    case "box": {
      const w = it.w ?? 240, h = it.h ?? 96;
      const fs = fitFont(it.text ?? "", w - 30, it.size ?? 42, 22);
      return (
        <div style={{ position: "absolute", left: pos.x - w / 2, top: pos.y - h / 2, width: w, height: h, boxSizing: "border-box", borderRadius: 22, background: it.fill ? c : C.white, border: `5px solid ${c}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, opacity: op, transform: `scale(${(0.6 + 0.4 * p) * (1 + 0.13 * bump)})`, fontFamily: FONT, fontWeight: 900, fontSize: fs, color: it.fill ? C.white : c }}>
          {it.sticker && <Sticker name={it.sticker} size={Math.min(h - 24, 64)} />}
          <span>{it.text}</span>
        </div>
      );
    }
    case "vec": {
      // 向量格：n 个小格并排，像论文里的 Q/K/V 向量；fillAt 之后依次染色
      const n = it.n ?? 4, cw = it.cw ?? 56, ch = it.ch ?? 44;
      return (
        <div style={{ position: "absolute", left: pos.x, top: pos.y - ch / 2, display: "flex", gap: 4, opacity: op }}>
          {Array.from({ length: n }).map((_, i) => {
            const s = Math.min(1, Math.max(0, (p * n - i) / 1));
            return <div key={i} style={{ width: cw, height: ch, borderRadius: 8, background: `${c}`, opacity: 0.25 + 0.75 * s, transform: `scaleY(${0.3 + 0.7 * s})` }} />;
          })}
          {it.text && <div style={{ marginLeft: 14, alignSelf: "center", fontFamily: FONT, fontWeight: 900, fontSize: it.size ?? 34, color: c }}>{it.text}</div>}
        </div>
      );
    }
    case "axis": {
      const x2 = it.x2 ?? pos.x + 400, y2 = it.y2 ?? pos.y;
      const L = Math.hypot(x2 - pos.x, y2 - pos.y);
      const ang = Math.atan2(y2 - pos.y, x2 - pos.x);
      const head = 18;
      return (
        <svg width={CW} height={CH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: op }}>
          <line x1={pos.x} y1={pos.y} x2={x2} y2={y2} stroke={c} strokeWidth={it.width ?? 5} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - p)} />
          {it.arrow !== false && p > 0.9 && <path d={`M${x2} ${y2} L${x2 - head * Math.cos(ang - 0.45)} ${y2 - head * Math.sin(ang - 0.45)} M${x2} ${y2} L${x2 - head * Math.cos(ang + 0.45)} ${y2 - head * Math.sin(ang + 0.45)}`} stroke={c} strokeWidth={it.width ?? 5} strokeLinecap="round" fill="none" />}
          {it.text && <text x={x2} y={y2 - 16} textAnchor="end" fontFamily={FONT} fontWeight={800} fontSize={it.size ?? 30} fill={c}>{it.text}</text>}
        </svg>
      );
    }
    case "arrow": {
      // 带弧度的箭头，从 (x,y) 画到 (x2,y2)；bend 控制弯曲量
      const x2 = it.x2 ?? pos.x + 200, y2 = it.y2 ?? pos.y;
      const mx = (pos.x + x2) / 2 - (y2 - pos.y) * (it.bend ?? 0.18), my = (pos.y + y2) / 2 + (x2 - pos.x) * (it.bend ?? 0.18);
      const d = `M${pos.x} ${pos.y} Q${mx} ${my} ${x2} ${y2}`;
      const L = Math.hypot(x2 - pos.x, y2 - pos.y) * 1.25;
      const ang = Math.atan2(y2 - my, x2 - mx);
      const h = 22;
      return (
        <svg width={CW} height={CH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: op }}>
          <path d={d} fill="none" stroke={c} strokeWidth={it.width ?? 7} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - p)} />
          {p > 0.92 && <path d={`M${x2} ${y2} L${x2 - h * Math.cos(ang - 0.5)} ${y2 - h * Math.sin(ang - 0.5)} M${x2} ${y2} L${x2 - h * Math.cos(ang + 0.5)} ${y2 - h * Math.sin(ang + 0.5)}`} stroke={c} strokeWidth={it.width ?? 7} strokeLinecap="round" fill="none" />}
          {it.flow && p > 0.95 && [0, 1, 2].map((i) => {
            const tt = (((frame - t0) / 54) + i / 3) % 1;
            const px = (1 - tt) * (1 - tt) * pos.x + 2 * (1 - tt) * tt * mx + tt * tt * x2;
            const py = (1 - tt) * (1 - tt) * pos.y + 2 * (1 - tt) * tt * my + tt * tt * y2;
            return <circle key={i} cx={px} cy={py} r={8} fill={c} opacity={Math.sin(tt * Math.PI)} />;
          })}
          {it.text && <text x={(pos.x + x2) / 2} y={Math.min(pos.y, y2) - 20} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={it.size ?? 34} fill={c} opacity={Math.max(0, (p - 0.5) * 2)}>{it.text}</text>}
        </svg>
      );
    }
    case "text": {
      const fs = it.size ?? 44;
      return (
        <div style={{ position: "absolute", left: pos.x - 400, width: 800, top: pos.y - fs * 0.7, textAlign: it.align === "left" ? "left" : "center", fontFamily: FONT, fontWeight: 900, fontSize: fs, color: c, opacity: op, transform: `translateY(${(1 - Math.min(1, p)) * 16}px) scale(${1 + 0.2 * bump})` }}>
          {it.text}
        </div>
      );
    }
    case "ring":
      return (
        <div style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH, opacity: op }}>
          <HandLoop x={pos.x - (it.w ?? 200) / 2} y={pos.y - (it.h ?? 100) / 2} w={it.w ?? 200} h={it.h ?? 100} p={Math.min(1, p)} seed={it.seed ?? 5} width={it.width ?? 6} pad={it.pad ?? 10} stroke={c} />
        </div>
      );
    case "brace": {
      // 大括号：横向（连接两个点，开口朝下/上）或纵向。from→to 之间画一个括号，text 写在中间
      const x2 = it.x2 ?? pos.x + 300, y2 = it.y2 ?? pos.y;
      const horizontal = Math.abs(x2 - pos.x) >= Math.abs(y2 - pos.y);
      const dir = it.dir === "up" ? -1 : 1;
      const d = horizontal
        ? `M${pos.x} ${pos.y} q0 ${14 * dir} 14 ${14 * dir} H${(pos.x + x2) / 2 - 14} q14 0 14 ${14 * dir} q0 -${14 * dir} 14 -${14 * dir} H${x2 - 14} q14 0 14 -${14 * dir}`
        : `M${pos.x} ${pos.y} q${14 * dir} 0 ${14 * dir} 14 V${(pos.y + y2) / 2 - 14} q0 14 ${14 * dir} 14 q-${14 * dir} 0 -${14 * dir} 14 V${y2 - 14} q0 14 -${14 * dir} 14`;
      const L = (horizontal ? Math.abs(x2 - pos.x) : Math.abs(y2 - pos.y)) * 1.3 + 80;
      const mx = (pos.x + x2) / 2, my = (pos.y + y2) / 2;
      return (
        <svg width={CW} height={CH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: op }}>
          <path d={d} fill="none" stroke={c} strokeWidth={it.width ?? 6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - p)} />
          {it.text && <text x={horizontal ? mx : pos.x + 36 * dir} y={horizontal ? pos.y + (dir > 0 ? 28 + (it.size ?? 36) : -34) : my + 10} textAnchor={horizontal ? "middle" : dir > 0 ? "start" : "end"} fontFamily={FONT} fontWeight={900} fontSize={it.size ?? 36} fill={c} opacity={Math.max(0, (p - 0.5) * 2)}>{it.text}</text>}
        </svg>
      );
    }
    default:
      return null;
  }
};
