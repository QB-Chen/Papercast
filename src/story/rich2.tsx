import React from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Img, interpolate, staticFile, Easing, delayRender, continueRender } from "remotion";
import { ramp } from "../anim";
import { C, FONT } from "../theme";
import { Sticker, useCue } from "../drpo/kit";
import { TONE, fitFont } from "./elements";
import type { Beat, Tone } from "./types";
import { HandLoop } from "./hand";

type Box = { w: number; h: number };
const tone = (t?: Tone, fallback: Tone = "teal") => TONE[t ?? fallback];
const trimNum = (s: string): string => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

const pop = (frame: number, start: number, dur = 16): number => {
  const t = Math.min(1, Math.max(0, (frame - start) / dur));
  const c1 = 1.70158;
  return t === 0 ? 0 : 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const ease = (frame: number, start: number, dur: number): number =>
  interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });

// ---------------------------------------------------------------------------
// LaTeX 公式(KaTeX)。公式文本来自论文源码；hl 里的片段会被染成强调色
// ---------------------------------------------------------------------------
// 宏体里的 # 要写成 ##，否则 #D 会被当成宏参数
const MACROS = { "\\hl": "\\textcolor{##D6336C}{#1}" };

/** 论文源码里的 LaTeX 有些写法 KaTeX 不认，先改成等价写法 */
export function sanitizeTex(tex: string): string {
  return tex
    .replace(/\\begin\{split\}/g, "\\begin{aligned}")
    .replace(/\\end\{split\}/g, "\\end{aligned}")
    .replace(/\\color\[[^\]]*\]\{[^}]*\}/g, "")
    .replace(/\\displaystyle/g, "")
    .replace(/\\operatorname\*/g, "\\operatorname")
    .replace(/\\nonumber|\\notag/g, "");
}

export function texWithHighlights(tex: string, hl: string[] = []): string {
  let out = sanitizeTex(tex);
  for (const h of hl) {
    const i = out.indexOf(h);
    if (i >= 0 && !out.slice(0, i).endsWith("\\hl{")) out = `${out.slice(0, i)}\\hl{${h}}${out.slice(i + h.length)}`;
  }
  return out;
}

export const Tex: React.FC<{ tex: string; hl?: string[]; size: number; color?: string; display?: boolean }> = ({ tex, hl, size, color = C.navy, display = false }) => {
  const html = React.useMemo(
    () => katex.renderToString(texWithHighlights(tex, hl), { throwOnError: false, displayMode: display, macros: MACROS, strict: "ignore", output: "html" }),
    [tex, hl, display],
  );
  return <span style={{ fontSize: size, color, whiteSpace: "nowrap" }} dangerouslySetInnerHTML={{ __html: html }} />;
};

/**
 * 自动缩放到装得下：先用 KaTeX 画出来，在浏览器里量真实宽高，比容器大就整体缩小。
 * 要等字体加载完再量，否则宽度不准；用 delayRender 让 Remotion 等这一步做完再截图。
 */
export const FitTex: React.FC<{ tex: string; hl?: string[]; size: number; width: number; height: number; color?: string }> = ({ tex, hl, size, width, height, color }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const handle = React.useRef<number | null>(null);
  if (handle.current === null) handle.current = delayRender("katex-fit");
  React.useLayoutEffect(() => {
    let alive = true;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const w = el.offsetWidth || 1;
      const h = el.offsetHeight || 1;
      setScale(Math.min(1, width / w, height / h));
    };
    measure();
    const fonts = (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts;
    (fonts?.ready ?? Promise.resolve()).then(() => {
      if (!alive) return;
      measure();
      if (handle.current !== null) {
        continueRender(handle.current);
        handle.current = -1;
      }
    });
    return () => {
      alive = false;
    };
  }, [tex, hl, size, width, height]);
  return (
    <div style={{ width, height, overflow: "hidden", display: "flex", alignItems: "center" }}>
      <div ref={ref} style={{ display: "inline-block", transform: `scale(${scale})`, transformOrigin: "left center" }}>
        <Tex tex={tex} hl={hl} size={size} color={color} />
      </div>
    </div>
  );
};

