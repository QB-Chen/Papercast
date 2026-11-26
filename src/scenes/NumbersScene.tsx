import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp, sec } from "../anim";
import { C, FONT, MONO } from "../theme";

const CHARS = [
  { ch: "银", code: "94F6" },
  { ch: "行", code: "884C" },
  { ch: "行", code: "884C" },
  { ch: "不", code: "4E0D" },
  { ch: "行", code: "884C" },
];

// 字 → Unicode 编号:三个「行」得到同一个编号,说明编号不带语义
export const NumbersScene: React.FC = () => {
  const frame = useCurrentFrame();
  const warn = ramp(frame, sec(11), 12);
  const note = ramp(frame, sec(15), 14);
  const pulse = 0.6 + 0.4 * Math.sin(frame / 5);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", top: 200, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 36 }}>
        {CHARS.map((it, i) => {
          const charOp = ramp(frame, 4 + i * 5, 12);
          const codeOp = ramp(frame, sec(5) + i * 14, 12);
          const isXing = it.ch === "行";
          const hot = isXing && warn > 0;
          return (
            <div key={i} style={{ width: 230, textAlign: "center", fontFamily: FONT }}>
              <div style={{ fontSize: 200, fontWeight: 900, color: C.navy, opacity: charOp, lineHeight: 1.1 }}>{it.ch}</div>
              <div style={{ fontSize: 56, color: C.teal, opacity: codeOp, lineHeight: 1.2 }}>↓</div>
              <div
                style={{
                  margin: "6px auto 0",
                  width: 200,
                  padding: "12px 0",
                  borderRadius: 16,
                  fontFamily: MONO,
                  fontSize: 50,
                  fontWeight: 700,
                  background: hot ? C.pink : C.white,
                  color: hot ? C.white : C.navy,
                  border: `4px solid ${hot ? C.pink : C.teal}`,
                  opacity: codeOp,
                  boxShadow: hot ? `0 0 ${24 * pulse}px ${C.pink}` : "none",
                }}
              >
                U+{it.code}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          top: 700,
          width: "100%",
          textAlign: "center",
          fontFamily: FONT,
          fontSize: 54,
          fontWeight: 900,
          color: C.pink,
          opacity: warn,
        }}
      >
        三个「行」，编号完全一样
      </div>
      <div
        style={{
          position: "absolute",
          top: 790,
          width: "100%",
          textAlign: "center",
          fontFamily: FONT,
          fontSize: 50,
          fontWeight: 700,
          color: C.navy,
          opacity: note,
        }}
      >
        编号 ≠ 含义
      </div>
    </AbsoluteFill>
  );
};
