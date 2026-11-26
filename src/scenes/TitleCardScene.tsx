import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp } from "../anim";
import { C, FONT } from "../theme";

// 章节标题卡:纯文字,居中
export const TitleCardScene: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const p = ramp(frame, 4, 16);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: 130,
          fontWeight: 900,
          color: C.navy,
          opacity: p,
          transform: `translateY(${(1 - p) * 30}px)`,
          letterSpacing: 4,
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};
