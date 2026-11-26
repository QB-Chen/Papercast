import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp, sec } from "../anim";
import { C, FONT, MONO } from "../theme";

const VALUES = ["0.85", "0.12", "0.47", "-0.33", "0.61", "0.05", "-0.22", "0.90"];
const CELL_W = 130;
const GAP = 8;

// 坐标 → 一组数字 → 向量;再扩展到高维
export const VectorScene: React.FC = () => {
  const frame = useCurrentFrame();
  const wordOp = ramp(frame, 4, 14);
  const cellsOp = ramp(frame, 24, 14);
  const nameOp = ramp(frame, sec(4), 14);
  const more = ramp(frame, sec(8), 20);
  const finale = ramp(frame, sec(9), 16);

  const shown = 2 + Math.round(6 * more);
  const rowW = shown * CELL_W + (shown - 1) * GAP;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 260,
          left: 150,
          width: 300,
          textAlign: "center",
          opacity: wordOp,
          fontFamily: FONT,
        }}
      >
        <div
          style={{
            display: "inline-block",
            padding: "20px 50px",
            borderRadius: 24,
            background: C.teal,
            color: C.white,
            fontSize: 100,
            fontWeight: 900,
          }}
        >
          银行
        </div>
      </div>
      <div style={{ position: "absolute", top: 290, left: 480, fontSize: 90, color: C.teal, opacity: cellsOp, fontFamily: FONT }}>→</div>
      <div
        style={{
          position: "absolute",
          top: 270,
          left: 640,
          display: "flex",
          gap: GAP,
          opacity: cellsOp,
          width: rowW,
        }}
      >
        {VALUES.slice(0, shown).map((v, i) => (
          <div
            key={i}
            style={{
              width: CELL_W,
              height: 110,
              borderRadius: 14,
              background: C.tealLight,
              border: `4px solid ${C.teal}`,
              color: C.navy,
              fontFamily: MONO,
              fontSize: 36,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {v}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          top: 430,
          left: 640,
          fontFamily: FONT,
          fontSize: 50,
          fontWeight: 900,
          color: C.navy,
          opacity: nameOp,
        }}
      >
        向量（embedding）
      </div>
      <div
        style={{
          position: "absolute",
          top: 640,
          width: "100%",
          textAlign: "center",
          fontFamily: FONT,
          fontSize: 62,
          fontWeight: 900,
          color: C.pink,
          opacity: finale,
        }}
      >
        真实模型：成百上千个维度
      </div>
    </AbsoluteFill>
  );
};
