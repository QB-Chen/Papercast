import React from "react";
import { Easing, interpolate } from "remotion";
import { ramp } from "../anim";
import { C, FONT } from "../theme";
import { T, getLang } from "./i18n";
import { Sticker, useCue } from "../drpo/kit";
import { TONE, fitFont } from "./elements";
import eqlib from "./eqlib.json";
import { FitTex } from "./rich2";
import type { Beat, Tone } from "./types";

type Box = { w: number; h: number };
const MATH = '"Cambria Math", "Times New Roman", "Microsoft YaHei", serif';

// ---------- 小工具 ----------
/** 带回弹的 0→1 进度(出现时先冲过头再回落，比 ramp 更有"弹出来"的感觉) */
const pop = (frame: number, start: number, dur = 16): number => {
  const t = Math.min(1, Math.max(0, (frame - start) / dur));
  const c1 = 1.70158;
  return t === 0 ? 0 : 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const ease = (frame: number, start: number, dur: number): number =>
  interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
const trim = (s: string): string => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
const num = (v: number): string => trim(Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));
const tone = (t?: Tone, fallback: Tone = "teal") => TONE[t ?? fallback];

/** {{高亮}} */
const hl = (text: string, color: string): React.ReactNode =>
  text.split(/(\{\{[^}]+\}\})/g).map((p, i) =>
    p.startsWith("{{") ? (
      <span key={i} style={{ color, background: "rgba(214,51,108,0.13)", borderRadius: 10, padding: "0 8px" }}>
        {p.slice(2, -2)}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );

const Badge: React.FC<{ text: string; bg: string; size?: number; op?: number }> = ({ text, bg, size = 30, op = 1 }) => (
  <div
    style={{
      display: "inline-block",
      padding: `${size * 0.18}px ${size * 0.55}px`,
      borderRadius: size,
      background: bg,
      color: C.white,
      fontSize: size,
      fontWeight: 900,
      whiteSpace: "nowrap",
      opacity: op,
    }}
  >
    {text}
  </div>
);

// ---------------------------------------------------------------------------
// title:标题页(论文名、作者单位)
// ---------------------------------------------------------------------------
export const TitleEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const t0 = at(b.at);
  const p1 = pop(frame, t0, 20);
  const p2 = pop(frame, t0 + 10, 20);
  const p3 = pop(frame, t0 + 22, 20);
  const title = b.title ?? "DRPO";
  const size = fitFont(title, box.w - 500, 190, 70);
  return (
    <div style={{ width: box.w, height: box.h, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 36, transform: `scale(${p1})`, opacity: Math.min(1, p1) }}>
        {b.sticker && <Sticker name={b.sticker} size={size * 0.95} />}
        <div style={{ fontSize: size, fontWeight: 900, color: C.navy, letterSpacing: 4, lineHeight: 1 }}>{title}</div>
      </div>
      {b.text && (
        <div style={{ fontSize: fitFont(b.text, box.w - 200, 64, 34), fontWeight: 900, color: C.teal, opacity: Math.min(1, p2), transform: `translateY(${(1 - Math.min(1, p2)) * 20}px)` }}>
          {b.text}
        </div>
      )}
      {b.paper && (
        <div
          style={{
            opacity: Math.min(1, p3),
            transform: `translateY(${(1 - Math.min(1, p3)) * 30}px)`,
            background: "rgba(255,255,255,0.92)",
            border: `4px solid ${C.teal}`,
            borderRadius: 24,
            padding: "18px 44px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 40, fontWeight: 800, color: C.navy, fontFamily: MATH }}>Rethinking the Divergence Regularization in LLM RL</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: C.gray, marginTop: 8 }}>Tencent Hunyuan · arXiv:2606.09821</div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// dist:概率分布柱状图。旧概率 → 新概率 的变化，或者"长尾词表"示意
// ---------------------------------------------------------------------------
export const DistEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const t0 = at(b.at);
  const W = box.w;
  const top = 150;
  const base = box.h - 150;
  const H = base - top;
  const left = 110;
  const right = W - 110;

  // ---- 长尾示意 ----
  if (b.preset === "longtail") {
    const N = 40;
    const K = 16; // 尾巴的根数
    const hs = Array.from({ length: N }, (_, i) => Math.pow(1 / (1 + 0.7 * i), 1.15));
    const barW = ((right - left) / N) * 0.72;
    const tailStart = N - K;
    const tailP = ramp(frame, b.newAt ? at(b.newAt) : t0 + 50, 14);
    return (
      <div style={{ width: W, height: box.h, position: "relative" }}>
        <svg width={W} height={box.h} style={{ position: "absolute", inset: 0 }}>
          {hs.map((h, i) => {
            const p = pop(frame, t0 + i * 1.6, 14);
            const x = left + ((i + 0.5) * (right - left)) / N - barW / 2;
            const hh = Math.max(6, h * H) * Math.min(1, p);
            const isTail = i >= tailStart;
            return <rect key={i} x={x} y={base - hh} width={barW} height={hh} rx={5} fill={isTail ? C.pink : C.teal} opacity={isTail ? 0.35 + 0.65 * tailP : 1} />;
          })}
          <line x1={left - 10} y1={base} x2={right + 10} y2={base} stroke={C.navy} strokeWidth={5} strokeLinecap="round" />
          <g opacity={tailP}>
            <path
              d={`M ${left + (tailStart * (right - left)) / N} ${base + 22} v 14 H ${right} v -14`}
              fill="none"
              stroke={C.pink}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
        <div style={{ position: "absolute", left: left, top: 24, fontSize: 38, fontWeight: 900, color: C.navy }}>词表里的词，按概率从高到低排</div>
        <div style={{ position: "absolute", left: left + 40, top: top + 90, opacity: Math.min(1, pop(frame, t0 + 20, 16)), fontSize: 34, fontWeight: 800, color: C.teal }}>头部：常见的大词</div>
        <div style={{ position: "absolute", right: 90, width: 700, textAlign: "center", top: base + 44, opacity: tailP, fontSize: 44, fontWeight: 900, color: C.pink }}>
          {b.label ?? "长长的尾巴：很少见的小词"}
        </div>
        <div style={{ position: "absolute", right: 110, top: top + 20, opacity: tailP }}>
          <Badge text="示意图，不是真实数据" bg={C.gray} size={26} />
        </div>
      </div>
    );
  }

  // ---- 旧 → 新 概率变化 ----
  const toks = b.tokens ?? [];
  const n = Math.max(toks.length, 1);
  const maxV = Math.max(0.05, ...toks.map((t) => Math.max(t.old, t.new ?? t.old)));
  const hasNew = toks.some((t) => t.new != null);
  const nt = b.newAt ? ease(frame, at(b.newAt), 40) : 0;
  const slot = (right - left) / n;
  const barW = Math.min(150, slot * 0.58);
  return (
    <div style={{ width: W, height: box.h, position: "relative" }}>
      <svg width={W} height={box.h} style={{ position: "absolute", inset: 0 }}>
        <line x1={left - 10} y1={base} x2={right + 10} y2={base} stroke={C.navy} strokeWidth={5} strokeLinecap="round" />
        {toks.map((t, i) => {
          const p = pop(frame, t0 + i * 4, 16);
          const v = t.old + ((t.new ?? t.old) - t.old) * nt;
          const x = left + (i + 0.5) * slot - barW / 2;
          const hh = Math.max(4, (v / maxV) * H) * Math.min(1, p);
          const oldH = Math.max(4, (t.old / maxV) * H);
          const hot = (b.highlight ?? []).includes(i);
          const color = hot ? C.pink : nt > 0.5 ? C.orange : C.teal;
          return (
            <g key={i}>
              {nt > 0 && <rect x={x} y={base - oldH} width={barW} height={oldH} rx={8} fill="none" stroke={C.gray} strokeWidth={4} strokeDasharray="10 8" />}
              <rect x={x} y={base - hh} width={barW} height={hh} rx={8} fill={color} />
              <text x={x + barW / 2} y={base - hh - 14} textAnchor="middle" fontFamily={FONT} fontSize={34} fontWeight={800} fill={C.navy} opacity={Math.min(1, p)}>
                {num(v * 100)}%
              </text>
              <text x={x + barW / 2} y={base + 48} textAnchor="middle" fontFamily={FONT} fontSize={fitFont(t.label, slot - 10, 38, 24)} fontWeight={800} fill={C.navy}>
                {t.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ position: "absolute", left: left, top: 18, display: "flex", gap: 18, alignItems: "center" }}>
        <Badge text="旧策略 μ（出门前）" bg={C.teal} size={30} op={Math.min(1, pop(frame, t0, 14))} />
        {hasNew && b.newAt && <Badge text="新策略 π（更新后）" bg={C.orange} size={30} op={ramp(frame, at(b.newAt), 14)} />}
      </div>
      <div style={{ position: "absolute", right: 110, top: 18 }}>
        <Badge text="举例，数字是假设的" bg={C.gray} size={24} />
      </div>
      {b.label && (
        <div style={{ position: "absolute", left: 0, width: W, top: base + 100, textAlign: "center", fontSize: 40, fontWeight: 900, color: C.navy }}>{b.label}</div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// numberline:数轴。点沿着数轴移动，程序算出变化量和倍数；可以标一段"允许范围"
// ---------------------------------------------------------------------------
export const NumberLineEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const t0 = at(b.at);
  const ax = b.axis ?? { min: 0, max: 1 };
  const pct = ax.fmt === "pct";
  const W = box.w;
  const x0 = 130;
  const x1 = W - 130;
  const lineY = box.h * 0.66;
  const pos = (v: number) => x0 + ((v - ax.min) / (ax.max - ax.min)) * (x1 - x0);
  const step = ax.step ?? (ax.max - ax.min) / 5;
  const ticks: number[] = [];
  for (let v = ax.min; v <= ax.max + 1e-9; v += step) ticks.push(+v.toFixed(6));
  const fmtV = (v: number) => (pct ? `${trim((v * 100).toFixed(1))}%` : num(v));
  const bandP = ramp(frame, t0, 16);
  const pts = b.points ?? [];

  return (
    <div style={{ width: W, height: box.h, position: "relative" }}>
      <svg width={W} height={box.h} style={{ position: "absolute", inset: 0 }}>
        {b.band && (
          <g opacity={bandP}>
            <rect x={pos(b.band.from)} y={lineY - 52} width={pos(b.band.to) - pos(b.band.from)} height={104} rx={14} fill="rgba(62,156,140,0.28)" stroke={C.teal} strokeWidth={5} />
          </g>
        )}
        <line x1={x0 - 20} y1={lineY} x2={x1 + 20} y2={lineY} stroke={C.navy} strokeWidth={7} strokeLinecap="round" />
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pos(v)} y1={lineY - 12} x2={pos(v)} y2={lineY + 12} stroke={C.navy} strokeWidth={5} />
            <text x={pos(v)} y={lineY + 52} textAnchor="middle" fontFamily={FONT} fontSize={32} fontWeight={700} fill={C.navy}>
              {fmtV(v)}
            </text>
          </g>
        ))}
        {pts.map((p, i) => {
          if (p.to == null) return null;
          const s = ramp(frame, at(p.at) + 10, 30);
          const xa = pos(p.from);
          const xb = pos(p.from + (p.to - p.from) * ease(frame, at(p.at) + 10, 40));
          return <line key={i} x1={xa} y1={lineY} x2={Math.max(xb, xa + 8 * s)} y2={lineY} stroke={tone(p.tone, "pink")} strokeWidth={16} strokeLinecap="round" opacity={0.9} />;
        })}
      </svg>
      {b.band && (
        <>
          <div style={{ position: "absolute", left: pos(b.band.from), width: pos(b.band.to) - pos(b.band.from), top: lineY - 116, textAlign: "center", opacity: bandP, fontSize: 38, fontWeight: 900, color: C.teal }}>
            {b.band.label}
          </div>
          {[b.band.from, b.band.to].map((v, i) => (
            <div key={i} style={{ position: "absolute", left: pos(v) - 38, top: lineY - 150, opacity: bandP }}>
              <Sticker name="scissors" size={76} />
            </div>
          ))}
        </>
      )}
      {pts.map((p, i) => {
        const a = at(p.at);
        const cur = p.to == null ? p.from : p.from + (p.to - p.from) * ease(frame, a + 10, 40);
        const done = p.to != null && frame >= a + 52;
        const enter = pop(frame, a, 16);
        const color = tone(p.tone, "pink");
        const x = pos(cur);
        const stSize = 150;
        const delta = p.to != null ? p.to - p.from : 0;
        const ratio = p.to != null && p.from > 0 ? p.to / p.from : 0;
        const ratioTxt = `×${trim((ratio >= 10 ? ratio.toFixed(0) : (Math.round(ratio * 10) / 10).toString()).toString())}`;
        const deltaTxt = pct ? `${delta >= 0 ? "+" : "−"}${trim(Math.abs(delta * 100).toFixed(2))} 个百分点` : `${delta >= 0 ? "+" : "−"}${num(Math.abs(delta))}`;
        const labelW = 360;
        const lx = Math.min(Math.max(x - labelW / 2, 10), W - labelW - 10);
        return (
          <div key={i}>
            <div style={{ position: "absolute", left: x - stSize / 2, top: lineY - stSize - 30 - (i % 2) * 0, transform: `scale(${Math.min(1.1, enter)})`, transformOrigin: "50% 100%", opacity: Math.min(1, enter) }}>
              {p.sticker && <Sticker name={p.sticker} size={stSize} />}
            </div>
            <div style={{ position: "absolute", left: x - 7, top: lineY - 40, width: 14, height: 14, borderRadius: 7, background: color, opacity: Math.min(1, enter) }} />
            <div style={{ position: "absolute", left: lx, width: labelW, top: lineY - stSize - 100, textAlign: "center", fontSize: 42, fontWeight: 900, color, opacity: Math.min(1, enter) }}>{p.label}</div>
            {done && (
              <div style={{ position: "absolute", left: lx - 20, width: labelW + 40, top: lineY + 96 + (i % 2) * 74, textAlign: "center", opacity: ramp(frame, a + 52, 12), whiteSpace: "nowrap" }}>
                {ratio > 0 && <Badge text={`比例 ${ratioTxt}`} bg={color} size={32} />} <Badge text={deltaTxt} bg={C.navy} size={32} />
              </div>
            )}
          </div>
        );
      })}
      {b.label && <div style={{ position: "absolute", left: 0, width: W, top: 16, textAlign: "center", fontSize: 44, fontWeight: 900, color: C.navy }}>{b.label}</div>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// plot:函数曲线图。只提供几个固定的"预设"，曲线由程序按公式画，不让模型自己画
//   weight : 梯度权重 w 随概率变化量 D（以 δ 为单位）的变化(往外冲 / 往回走 / DPPO 硬掩码)
//   blowup : 同样的概率变化量下，SPO 与 DRPO 的权重大小随旧概率 μ 的变化
// ---------------------------------------------------------------------------
type Pt = [number, number];
const sample = (fn: (x: number) => number, a: number, bnd: number, n = 60): Pt[] => Array.from({ length: n + 1 }, (_, i) => [a + ((bnd - a) * i) / n, fn(a + ((bnd - a) * i) / n)] as Pt);

export const PlotEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const t0 = at(b.at);
  const preset = b.preset === "blowup" ? "blowup" : "weight";
  const W = box.w;
  const L = 170;
  const R = W - 120;
  const T = 70;
  const B = box.h - 90;

  const cfg =
    preset === "weight"
      ? { xmin: 0, xmax: 1.6, ymin: -1, ymax: 2.6, xlab: "概率变化量 D（以 δ 为单位）", ylab: "梯度权重 w", yticks: [-1, 0, 1, 2] }
      : { xmin: 0, xmax: 1, ymin: 0, ymax: 8, xlab: "旧概率 μ", ylab: "权重被改变的幅度 |w − 1|", yticks: [0, 2, 4, 6, 8] };
  const sx = (x: number) => L + ((x - cfg.xmin) / (cfg.xmax - cfg.xmin)) * (R - L);
  const sy = (y: number) => B - ((y - cfg.ymin) / (cfg.ymax - cfg.ymin)) * (B - T);
  const clipY = (y: number) => Math.max(cfg.ymin, Math.min(cfg.ymax, y));

  type Curve = { id: string; pts: Pt[]; color: string; dashed?: boolean; label: string; fn: (x: number) => number };
  const D_FIX = 0.05;
  const EPS = 0.2;
  const defs: Record<string, Curve> =
    preset === "weight"
      ? {
          out: { id: "out", pts: sample((x) => 1 - x, 0, 1.6, 2), color: C.pink, label: "往外冲：w = 1 − D/δ", fn: (x) => 1 - x },
          in: { id: "in", pts: sample((x) => 1 + x, 0, 1.6, 2), color: C.teal, label: "往回走：w = 1 + D/δ", fn: (x) => 1 + x },
          mask: { id: "mask", pts: [[0, 1], [1, 1], [1, 0], [1.6, 0]], color: C.gray, dashed: true, label: "DPPO 硬掩码：到边界突然归零", fn: (x) => (x < 1 ? 1 : 0) },
        }
      : {
          spo: { id: "spo", pts: sample((x) => clipY(D_FIX / (Math.max(x, 0.005) * EPS)), 0.02, 1, 120), color: C.pink, label: "SPO：旧概率越小，权重越失控", fn: (x) => D_FIX / (Math.max(x, 0.005) * EPS) },
          drpo: { id: "drpo", pts: sample(() => D_FIX / EPS, 0.02, 1, 2), color: C.teal, label: "DRPO：始终有界", fn: () => D_FIX / EPS },
        };
  const curves = (b.curves ?? []).filter((c) => defs[c.id]);
  const marks = [...(b.marks ?? [])].map((m) => ({ ...m, f: at(m.at) })).sort((a, c) => a.f - c.f);

  // 曲线名字的固定位置(避开曲线和坐标轴)
  const LBL: Record<string, { left: number; top: number }> =
    preset === "weight"
      ? { in: { left: sx(0.05), top: sy(2.15) }, out: { left: sx(0.55), top: sy(-0.92) }, mask: { left: sx(1.06), top: sy(1) - 22 } }
      : { spo: { left: sx(0.22), top: sy(5.4) }, drpo: { left: sx(0.5), top: sy(2.0) } };
  const path = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? "L" : "M"} ${sx(x)} ${sy(clipY(y))}`).join(" ");

  // 圆点位置:沿着 on 指定的曲线，从上一个 mark 滑到当前 mark
  let k = -1;
  marks.forEach((m, i) => {
    if (frame >= m.f) k = i;
  });
  const dotFor = (m: { x: number; on?: string }) => {
    const c = defs[m.on ?? (preset === "weight" ? "out" : "spo")];
    return { x: m.x, y: c ? c.fn(m.x) : 0, color: c?.color ?? C.pink };
  };
  let dot: { x: number; y: number; color: string } | null = null;
  if (k >= 0) {
    const cur = dotFor(marks[k]);
    const prev = k > 0 ? dotFor(marks[k - 1]) : { ...cur, x: cfg.xmin, y: dotFor({ ...marks[k], x: cfg.xmin }).y };
    const t = ease(frame, marks[k].f, 26);
    dot = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t, color: cur.color };
  }
  const curMark = k >= 0 ? marks[k] : null;

  return (
    <div style={{ width: W, height: box.h, position: "relative" }}>
      <svg width={W} height={box.h} style={{ position: "absolute", inset: 0 }}>
        {preset === "weight" && <rect x={L} y={sy(0)} width={R - L} height={B - sy(0)} fill={C.pink} opacity={0.07} />}
        <line x1={L} y1={T - 20} x2={L} y2={B} stroke={C.navy} strokeWidth={5} strokeLinecap="round" />
        <line x1={L} y1={preset === "weight" ? sy(0) : B} x2={R + 30} y2={preset === "weight" ? sy(0) : B} stroke={C.navy} strokeWidth={5} strokeLinecap="round" />
        {cfg.yticks.map((y) => (
          <g key={y}>
            <line x1={L - 10} y1={sy(y)} x2={L + 10} y2={sy(y)} stroke={C.navy} strokeWidth={4} />
            <text x={L - 22} y={sy(y) + 12} textAnchor="end" fontFamily={FONT} fontSize={32} fontWeight={700} fill={C.navy}>
              {y}
            </text>
          </g>
        ))}
        {preset === "weight" && (
          <>
            <line x1={sx(1)} y1={T} x2={sx(1)} y2={B} stroke={C.pink} strokeWidth={4} strokeDasharray="12 10" />
            <text x={sx(1)} y={B + 52} textAnchor="middle" fontFamily={FONT} fontSize={34} fontWeight={800} fill={C.pink}>
              边界 δ
            </text>
          </>
        )}
        {curves.map((c, i) => {
          const d = defs[c.id];
          const p = ramp(frame, at(c.at), 40);
          return (
            <path
              key={i}
              d={path(d.pts)}
              pathLength={1}
              fill="none"
              stroke={d.color}
              strokeWidth={d.dashed ? 7 : 11}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={d.dashed ? "16 12" : 1}
              strokeDashoffset={d.dashed ? 0 : 1 - p}
              opacity={d.dashed ? p : 1}
            />
          );
        })}
        {dot && <circle cx={sx(dot.x)} cy={sy(clipY(dot.y))} r={20} fill={dot.color} stroke={C.white} strokeWidth={5} />}
      </svg>
      <div style={{ position: "absolute", left: L + 18, top: 8, fontSize: 36, fontWeight: 800, color: C.navy }}>{cfg.ylab}</div>
      <div style={{ position: "absolute", right: 40, top: B + 36, fontSize: 34, fontWeight: 800, color: C.navy }}>{cfg.xlab} →</div>
      {curves.map((c, i) => {
        const d = defs[c.id];
        const last = d.pts[d.pts.length - 1];
        const p = ramp(frame, at(c.at) + 20, 16);
        const right = preset === "weight";
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: LBL[c.id]?.left ?? sx(0.06),
              top: LBL[c.id]?.top ?? sy(clipY(last[1])),
              opacity: p,
              fontSize: 34,
              fontWeight: 900,
              color: d.color,
              fontFamily: MATH,
              whiteSpace: "nowrap",
            }}
          >
            {c.label ?? d.label}
          </div>
        );
      })}
      {dot && curMark && (
        <div
          style={{
            position: "absolute",
            left: Math.min(sx(dot.x) + 34, W - 560),
            top: Math.max(sy(clipY(dot.y)) - 70, 56),
            background: "rgba(255,255,255,0.95)",
            border: `4px solid ${dot.color}`,
            borderRadius: 18,
            padding: "6px 18px",
            fontSize: 34,
            fontWeight: 900,
            color: C.navy,
            whiteSpace: "nowrap",
          }}
        >
          {preset === "weight"
            ? (() => {
                const x = curMark.x;
                const w = defs[curMark.on ?? "out"]?.fn(x) ?? 1 - x;
                const dTxt = b.delta ? `D = ${trim((x * b.delta).toFixed(3))}，` : `D/δ = ${trim(x.toFixed(2))}，`;
                return `${dTxt}w = ${trim(w.toFixed(2))}`;
              })()
            : (() => {
                const x = curMark.x;
                const spo = D_FIX / (x * EPS);
                return `μ = ${trim(x.toFixed(3))}：SPO ${trim(spo.toFixed(1))}，DRPO ${trim((D_FIX / EPS).toFixed(2))}`;
              })()}
        </div>
      )}
      {preset === "blowup" && (
        <div style={{ position: "absolute", right: 60, top: T + 10 }}>
          <Badge text="示意：变化量固定为 0.05，阈值取 0.2" bg={C.gray} size={26} />
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// eq:推导步骤栈。公式只能引用 eqlib 里的现成公式(对照论文写好的)，不让模型自己写公式
// ---------------------------------------------------------------------------
type EqDef = { title: string; formula: string; legend: string };
const LIB = eqlib as Record<string, EqDef>;

export const EqEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const eqs = b.eqs ?? [];
  const n = Math.max(eqs.length, 1);
  const gap = 14;
  const rowH = Math.min(n <= 2 ? 290 : 210, (box.h - gap * (n - 1)) / n);
  const y0 = Math.max(0, (box.h - (n * rowH + (n - 1) * gap)) / 2);
  const solo = eqs.length === 1; // 只有一行时：去掉右侧说明列，公式用满整行
  const titleW = solo ? 200 : 230;
  const formulaW = solo ? box.w - 68 - titleW - 40 : box.w - 68 - titleW - 380 - 60; // 去掉左右内边距、标题列、说明列、间距
  const shown = eqs.filter((e) => frame >= at(e.at)).length;
  return (
    <div style={{ width: box.w, height: box.h, position: "relative" }}>
      {eqs.map((e, i) => {
        const def: EqDef | undefined = e.tex ? { title: e.title ?? T().formula, formula: "", legend: e.note ?? "" } : LIB[e.ref ?? ""];
        if (!def) return null;
        const a = at(e.at) + eqs.slice(0, i).filter((q) => q.at === e.at).length * 7;
        const p = pop(frame, a, 18);
        if (frame < a) return null;
        const latest = i === shown - 1;
        const color = latest ? C.pink : C.teal;
        const plain = def.formula.replace(/\{\{|\}\}/g, "");
        const fs = e.tex ? (rowH > 200 ? 62 : rowH > 130 ? 54 : 44) : fitFont(plain, box.w * 0.62, rowH > 130 ? 76 : 54, 30);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              top: y0 + i * (rowH + gap),
              width: box.w,
              height: rowH,
              boxSizing: "border-box",
              borderRadius: 24,
              background: "rgba(255,255,255,0.94)",
              border: `5px solid ${color}`,
              padding: "0 34px",
              display: "flex",
              alignItems: "center",
              gap: 30,
              opacity: Math.min(1, p),
              transform: `translateX(${(1 - Math.min(1, p)) * -80}px) scale(${0.96 + 0.04 * Math.min(1.05, p)})`,
              overflow: "hidden",
            }}
          >
            <div style={{ width: titleW, flex: "none" }}>
              <Badge text={T().step(i + 1)} bg={color} size={28} />
              <div style={{ fontSize: fitFont(def.title, 220, 34, 22), fontWeight: 900, color: C.navy, marginTop: 8, lineHeight: 1.15 }}>{def.title}</div>
              {solo && def.legend && <div style={{ fontSize: fitFont(def.legend, titleW - 10, 26, 18), fontWeight: 800, color: C.gray, marginTop: 8, lineHeight: 1.2 }}>{def.legend}</div>}
            </div>
            <div style={{ flex: 1, minWidth: 0, fontSize: fs, fontWeight: 700, color: C.navy, fontFamily: MATH, whiteSpace: "nowrap" }}>{e.tex ? <FitTex tex={e.tex} hl={e.hl} size={fs} width={formulaW} height={rowH - 20} /> : hl(def.formula, C.pink)}</div>
            {!solo && (
            <div style={{ width: 380, flex: "none", textAlign: "right", overflow: "hidden" }}>
              <div style={{ fontSize: fitFont(def.legend, 380, 34, 22), fontWeight: 800, color: C.gray }}>{def.legend}</div>
              {e.note && !e.tex && (
                <div style={{ marginTop: 6 }}>
                  <Badge text={e.note} bg={C.pink} size={24} />
                </div>
              )}
            </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// rows:清单。每行一个对象(模型、方法……)，行逐条出现，最后给结论标记(✓ ✗ ⚠)
// ---------------------------------------------------------------------------
const STATUS_ICON: Record<string, string> = { ok: "check-mark-button", bad: "cross-mark", warn: "warning", idea: "light-bulb" };

export const RowsEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const rows = b.list ?? [];
  const n = Math.max(rows.length, 1);
  const gap = 12;
  const rowH = Math.min(170, (box.h - gap * (n - 1)) / n);
  const y0 = Math.max(0, (box.h - (n * rowH + (n - 1) * gap)) / 2);
  const W = Math.min(box.w, 1500);
  const x0 = (box.w - W) / 2;
  return (
    <div style={{ width: box.w, height: box.h, position: "relative" }}>
      {rows.map((r, i) => {
        const a = at(r.at) + rows.slice(0, i).filter((q) => q.at === r.at).length * 7; // 同一句出现的多行依次弹出
        if (frame < a) return null;
        const p = pop(frame, a, 18);
        const color = tone(r.tone, r.status === "bad" ? "pink" : r.status === "warn" ? "orange" : "teal");
        const sp = r.statusAt ? pop(frame, at(r.statusAt), 16) : r.status ? pop(frame, a + 22, 16) : 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x0,
              top: y0 + i * (rowH + gap),
              width: W,
              height: rowH,
              boxSizing: "border-box",
              borderRadius: 22,
              background: "rgba(255,255,255,0.94)",
              border: `5px solid ${color}`,
              padding: "0 30px",
              display: "flex",
              alignItems: "center",
              gap: 26,
              opacity: Math.min(1, p),
              transform: `translateX(${(1 - Math.min(1, p)) * 90}px)`,
            }}
          >
            {r.sticker && <Sticker name={r.sticker} size={rowH * 0.7} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: fitFont(r.label, W * 0.55, rowH > 120 ? 64 : rowH > 90 ? 54 : 42, 28), fontWeight: 900, color: C.navy }}>{r.label}</div>
              {r.sub && <div style={{ fontSize: fitFont(r.sub, W * 0.6, rowH > 120 ? 40 : 34, 22), fontWeight: 700, color: C.gray }}>{r.sub}</div>}
            </div>
            {r.verdict && <div style={{ fontSize: fitFont(r.verdict, W * 0.3, rowH > 120 ? 46 : 38, 22), fontWeight: 900, color, opacity: Math.min(1, sp), whiteSpace: "nowrap" }}>{r.verdict}</div>}
            {r.status && (
              <div style={{ transform: `scale(${Math.min(1.15, sp)})`, opacity: Math.min(1, sp) }}>
                <Sticker name={STATUS_ICON[r.status]} size={rowH * 0.72} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
