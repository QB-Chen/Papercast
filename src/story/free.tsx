import React from "react";
import { staticFile } from "remotion";
import { C, FONT } from "../theme";
import { T, getLang } from "./i18n";
import { useCue, stickerSrc, MATH, Sticker } from "../drpo/kit";
import { Char } from "./rich4";
import { Img } from "remotion";
import PROPS from "./props.json";
const PROP_IDS = new Set((PROPS as { id: string }[]).map((p) => p.id));
/** 道具或表情：优先 props，没有就当贴图名 */
const Prop: React.FC<{ name: string; size: number }> = ({ name, size }) =>
  PROP_IDS.has(name) ? <Img src={staticFile(`props/${name}.svg`)} style={{ width: size, height: size }} /> : <Sticker name={name} size={size} />;
import { prog, type EaseName } from "../anim";
import type { Beat, FreeObj, FreeKey } from "./types";
import { cueAt, CW, CH } from "./canvas";
import { HandLoop } from "./hand";
import { compileExpr } from "./expr";

type Box = { w: number; h: number };

/**
 * 自由动画（form:"free"）：模型自己搭的动画场景，不限于预设版式。
 * 对象：shape 图形、text 文字、line 连接线/箭头（跟着对象走）、bars 柱子组、curve 函数曲线、ring 手绘圈、brace 大括号。
 * 位置用百分比（x 0~100 是横向，y 0~100 是纵向，对象的中心点）；尺寸 w、h、r 用画布像素（画布逻辑尺寸 1600×520）。
 * 每个对象有 keys（关键帧）：在旁白的某个时刻，x/y/w/h/r/o(透明度)/s(缩放)/rot/vals(柱子数值)/params(曲线参数)/mark 平滑过渡到目标值。
 */
const TONES: Record<string, string> = { teal: C.teal, pink: C.pink, orange: C.orange, navy: C.navy, gray: "#8A98A6", green: "#12A57A" };
const col = (t?: string) => TONES[t ?? "navy"] ?? C.navy;
const SIZE: Record<string, number> = { s: 30, m: 40, l: 52, xl: 68 };
const PX = CW / 100;
/** 纵向 1% 对应多少逻辑像素。整块画布是 CH/100；eqx 的插入演示区更矮，渲染时按区域形状改（FreeEl 每次渲染开头设置，子组件随后读取） */
let PY = CH / 100;
const hasCJK = (s: string) => /[\u3400-\u9fff]/.test(s);
const len = (s: string) => [...s].length;

type St = { x: number; y: number; w: number; h: number; r: number; o: number; s: number; rot: number; mark: number; vals: number[]; params: Record<string, number>; tone?: string; text?: string; look?: string; say?: string; mood?: string; gx: number; gy: number; grot: number };
const NUM = ["x", "y", "w", "h", "r", "o", "s", "rot", "mark"] as const;

export function resolve(obj: FreeObj, frame: number, at: (r: string) => number): St {
  const st: St = { x: obj.x ?? 50, y: obj.y ?? 50, w: obj.w ?? 0, h: obj.h ?? 0, r: obj.r ?? 0, o: obj.o ?? 1, s: obj.s ?? 1, rot: obj.rot ?? 0, mark: obj.mark ?? 0, vals: [...(obj.vals ?? [])], params: { ...(obj.params ?? {}) }, tone: obj.tone, text: obj.text, look: obj.look, say: obj.say, mood: obj.mood, gx: 0, gy: 0, grot: 0 };
  const keys = (obj.keys ?? []).map((k) => ({ k, f: at(k.at) })).sort((a, b) => a.f - b.f);
  for (const { k, f } of keys) {
    const p = prog(frame, f, k.dur ?? 24, (k.ease as EaseName) ?? "soft");
    for (const n of NUM) if (k[n] !== undefined) st[n] += ((k[n] as number) - st[n]) * p;
    if (k.vals) {
      const n = Math.max(st.vals.length, k.vals.length);
      for (let i = 0; i < n; i++) st.vals[i] = (st.vals[i] ?? 0) + ((k.vals[i] ?? 0) - (st.vals[i] ?? 0)) * p;
    }
    if (k.params) for (const [n, v] of Object.entries(k.params)) st.params[n] = (st.params[n] ?? 0) + (v - (st.params[n] ?? 0)) * p;
    if (frame >= f) {
      if (k.text !== undefined) st.text = k.text;
      if (k.tone !== undefined) st.tone = k.tone;
      if (k.look !== undefined) st.look = k.look;
      if (k.say !== undefined) st.say = k.say;
      if (k.mood !== undefined) st.mood = k.mood;
      // 一次性动作：蹦、摇头、点头、晃、跳（约 1 秒内衰减）
      if (k.act) {
        const d = frame - f;
        const decay = Math.max(0, 1 - d / 36);
        if (k.act === "bounce") st.gy -= Math.abs(Math.sin(d / 5)) * 44 * decay;
        if (k.act === "shake") st.gx += Math.sin(d * 0.8) * 20 * decay;
        if (k.act === "nod") st.gy += Math.sin(d / 3.5) * 14 * decay;
        if (k.act === "wiggle") st.grot += Math.sin(d * 0.7) * 12 * decay;
        if (k.act === "jump" && d < 26) st.gy -= Math.sin((Math.PI * d) / 26) * 90;
      }
    }
  }
  // 提到就弹：pulse 里每个时刻，缩放放大再回落
  let bump = 0;
  for (const a of obj.pulse ?? []) {
    let fa: number;
    try { fa = at(a); } catch { continue; }
    const d = frame - fa;
    if (d >= 0 && d < 20) bump = Math.max(bump, Math.sin((Math.PI * d) / 20));
  }
  st.s *= 1 + 0.2 * bump;
  return st;
}

