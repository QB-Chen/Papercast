import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp } from "../anim";
import { C, FONT } from "../theme";

const CHIPS = [
  { text: "Query", color: C.tealLight, ink: C.navy },
  { text: "Key", color: C.navy, ink: C.white },
  { text: "Value", color: C.teal, ink: C.white },
];

// 结尾:预告下一讲
export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const title = ramp(frame, 4, 16);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: 100,
          fontWeight: 900,
          color: C.navy,
          opacity: title,
          transform: `translateY(${(1 - title) * 30}px)`,
          marginBottom: 70,
        }}
      >
        下一讲：注意力机制
      </div>
      <div style={{ display: "flex", gap: 40 }}>
        {CHIPS.map((c, i) => {
          const p = ramp(frame, 30 + i * 12, 14);
          return (
            <div
              key={c.text}
              style={{
                fontFamily: FONT,
                fontSize: 70,
                fontWeight: 900,
                padding: "16px 56px",
                borderRadius: 22,
                background: c.color,
                color: c.ink,
                border: `4px solid ${C.teal}`,
                opacity: p,
                transform: `scale(${0.8 + 0.2 * p})`,
              }}
            >
              {c.text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
