import React from "react";
import { AbsoluteFill } from "remotion";
import { C, FONT, WATERMARK } from "../theme";

// 浅灰蓝底 + 向地平线收敛的透视网格 + 右上角水印
export const Background: React.FC = () => {
  const vpX = 960;
  const vpY = -500;
  const radial: React.ReactNode[] = [];
  for (let i = -12; i <= 12; i++) {
    const x = 960 + i * 220;
    radial.push(
      <line key={`r${i}`} x1={vpX} y1={vpY} x2={x} y2={1080} stroke={C.grid} strokeWidth={2} />,
    );
  }
  const horizontal: React.ReactNode[] = [];
  for (let j = 1; j <= 10; j++) {
    const y = 1080 * Math.pow(j / 10, 1.8);
    horizontal.push(<line key={`h${j}`} x1={0} y1={y} x2={1920} y2={y} stroke={C.grid} strokeWidth={2} />);
  }
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: 0.7 }}>
        {radial}
        {horizontal}
      </svg>
      <div
        style={{
          position: "absolute",
          right: 44,
          top: 28,
          fontFamily: FONT,
          fontSize: 30,
          fontWeight: 700,
          color: C.teal,
          opacity: 0.7,
        }}
      >
        {WATERMARK}
      </div>
    </AbsoluteFill>
  );
};