/** 对象的像素包围盒（连接线和圈、括号用它找位置） */
function bboxOf(obj: FreeObj, st: St): { cx: number; cy: number; hw: number; hh: number } {
  const cx = st.x * PX, cy = st.y * PY;
  if (obj.type === "text") {
    const fs = SIZE[obj.size ?? "m"];
    return { cx, cy, hw: (len(st.text ?? "") * fs * (hasCJK(st.text ?? "") ? 1 : 0.62)) / 2, hh: fs * 0.65 };
  }
  // 柱子组：范围要把下面的标签区也算进去（圈、括号、连线才不会压到标签）
  if (obj.type === "bars") return { cx, cy: cy + 34, hw: (st.w * st.s) / 2, hh: (st.h * st.s) / 2 + 40 };
  if (obj.type === "char" || obj.type === "icon") { const sz = (st.w || (obj.type === "char" ? 150 : 90)) * st.s; return { cx, cy, hw: sz / 2, hh: sz / 2 }; }
  if (obj.type === "shape" && obj.shape === "circle") return { cx, cy, hw: st.r * st.s, hh: st.r * st.s };
  return { cx, cy, hw: (st.w * st.s) / 2, hh: (st.h * st.s) / 2 };
}

function edgeTo(b: { cx: number; cy: number; hw: number; hh: number }, tx: number, ty: number, gap = 12): { x: number; y: number } {
  const dx = tx - b.cx, dy = ty - b.cy;
  if (!dx && !dy) return { x: b.cx, y: b.cy };
  const t = Math.min((b.hw + gap) / Math.abs(dx || 1e-9), (b.hh + gap) / Math.abs(dy || 1e-9));
  return { x: b.cx + dx * Math.min(1, t), y: b.cy + dy * Math.min(1, t) };
}

