import React from "react";
import { Easing, interpolate } from "remotion";
import { ramp } from "../anim";
import { C, FONT } from "../theme";
import { Leash, Spring, Sticker, useCue } from "../drpo/kit";
import { TONE, fitFont } from "./elements";
import type { Beat, DogPos } from "./types";

type Box = { w: number; h: number };

// ---------------------------------------------------------------------------
// leash:人牵着狗，狗在"信任区域"圈里/边界/圈外移动，绳子在松垂、绷直、弹簧、剪断之间切换
// ---------------------------------------------------------------------------
const DOG_X: Record<DogPos, number> = { inside: 0.62, edge: 0.95, outside: 1.5, far: 2.0 }; // 单位：圆半径，狗的中心离人的距离
const MOVE_FRAMES = 24;

export const LeashEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const moves = [...(b.moves ?? [])].map((m) => ({ ...m, f: at(m.at) })).sort((x, y) => x.f - y.f);
  if (!moves.length) return null;

  // 当前生效的 move，以及上一个（用来缓动）
  let k = -1;
  moves.forEach((m, i) => {
    if (frame >= m.f) k = i;
  });
  const cur = moves[Math.max(k, 0)];
  const prev = moves[Math.max(k - 1, 0)];
  const t = k <= 0 ? 1 : interpolate(frame, [cur.f, cur.f + MOVE_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const unit = DOG_X[prev.dog] + (DOG_X[cur.dog] - DOG_X[prev.dog]) * t;

  const R = Math.min(box.h * 0.4, 230);
  const cy = box.h * 0.42;
  const personX = box.w * 0.5 - R * 0.9; // 圆心略偏左，狗跑出去时整体仍大致居中
  const cx = personX;
  const dogCenterX = cx + unit * R;
  const dogSize = 170;
  const personSize = 190;
  const x1 = cx + personSize * 0.42;
  const x2 = dogCenterX - dogSize * 0.42;
  const len = Math.max(x2 - x1, 20);
  const outside = unit > 1.02;

  // 绷直时轻微抖动，表示狗在使劲
  const shake = cur.line === "taut" ? Math.sin(frame * 1.6) * 3 : 0;

  const lineColor = cur.line === "spring" ? (outside ? C.pink : C.teal) : C.orange;
  const mid = (x1 + x2) / 2;
  const showCircle = b.circleLabel !== "";

  return (
    <div style={{ width: box.w, height: box.h, position: "relative" }}>
      <svg width={box.w} height={box.h} style={{ position: "absolute", left: 0, top: 0 }}>
        {showCircle && <circle cx={cx} cy={cy} r={R} fill="rgba(214,51,108,0.07)" stroke={C.pink} strokeWidth={8} strokeDasharray="18 12" />}
        {cur.line === "slack" && <Leash x1={x1} y1={cy} x2={x2} y2={cy + 10} sag={Math.max(20, 90 - len * 0.12)} color={lineColor} />}
        {cur.line === "taut" && <line x1={x1} y1={cy} x2={x2 + shake} y2={cy + 8} stroke={lineColor} strokeWidth={9} strokeLinecap="round" />}
        {cur.line === "spring" && (
          <Spring x1={x1} y1={cy} x2={x2} y2={cy + 6} coils={Math.max(4, Math.round(len / 26))} amp={Math.min(22, 8 + len / 40)} color={lineColor} width={8} />
        )}
        {cur.line === "cut" && (
          <>
            <line x1={x1} y1={cy} x2={mid - 28} y2={cy + 4} stroke={C.orange} strokeWidth={8} strokeLinecap="round" />
            <line x1={mid + 28} y1={cy + 6} x2={x2} y2={cy + 8} stroke={C.orange} strokeWidth={8} strokeLinecap="round" strokeDasharray="2 18" />
          </>
        )}
      </svg>
      <div style={{ position: "absolute", left: cx - personSize / 2, top: cy - personSize / 2 }}>
        <Sticker name="person-walking" size={personSize} />
      </div>
      <div style={{ position: "absolute", left: dogCenterX - dogSize / 2 + shake, top: cy - dogSize / 2 + 8 }}>
        <Sticker name="dog-face" size={dogSize} />
      </div>
      {cur.line === "cut" && (
        <div style={{ position: "absolute", left: mid - 45, top: cy - 70 }}>
          <Sticker name="scissors" size={90} />
        </div>
      )}
      {showCircle && (
        <div style={{ position: "absolute", left: cx - R, width: R * 2, top: cy - R - 56, textAlign: "center", fontFamily: FONT, fontSize: 38, fontWeight: 900, color: C.pink }}>
          {b.circleLabel ?? "信任区域"}
        </div>
      )}
      {cur.label && (
        <div
          style={{
            position: "absolute",
            left: 0,
            width: box.w,
            top: cy + R + 20,
            textAlign: "center",
            fontFamily: FONT,
            fontSize: fitFont(cur.label, box.w - 120, 54, 30),
            fontWeight: 900,
            color: outside ? C.pink : C.navy,
          }}
        >
          {cur.label}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// grow:同一把尺子（0 ~ scale）下，几行数值从 from 变到 to。
// 比例和"实际多了多少"都由程序算出来，不让模型写，避免算错。
// ---------------------------------------------------------------------------
/** 去掉小数点后多余的 0，但只在确实有小数点时才去：50.00 → 50，0.10 → 0.1，100 → 100 */
const trim = (s: string): string => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
/** 保留合适的有效位数：>=10 取整，>=1 取一位，更小取两位 */
const fmt = (x: number): string => trim(Math.abs(x) >= 10 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(1) : x.toFixed(2));

const pct = (v: number): string => `${fmt(v * 100)}%`;
const times = (a: number, b: number): string => `×${trim((b / a >= 10 ? b / a : Math.round((b / a) * 10) / 10).toString())}`;
const pts = (d: number): string => `${d >= 0 ? "+" : "−"}${fmt(Math.abs(d) * 100)} 个百分点`;

export const GrowEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const rows = b.rows ?? [];
  const scale = b.scale && b.scale > 0 ? b.scale : 1;
  const start = at(b.animAt ?? b.at) + 6;
  const g = ramp(frame, start, 50); // 增长进度 0~1
  const badgeP = ramp(frame, start + 48, 14);

  const rowH = Math.min(230, Math.floor((box.h - 110) / Math.max(rows.length, 1)));
  const labelW = 380;
  const infoW = 600;
  const trackW = box.w - labelW - infoW - 40;
  const stSize = Math.min(170, rowH - 10);

  const yOff = Math.max(10, Math.floor((box.h - rows.length * (rowH + 8) - 50) / 2));

  return (
    <div style={{ width: box.w, height: box.h, position: "relative", fontFamily: FONT }}>
      {rows.map((r, i) => {
        const color = TONE[r.tone ?? (i === 0 ? "pink" : "orange")];
        const v = r.from + (r.to - r.from) * g;
        const fill = Math.max(4, (trackW * v) / scale);
        const top = yOff + i * (rowH + 8);
        return (
          <div key={i} style={{ position: "absolute", left: 0, top, width: box.w, height: rowH, display: "flex", alignItems: "center" }}>
            <div style={{ width: labelW, display: "flex", alignItems: "center", gap: 14 }}>
              {r.sticker && <Sticker name={r.sticker} size={stSize} />}
              <div style={{ fontSize: fitFont(r.label, labelW - stSize - 24, 56, 30), fontWeight: 900, color: C.navy }}>{r.label}</div>
            </div>
            <div style={{ width: trackW, height: rowH * 0.42, background: "#DDE7E8", borderRadius: 999, position: "relative", overflow: "hidden" }}>
              <div style={{ width: fill, height: "100%", background: color, borderRadius: 999 }} />
            </div>
            <div style={{ width: infoW, paddingLeft: 24 }}>
              <div style={{ fontSize: 56, fontWeight: 900, color: C.navy }}>
                {pct(r.from)} → <span style={{ color }}>{pct(r.from + (r.to - r.from) * g)}</span>
              </div>
              <div style={{ opacity: badgeP, display: "flex", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
                <span style={{ background: color, color: C.white, borderRadius: 999, padding: "2px 22px", fontSize: 40, fontWeight: 900 }}>比例 {times(r.from, r.to)}</span>
                <span style={{ background: C.navy, color: C.white, borderRadius: 999, padding: "2px 22px", fontSize: 40, fontWeight: 900 }}>{pts(r.to - r.from)}</span>
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: labelW, top: yOff + 8 + rows.length * (rowH + 8), width: trackW, display: "flex", justifyContent: "space-between", fontSize: 34, fontWeight: 800, color: C.gray }}>
        <span>0</span>
        <span>满格 = {pct(scale)}（同一把尺子）</span>
      </div>
    </div>
  );
};