/** 估算一条 LaTeX 公式画出来大约多少个字符宽，用来选字号 */
export const texChars = (tex: string): number => tex.replace(/\\(left|right|big|Big|,|;|!|quad|qquad)/g, "").replace(/\\[a-zA-Z]+/g, "X").replace(/[{}^_\s&]/g, "").length;

/** 一段文字里夹着 $...$ 的行内公式 */
export const RichText: React.FC<{ text: string; size: number; color?: string }> = ({ text, size, color = C.navy }) => (
  <span style={{ fontSize: size, color }}>
    {text.split(/(\$[^$]+\$)/g).map((p, i) => (p.startsWith("$") && p.endsWith("$") && p.length > 2 ? <Tex key={i} tex={p.slice(1, -1)} size={size} color={color} /> : <span key={i}>{p}</span>))}
  </span>
);

// ---------------------------------------------------------------------------
// fig:论文原图。按旁白逐步放大到图的某一块，并配一句说明
// ---------------------------------------------------------------------------
// 每个焦点对应图上的一块区域 [x0, y0, x1, y1]（占整图的比例）。外框会变成这块区域的形状，整块完整放进去，不再裁掉上下或左右
const REGION: Record<string, [number, number, number, number]> = {
  all: [0, 0, 1, 1],
  left: [0, 0, 0.5, 1],
  right: [0.5, 0, 1, 1],
  top: [0, 0, 1, 0.5],
  bottom: [0, 0.5, 1, 1],
  tl: [0, 0, 0.5, 0.5],
  tr: [0.5, 0, 1, 0.5],
  bl: [0, 0.5, 0.5, 1],
  br: [0.5, 0.5, 1, 1],
  center: [0.15, 0.15, 0.85, 0.85],
};