export const FreeEl: React.FC<{ b: Beat; box: Box; fill?: boolean }> = ({ b, box, fill }) => {
  const { frame, scene } = useCue();
  const at = (ref: string) => cueAt(scene, ref);
  const objs = b.objs ?? [];
  // fill（eqx 的插入演示区）：宽度 1600 铺满容器，逻辑高度 = 容器高 / 缩放，所以纵向百分比铺满这块矮区域
  const k = fill ? box.w / CW : Math.min(box.w / CW, box.h / CH);
  const LHeff = fill ? box.h / k : CH;
  PY = LHeff / 100;
  const ox = fill ? 0 : (box.w - CW * k) / 2;
  const oy = fill ? 0 : (box.h - CH * k) / 2;
  const enterB = Math.min(1, prog(frame, at(b.at), 10, "out"));

  // 先把所有对象此刻的状态算出来（连接线、圈、括号要引用别的对象的位置）
  const states = new Map<string, St>();
  for (const o of objs) states.set(o.id, resolve(o, frame, at));
  const byId = new Map(objs.map((o) => [o.id, o]));
  const bb = (id: string) => { const o = byId.get(id), s = states.get(id); return o && s ? bboxOf(o, s) : null; };
  const pt = (r: string | { x: number; y: number }) => (typeof r === "string" ? (() => { const x = bb(r); return x ? { x: x.cx, y: x.cy } : { x: 0, y: 0 }; })() : { x: r.x * PX, y: r.y * PY });

  return (
    <div style={{ width: box.w, height: box.h, position: "relative", opacity: enterB }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 32, background: "rgba(255,255,255,0.55)", border: "3px solid rgba(31,58,95,0.10)" }} />
      <div style={{ position: "absolute", left: ox, top: oy, width: CW, height: LHeff, transform: `scale(${k})`, transformOrigin: "0 0" }}>
        <svg width={CW} height={LHeff} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          {objs.map((o) => (o.type === "ring" || o.type === "char" || o.type === "icon" ? null : <Obj key={o.id} o={o} st={states.get(o.id)!} frame={frame} at={at} bb={bb} pt={pt} />))}
        </svg>
        {objs.filter((o) => o.type === "ring").map((o) => (
          <Ring key={o.id} o={o} frame={frame} at={at} bb={bb} />
        ))}
        {objs.filter((o) => o.type === "char" || o.type === "icon").map((o) => (
          <Actor key={o.id} o={o} st={states.get(o.id)!} frame={frame} at={at} />
        ))}
      </div>
      {b.schematic !== false && (
        <div style={{ position: "absolute", right: 22, bottom: 14, fontFamily: FONT, fontWeight: 800, fontSize: 24, color: C.navy, opacity: 0.45, letterSpacing: getLang() === "en" ? 0.5 : 2 }}>{T().schematic}</div>
      )}
    </div>
  );
};

/** 出场进度、淡出系数；不在场时返回 null */
function life(o: FreeObj, frame: number, at: (r: string) => number): { t0: number; p: number; fade: number } | null {
  const t0 = at(o.at);
  if (frame < t0) return null;
  const outAt = o.until ? at(o.until) : Infinity;
  if (frame >= outAt + 10) return null;
  const kind: EaseName = o.type === "shape" ? "pop" : "out";
  const p = prog(frame, t0, 16, kind);
  const fade = Math.min(1, prog(frame, t0, 8, "out")) * (frame >= outAt ? 1 - Math.min(1, (frame - outAt) / 10) : 1);
  return { t0, p, fade };
}

