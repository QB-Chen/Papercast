import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp, sec } from "../anim";
import { C, FONT } from "../theme";

const CHARS = ["银", "行", "行", "不", "行"];

// 开场钩子:5 个字逐个出现,最后抛出问号
export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const q = ramp(frame, sec(6), 14);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 170,
          width: "100%",
          textAlign: "center",
          fontFamily: FONT,
          fontSize: 44,
          fontWeight: 700,
          color: C.teal,
          opacity: ramp(frame, 0, 15),
        }}
      >
        Transformer 从零讲起 · 第 1 讲
      </div>
      <div
        style={{
          position: "absolute",
          top: 320,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          gap: 40,
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: 250,
        }}
      >
        {CHARS.map((ch, i) => {
          const p = ramp(frame, 12 + i * 9, 14);
          return (
            <span key={i} style={{ color: C.navy, opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>
              {ch}
            </span>
          );
        })}
        <span style={{ color: C.pink, opacity: q, transform: `scale(${0.6 + 0.4 * q})` }}>?</span>
      </div>
    </AbsoluteFill>
  );
};