export const FigEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const info = b.figInfo;
  if (!info?.file) return null;
  const parts = info.parts && info.parts.length > 1 ? info.parts : null;
  const asp = (p: { w: number; h: number }) => (p.w && p.h ? p.w / p.h : 1.3);
  const aspect = parts ? parts.reduce((a, p) => a + asp(p), 0) + (parts.length - 1) * 0.04 : info.w && info.h ? info.w / info.h : 1.6;
  const labelH = 96;
  const FRAME_PAD = 34; // 外框的 padding(12*2) + 边框(5*2)，之前漏算了边框，内容被多裁掉 10 像素
  const maxW = box.w - 60 - FRAME_PAD;
  const maxH = box.h - labelH - 20 - FRAME_PAD;
  const IH = 1000; // 图的"虚拟"原始尺寸，只用来算比例
  const IW = IH * aspect;
  const steps = [...(b.focusSteps ?? [{ at: b.at, focus: "all" }])].map((s) => ({ ...s, f: at(s.at) })).sort((x, y) => x.f - y.f);
  let k = -1;
  steps.forEach((s, i) => {
    if (frame >= s.f) k = i;
  });
  const cur = steps[Math.max(k, 0)];
  const prev = steps[Math.max(k - 1, 0)];
  const t = k <= 0 ? 1 : ease(frame, cur.f, 28);
  const rc = REGION[cur.focus] ?? REGION.all;
  const rp = REGION[prev.focus] ?? REGION.all;
  const R = rp.map((v, i) => v + (rc[i] - v) * t) as [number, number, number, number]; // 区域随时间平滑过渡
  // 把这块区域按原比例整块放进可用空间：缩放倍数由宽高中更紧的那一边决定，所以一定放得下，不会被裁
  const regW = (R[2] - R[0]) * IW;
  const regH = (R[3] - R[1]) * IH;
  const s = Math.min(maxW / regW, maxH / regH);
  const vw = regW * s; // 外框内容区的宽高 = 这块区域按倍数放大后的尺寸
  const vh = regH * s;
  const fh = IH * s; // 整图放大后的高度
  const enter = pop(frame, at(b.at), 18);
  return (
    <div style={{ width: box.w, height: box.h, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      {/* 外框区域固定高度，框在里面居中，切换焦点时标签不会跟着跳 */}
      <div style={{ height: box.h - labelH - 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: vw + FRAME_PAD,
            height: vh + FRAME_PAD,
            boxSizing: "border-box",
            borderRadius: 22,
            background: C.white,
            border: `5px solid ${C.teal}`,
            overflow: "hidden",
            padding: 12,
            transform: `scale(${Math.min(1.02, enter)})`,
            opacity: Math.min(1, enter),
          }}
        >
          <div style={{ width: vw, height: vh, overflow: "hidden", position: "relative" }}>
            <div style={{ position: "absolute", left: -R[0] * IW * s, top: -R[1] * IH * s, width: IW * s, height: fh, display: "flex", gap: fh * 0.04 }}>
              {(parts ?? [{ file: info.file, w: info.w, h: info.h }]).map((p, i) => (
                <Img key={i} src={staticFile(p.file as string)} style={{ height: fh, width: parts ? fh * asp(p) : IW * s, objectFit: "contain" }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div style={{ height: labelH, display: "flex", alignItems: "center", justifyContent: "center", opacity: ramp(frame, cur.f, 12), textAlign: "center" }}>
        <div style={{ fontSize: fitFont(cur.label ?? info.caption ?? "", box.w - 120, 46, 26), fontWeight: 900, color: C.navy }}>{cur.label ?? ""}</div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// table:论文原表。可以只显示几行几列，并按旁白高亮某些行/列
// ---------------------------------------------------------------------------
export const TableEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const info = b.tableInfo;
  if (!info) return null;
  const rowsAll = info.rows;
  const rIdx = b.showRows ?? rowsAll.map((_, i) => i);
  const cIdx = b.showCols ?? rowsAll[0].map((_, i) => i);
  const steps = [...(b.hlSteps ?? [])].map((s) => ({ ...s, f: at(s.at) })).sort((x, y) => x.f - y.f);
  const cur = [...steps].reverse().find((s) => frame >= s.f);
  const nRows = rIdx.length;
  const nCols = cIdx.length;
  // 列宽按内容算：每列取这一列里最长的单元格（汉字占 1 个字宽，英文数字约 0.58 个字宽）。
  // 字号从大往小试，取"整张表放得进画面"的最大字号；小到下限还放不下，才让文字换行，而不是用省略号截断。
  const strW = (s: string) => [...s.replace(/\$/g, "")].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.58), 0);
  const availW = box.w - 90;
  const availH = box.h - 120;
  // 单元格太长（论文里有整段文本样例）的屏幕上没法读：有意识地只留开头，而不是被框边切掉
  const CELL_MAX = 52;
  const cell = (ri: number, ci: number) => {
    const s = (rowsAll[ri][ci] ?? "").replace(/\s+/g, " ").trim();
    return [...s].length > CELL_MAX ? [...s].slice(0, CELL_MAX - 1).join("") + "…" : s;
  };
  const colEm = cIdx.map((ci) => Math.max(...rIdx.map((ri) => strW(cell(ri, ci))), 2));
  let fs = 22;
  for (let f = 50; f >= 22; f -= 2) {
    const w = colEm.reduce((a, e) => a + e * f + 48, 0);
    if (w <= availW && nRows * f * 2.2 <= availH) {
      fs = f;
      break;
    }
  }
  let colWs = colEm.map((e) => e * fs + 48);
  const sumW = colWs.reduce((a, c) => a + c, 0);
  const wrap = sumW > availW; // 到下限还放不下：按比例压缩列宽，允许换行
  if (wrap) colWs = colWs.map((c) => (c * availW) / sumW);
  else if (sumW < availW * 0.62) colWs = colWs.map((c) => c * Math.min(1.5, (availW * 0.62) / sumW)); // 太窄的表适当撑开，别缩在中间一小块
  const rowH = Math.min(Math.floor(availH / nRows), Math.round(fs * (wrap ? 3.2 : 2.3)));
  const enter = pop(frame, at(b.at), 18);
  return (
    <div style={{ width: box.w, height: box.h, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, opacity: Math.min(1, enter) }}>
      <div style={{ position: "relative" }}>
      <div style={{ borderRadius: 22, border: `5px solid ${C.teal}`, background: C.white, overflow: "hidden" }}>
        {rIdx.map((ri, i) => {
          const header = i === 0;
          const rowHl = cur?.rows?.includes(ri);
          return (
            <div key={ri} style={{ display: "flex", height: rowH, background: header ? C.tealLight : rowHl ? "rgba(214,51,108,0.12)" : i % 2 ? "#F3F7F7" : C.white, borderTop: i ? "2px solid #D5E0E2" : undefined }}>
              {cIdx.map((ci, cj) => {
                const colHl = cur?.cols?.includes(ci);
                const hot = rowHl || colHl;
                return (
                  <div key={ci} style={{ width: colWs[cj], display: "flex", alignItems: "center", justifyContent: "center", padding: "0 14px", boxSizing: "border-box", fontWeight: header || hot ? 900 : 700, background: colHl && !header ? "rgba(214,51,108,0.12)" : undefined, color: hot ? C.pink : C.navy, textAlign: "center" }}>
                    <div style={{ maxWidth: "100%", whiteSpace: wrap ? "normal" : "nowrap", lineHeight: 1.15, overflowWrap: "anywhere" }}>
                      <RichText text={cell(ri, ci)} size={fs} color={hot ? C.pink : C.navy} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* 手绘圈：高亮某些行/列时，在底色之外再画一圈笔迹（行：圈住整行；列：圈住整列） */}
      {cur &&
        (() => {
          const BORDER = 5;
          const tableW = colWs.reduce((a, c) => a + c, 0);
          const loops: { x: number; y: number; w: number; h: number }[] = [];
          rIdx.forEach((ri, i) => {
            if (cur.rows?.includes(ri) && i > 0) loops.push({ x: BORDER, y: BORDER + i * rowH, w: tableW, h: rowH });
          });
          cIdx.forEach((ci, cj) => {
            if (cur.cols?.includes(ci)) loops.push({ x: BORDER + colWs.slice(0, cj).reduce((a, c) => a + c, 0), y: BORDER, w: colWs[cj], h: rIdx.length * rowH });
          });
          const lp = Math.min(1, ramp(frame, cur.f + 4, 22) * 1.1);
          return loops.map((l, k) => <HandLoop key={k} x={l.x} y={l.y} w={l.w} h={l.h} p={lp} seed={k * 5 + 2} pad={4} width={4} />);
        })()}
      </div>
      <div style={{ height: 70, opacity: cur ? ramp(frame, cur.f, 12) : 0, fontSize: fitFont(cur?.label ?? "", box.w - 120, 44, 26), fontWeight: 900, color: C.navy }}>{cur?.label ?? ""}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// chart:条形图 / 折线图。每个数字都必须在论文里出现过(校验器核对)
// ---------------------------------------------------------------------------
const niceMax = (v: number): number => {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-9))));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};
const SERIES_COLORS = [C.teal, C.orange, C.pink, C.navy];

export const ChartEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const t0 = at(b.at);
  const series = b.series ?? [];
  const xs = series[0]?.points.map((p) => p.x) ?? [];
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const ymax = niceMax(Math.max(...all, 1e-9));
  const L = 150;
  const R = box.w - 70;
  const T = 70;
  const B = box.h - 100;
  const sx = (i: number) => L + ((i + 0.5) * (R - L)) / Math.max(xs.length, 1);
  const sy = (y: number) => B - (y / ymax) * (B - T);
  const type = b.chartType === "line" ? "line" : "bar";
  const gP = ramp(frame, t0 + 6, 40);
  const hlX = b.hlAt && frame >= at(b.hlAt) ? b.hlX : undefined;
  const groupW = ((R - L) / Math.max(xs.length, 1)) * 0.72;
  const barW = groupW / Math.max(series.length, 1);
  const fmt = (y: number) => trimNum(y >= 100 ? y.toFixed(0) : y >= 10 ? y.toFixed(1) : y.toFixed(3).replace(/(\.\d*?)0+$/, "$1"));
  return (
    <div style={{ width: box.w, height: box.h, position: "relative" }}>
      <svg width={box.w} height={box.h} style={{ position: "absolute", inset: 0 }}>
        <line x1={L} y1={T - 20} x2={L} y2={B} stroke={C.navy} strokeWidth={5} strokeLinecap="round" />
        <line x1={L} y1={B} x2={R + 20} y2={B} stroke={C.navy} strokeWidth={5} strokeLinecap="round" />
        {[0, 0.25, 0.5, 0.75, 1].map((q) => (
          <g key={q}>
            <line x1={L - 8} y1={sy(q * ymax)} x2={R} y2={sy(q * ymax)} stroke={C.grid} strokeWidth={q ? 2 : 0} strokeDasharray="8 8" />
            <text x={L - 18} y={sy(q * ymax) + 11} textAnchor="end" fontFamily={FONT} fontSize={30} fontWeight={700} fill={C.navy}>
              {fmt(q * ymax)}
            </text>
          </g>
        ))}
        {xs.map((x, i) => (
          <text key={i} x={sx(i)} y={B + 48} textAnchor="middle" fontFamily={FONT} fontSize={fitFont(x, (R - L) / xs.length - 10, 34, 20)} fontWeight={800} fill={hlX === x ? C.pink : C.navy}>
            {x}
          </text>
        ))}
        {type === "bar" &&
          series.map((s, si) =>
            s.points.map((p, i) => {
              const delay = i * 4 + si * 3;
              const g = Math.min(1, Math.max(0, (frame - t0 - 6 - delay) / 24));
              const h = (B - sy(p.y)) * (1 - Math.pow(1 - g, 3));
              const x = sx(i) - groupW / 2 + si * barW;
              const hot = hlX === p.x;
              return (
                <g key={`${si}-${i}`}>
                  <rect x={x + 4} y={B - h} width={barW - 8} height={h} rx={8} fill={hot ? C.pink : SERIES_COLORS[si % 4]} />
                  <text x={x + barW / 2} y={B - h - 12} textAnchor="middle" fontFamily={FONT} fontSize={30} fontWeight={900} fill={C.navy} opacity={g}>
                    {fmt(p.y)}
                  </text>
                </g>
              );
            }),
          )}
        {type === "line" &&
          series.map((s, si) => {
            const pts = s.points.map((p, i) => [sx(i), sy(p.y)] as const);
            const d = pts.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
            return (
              <g key={si}>
                <path d={d} pathLength={1} fill="none" stroke={SERIES_COLORS[si % 4]} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={1} strokeDashoffset={1 - gP} />
                {pts.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={11} fill={SERIES_COLORS[si % 4]} opacity={gP > (i + 0.5) / pts.length ? 1 : 0} />
                ))}
              </g>
            );
          })}
      </svg>
      <div style={{ position: "absolute", left: L + 12, top: 4, fontSize: 36, fontWeight: 900, color: C.navy }}>{b.label ?? ""}</div>
      {series.length > 1 && (
        <div style={{ position: "absolute", right: 70, top: 6, display: "flex", gap: 22 }}>
          {series.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 30, fontWeight: 800, color: C.navy }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: SERIES_COLORS[i % 4] }} />
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// diagram:架构图 / 流程图。节点按先后分层自动排版，边逐条画出，并有小圆点沿边流动
// ---------------------------------------------------------------------------
export const DiagramEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const nodes = b.nodes ?? [];
  const edges = b.edges ?? [];
  const lr = (b.layout ?? "lr") === "lr";
  // 分层：层号 = 从起点出发的最长路径
  const level: Record<string, number> = {};
  nodes.forEach((n) => (level[n.id] = 0));
  for (let it = 0; it < nodes.length; it++) edges.forEach((e) => (level[e.to] = Math.max(level[e.to] ?? 0, (level[e.from] ?? 0) + 1)));
  const nLevels = Math.max(...Object.values(level), 0) + 1;
  const byLevel: string[][] = Array.from({ length: nLevels }, () => []);
  nodes.forEach((n) => byLevel[level[n.id]].push(n.id));
  const nw = Math.min(300, (lr ? box.w : box.h * 1.6) / (nLevels + 0.6));
  const nh = Math.min(170, nw * 0.62);
  const pos: Record<string, { x: number; y: number }> = {};
  byLevel.forEach((ids, li) => {
    ids.forEach((id, k) => {
      const along = (li + 0.5) / nLevels;
      const across = (k + 0.5) / ids.length;
      pos[id] = lr ? { x: along * box.w, y: across * box.h } : { x: across * box.w, y: along * box.h };
    });
  });
  const nodeAt = (id: string) => at(nodes.find((n) => n.id === id)?.at ?? b.at);
  return (
    <div style={{ width: box.w, height: box.h, position: "relative" }}>
      <svg width={box.w} height={box.h} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <marker id="arr" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={C.navy} />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos[e.from];
          const c = pos[e.to];
          if (!a || !c) return null;
          const start = Math.max(nodeAt(e.from), nodeAt(e.to), e.at ? at(e.at) : 0);
          const p = ramp(frame, start, 18);
          if (p <= 0) return null;
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const pad = lr ? nw / 2 + 6 : nh / 2 + 6;
          const padE = lr ? nw / 2 + 14 : nh / 2 + 14;
          const x1 = a.x + (Math.abs(ux) > Math.abs(uy) ? ux * pad : 0) + (Math.abs(ux) > Math.abs(uy) ? 0 : ux * 0);
          const y1 = a.y + (Math.abs(ux) > Math.abs(uy) ? 0 : uy * pad);
          const x2 = c.x - (Math.abs(ux) > Math.abs(uy) ? ux * padE : 0);
          const y2 = c.y - (Math.abs(ux) > Math.abs(uy) ? 0 : uy * padE);
          const cyc = ((frame - start) % 70) / 70;
          return (
            <g key={i} opacity={Math.min(1, p)}>
              <line x1={x1} y1={y1} x2={x1 + (x2 - x1) * p} y2={y1 + (y2 - y1) * p} stroke={C.navy} strokeWidth={6} strokeLinecap="round" markerEnd={p > 0.98 ? "url(#arr)" : undefined} />
              {p > 0.98 && <circle cx={x1 + (x2 - x1) * cyc} cy={y1 + (y2 - y1) * cyc} r={9} fill={C.pink} />}
              {e.label && (
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 16} textAnchor="middle" fontFamily={FONT} fontSize={30} fontWeight={800} fill={C.teal}>
                  {e.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {nodes.map((n) => {
        const p = pop(frame, nodeAt(n.id), 18);
        if (p <= 0 || !pos[n.id]) return null;
        const color = tone(n.tone);
        return (
          <div
            key={n.id}
            style={{
              position: "absolute",
              left: pos[n.id].x - nw / 2,
              top: pos[n.id].y - nh / 2,
              width: nw,
              height: nh,
              boxSizing: "border-box",
              borderRadius: 22,
              background: C.white,
              border: `5px solid ${color}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              transform: `scale(${Math.min(1.08, p)})`,
              opacity: Math.min(1, p),
              padding: "6px 10px",
              overflow: "hidden",
            }}
          >
            {n.sticker && <Sticker name={n.sticker} size={Math.min(nh * 0.5, 80)} />}
            <div style={{ fontSize: fitFont(n.label, nw - 24, nh > 120 ? 40 : 32, 20), fontWeight: 900, color: C.navy, textAlign: "center", lineHeight: 1.15 }}>{n.label}</div>
          </div>
        );
      })}
    </div>
  );
};