const Obj: React.FC<{ o: FreeObj; st: St; frame: number; at: (r: string) => number; bb: (id: string) => { cx: number; cy: number; hw: number; hh: number } | null; pt: (r: string | { x: number; y: number }) => { x: number; y: number } }> = ({ o, st, frame, at, bb, pt }) => {
  const lf = life(o, frame, at);
  if (!lf) return null;
  const { t0, p, fade } = lf;
  const op = fade * st.o;
  const c = col(st.tone);
  const cx = st.x * PX, cy = st.y * PY;
  const text = st.text ?? "";
  const fontFor = (s: string) => (hasCJK(s) ? FONT : MATH);

  switch (o.type) {
    case "shape": {
      const scale = Math.max(0.01, p) * st.s;
      const tf = `translate(${cx} ${cy}) rotate(${st.rot}) scale(${scale})`;
      const fs = SIZE[o.size ?? "m"];
      const bw = o.shape === "circle" ? st.r * 2 : st.w;
      const fit = Math.max(20, Math.min(fs, (bw - 28) / Math.max(1, len(text) * (hasCJK(text) ? 1 : 0.62))));
      return (
        <g transform={tf} opacity={op}>
          {o.shape === "circle" ? (
            <circle r={st.r} fill={o.fill ? c : C.white} stroke={c} strokeWidth={o.fill ? 0 : 5} />
          ) : (
            <rect x={-st.w / 2} y={-st.h / 2} width={st.w} height={st.h} rx={o.shape === "pill" ? st.h / 2 : 22} fill={o.fill ? c : C.white} stroke={c} strokeWidth={5} />
          )}
          {o.sticker && <image href={staticFile(stickerSrc(o.sticker))} x={text ? -bw / 2 + 14 : -32} y={-32} width={64} height={64} />}
          {text && <text x={o.sticker ? 30 : 0} y={0} textAnchor="middle" dominantBaseline="central" fontFamily={fontFor(text)} fontWeight={900} fontSize={fit} fill={o.fill ? C.white : c}>{text}</text>}
        </g>
      );
    }
    case "text": {
      const fs = SIZE[o.size ?? "m"];
      return (
        <text x={cx} y={cy + (1 - Math.min(1, p)) * 14} textAnchor="middle" dominantBaseline="central" fontFamily={fontFor(text)} fontWeight={900} fontSize={fs * st.s} fill={c} opacity={op} transform={`rotate(${st.rot} ${cx} ${cy})`}>{text}</text>
      );
    }
    case "line": {
      if (!o.from || !o.to) return null;
      const a = pt(o.from), z = pt(o.to);
      const A = typeof o.from === "string" && bb(o.from) ? edgeTo(bb(o.from)!, z.x, z.y) : a;
      const Z = typeof o.to === "string" && bb(o.to) ? edgeTo(bb(o.to)!, a.x, a.y) : z;
      const bend = o.bend ?? 0;
      const mx = (A.x + Z.x) / 2 - (Z.y - A.y) * bend, my = (A.y + Z.y) / 2 + (Z.x - A.x) * bend;
      const L = Math.hypot(Z.x - A.x, Z.y - A.y) * (1 + Math.abs(bend)) + 20;
      const ang = Math.atan2(Z.y - my, Z.x - mx), h = 20;
      const w = o.width ?? 6;
      return (
        <g opacity={op}>
          <path d={`M${A.x} ${A.y} Q${mx} ${my} ${Z.x} ${Z.y}`} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeDasharray={o.dash ? "14 12" : L} strokeDashoffset={o.dash ? 0 : L * (1 - p)} />
          {o.arrow !== false && p > 0.9 && <path d={`M${Z.x} ${Z.y} L${Z.x - h * Math.cos(ang - 0.5)} ${Z.y - h * Math.sin(ang - 0.5)} M${Z.x} ${Z.y} L${Z.x - h * Math.cos(ang + 0.5)} ${Z.y - h * Math.sin(ang + 0.5)}`} stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />}
          {o.flow && p > 0.95 && [0, 1, 2].map((i) => {
            const tt = (((frame - t0) / 54) + i / 3) % 1;
            return <circle key={i} cx={(1 - tt) * (1 - tt) * A.x + 2 * (1 - tt) * tt * mx + tt * tt * Z.x} cy={(1 - tt) * (1 - tt) * A.y + 2 * (1 - tt) * tt * my + tt * tt * Z.y} r={8} fill={c} opacity={Math.sin(tt * Math.PI)} />;
          })}
          {text && <text x={(A.x + Z.x) / 2} y={Math.min(A.y, Z.y) - 20} textAnchor="middle" fontFamily={fontFor(text)} fontWeight={900} fontSize={SIZE[o.size ?? "s"]} fill={c} opacity={Math.max(0, (p - 0.5) * 2)}>{text}</text>}
        </g>
      );
    }
    case "bars": {
      // x,y 是整组柱子区域的中心，w,h 是区域大小；柱子高度 = vals[i]/100 * h，从 0 长出来
      const n = st.vals.length;
      if (!n) return null;
      const slot = st.w / n, bw = Math.min(slot * 0.62, 160);
      const base = cy + st.h / 2;
      const tones = o.tones ?? [];
      return (
        <g opacity={op}>
          <line x1={cx - st.w / 2} y1={base + 3} x2={cx + st.w / 2} y2={base + 3} stroke="#8A98A6" strokeWidth={5} strokeLinecap="round" />
          {st.vals.map((v, i) => {
            const hh = Math.max(0, v) / 100 * st.h * Math.min(1, p);
            const bx = cx - st.w / 2 + slot * (i + 0.5);
            const lab = o.labels?.[i] ?? "";
            const fs = Math.max(24, Math.min(40, (slot - 12) / Math.max(1, len(lab) * (hasCJK(lab) ? 1 : 0.62))));
            return (
              <g key={i}>
                <rect x={bx - bw / 2} y={base - hh} width={bw} height={hh} rx={12} fill={col(tones[i] ?? st.tone)} />
                {lab && <text x={bx} y={base + 38} textAnchor="middle" dominantBaseline="central" fontFamily={fontFor(lab)} fontWeight={900} fontSize={fs} fill={col(tones[i] ?? st.tone)}>{lab}</text>}
              </g>
            );
          })}
        </g>
      );
    }
    case "curve": {
      // x,y 是绘图区中心，w,h 是大小；fn 是 x 的表达式（x 从 xmin 到 xmax），params 里的名字可以在表达式里用，会随关键帧变化
      const xmin = o.xmin ?? 0, xmax = o.xmax ?? 1, ymin = o.ymin ?? 0, ymax = o.ymax ?? 1;
      const left = cx - st.w / 2, top = cy - st.h / 2;
      const X = (v: number) => left + ((v - xmin) / (xmax - xmin)) * st.w;
      const Y = (v: number) => top + st.h - ((Math.min(ymax, Math.max(ymin, v)) - ymin) / (ymax - ymin)) * st.h;
      const draw = (src: string | undefined, color: string, key: string) => {
        if (!src) return null;
        let f: (e: Record<string, number>) => number;
        try { f = compileExpr(src); } catch { return null; }
        const N = 90;
        const pts: string[] = [];
        for (let i = 0; i <= Math.round(N * Math.min(1, p)); i++) {
          const xv = xmin + ((xmax - xmin) * i) / N;
          pts.push(`${i ? "L" : "M"}${X(xv).toFixed(1)} ${Y(f({ ...st.params, x: xv })).toFixed(1)}`);
        }
        return <path key={key} d={pts.join(" ")} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />;
      };
      const mk = st.mark;
      let markEl: React.ReactNode = null;
      if (o.markOn && p > 0.9) {
        try {
          const f = compileExpr(o.fn ?? "0");
          const mx = X(xmin + (xmax - xmin) * mk), my = Y(f({ ...st.params, x: xmin + (xmax - xmin) * mk }));
          markEl = <g><line x1={mx} y1={my} x2={mx} y2={top + st.h} stroke={c} strokeWidth={3} strokeDasharray="8 8" /><circle cx={mx} cy={my} r={14} fill={col(o.markTone ?? "orange")} stroke={C.white} strokeWidth={4} /></g>;
        } catch { markEl = null; }
      }
      return (
        <g opacity={op}>
          <line x1={left} y1={top + st.h} x2={left + st.w} y2={top + st.h} stroke="#8A98A6" strokeWidth={4} strokeLinecap="round" />
          <line x1={left} y1={top} x2={left} y2={top + st.h} stroke="#8A98A6" strokeWidth={4} strokeLinecap="round" />
          {draw(o.fn2, col(o.tone2 ?? "gray"), "b")}
          {draw(o.fn, c, "a")}
          {markEl}
          {text && <text x={cx} y={top - 24} textAnchor="middle" fontFamily={fontFor(text)} fontWeight={900} fontSize={SIZE[o.size ?? "s"]} fill={c}>{text}</text>}
        </g>
      );
    }
    case "brace": {
      // 括号：from 到 to 两个对象之间。横向时开口朝下（dir:"up" 朝上），写在括号外侧
      const A = o.from ? bb(typeof o.from === "string" ? o.from : "") : null, Z = o.to ? bb(typeof o.to === "string" ? o.to : "") : null;
      if (!A || !Z) return null;
      const dir = o.dir === "up" ? -1 : 1;
      const x1 = Math.min(A.cx - A.hw, Z.cx - Z.hw), x2 = Math.max(A.cx + A.hw, Z.cx + Z.hw);
      const y = dir > 0 ? Math.max(A.cy + A.hh, Z.cy + Z.hh) + 18 : Math.min(A.cy - A.hh, Z.cy - Z.hh) - 18;
      const d = `M${x1} ${y} q0 ${14 * dir} 14 ${14 * dir} H${(x1 + x2) / 2 - 14} q14 0 14 ${14 * dir} q0 -${14 * dir} 14 -${14 * dir} H${x2 - 14} q14 0 14 -${14 * dir}`;
      const L = (x2 - x1) * 1.3 + 80;
      const fs = SIZE[o.size ?? "m"];
      return (
        <g opacity={op}>
          <path d={d} fill="none" stroke={c} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - p)} />
          {text && <text x={(x1 + x2) / 2} y={y + (dir > 0 ? 24 + fs * 0.9 : -24)} textAnchor="middle" fontFamily={fontFor(text)} fontWeight={900} fontSize={fs} fill={c} opacity={Math.max(0, (p - 0.5) * 2)}>{text}</text>}
        </g>
      );
    }
    default:
      return null;
  }
};

/** 角色和道具：放在 HTML 层（比 svg 里的图形更上面），角色带白色描边、表情气泡、说话气泡、标签 */
const Actor: React.FC<{ o: FreeObj; st: St; frame: number; at: (r: string) => number }> = ({ o, st, frame, at }) => {
  const lf = life(o, frame, at);
  if (!lf) return null;
  const { t0, p, fade } = lf;
  const isChar = o.type === "char";
  const size = (st.w || (isChar ? 150 : 90)) * st.s;
  // 舞台高度（逻辑像素；eqx 插入演示区更矮）。角色整个人、头顶的气泡/表情、脚下的标签都必须留在舞台里，否则会被字幕条或面板边缘挡住
  const stageH = PY * 100;
  const topPad = isChar ? (st.say ? 98 : st.mood ? 38 : 4) : 4;
  const botPad = isChar && o.tag ? 34 : 4;
  const cx = st.x * PX + st.gx;
  const cyRaw = st.y * PY + st.gy;
  const lo = size / 2 + topPad, hi = stageH - size / 2 - botPad;
  const cy = hi >= lo ? Math.min(Math.max(cyRaw, lo), hi) : stageH / 2; // 舞台太矮放不下时居中
  // 出场：从下方弹出；角色一直轻轻晃（活的感觉）
  const bob = isChar ? Math.sin((frame - t0) / 14 + o.id.length) * 4 : 0;
  const pop = 0.5 + 0.5 * Math.min(1, p);
  const op = fade * st.o;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH, pointerEvents: "none", opacity: op }}>
      <div style={{ position: "absolute", left: cx - size / 2, top: cy - size / 2 + bob, width: size, height: size, transform: `rotate(${st.rot + st.grot}deg) scale(${pop * (o.flip ? -1 : 1)}, ${pop})`, transformOrigin: "50% 80%" }}>
        {isChar ? (
          <Char id={st.look ?? o.look ?? "person-standing"} size={size} style={{ filter: "drop-shadow(0 0 0 #fff) drop-shadow(3px 0 0 #fff) drop-shadow(-3px 0 0 #fff) drop-shadow(0 3px 0 #fff) drop-shadow(0 -3px 0 #fff)" }} />
        ) : (
          <Prop name={o.prop ?? o.sticker ?? "sparkles"} size={size} />
        )}
      </div>
      {isChar && st.mood && <div style={{ position: "absolute", left: cx + size * 0.28, top: cy - size / 2 - 38 + bob, opacity: Math.min(1, (frame - t0) / 8) }}><Prop name={st.mood} size={Math.max(48, size * 0.36)} /></div>}
      {isChar && st.say && (
        <div style={{ position: "absolute", left: cx - ([...st.say].length * 30 + 52) / 2, top: cy - size / 2 - 98 + bob, width: [...st.say].length * 30 + 52, height: 62, boxSizing: "border-box", borderRadius: 31, background: C.white, border: `4px solid ${col(st.tone ?? "navy")}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontWeight: 900, fontSize: 30, color: col(st.tone ?? "navy"), boxShadow: "0 6px 0 rgba(31,58,95,0.10)" }}>{st.say}</div>
      )}
      {isChar && o.tag && <div style={{ position: "absolute", left: cx - 70, width: 140, top: cy + size / 2 + 2, textAlign: "center", fontFamily: FONT, fontWeight: 900, fontSize: 28, color: C.navy }}>{o.tag}</div>}
    </div>
  );
};

const Ring: React.FC<{ o: FreeObj; frame: number; at: (r: string) => number; bb: (id: string) => { cx: number; cy: number; hw: number; hh: number } | null }> = ({ o, frame, at, bb }) => {
  const lf = life(o, frame, at);
  if (!lf || !o.of) return null;
  const t = bb(o.of);
  if (!t) return null;
  const pad = o.pad ?? 18;
  const w = t.hw * 2 + pad * 2, h = t.hh * 2 + pad * 2;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH, opacity: lf.fade }}>
      <HandLoop x={t.cx - w / 2} y={t.cy - h / 2} w={w} h={h} p={Math.min(1, lf.p)} seed={o.seed ?? 4} width={7} pad={10} stroke={col(o.tone ?? "gray")} />
    </div>
  );
};

export type { FreeKey };
