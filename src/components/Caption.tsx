import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Cue } from "../script";
import { C, FONT } from "../theme";

// 底部居中的字幕条:深色半透明圆角框 + 白字,逐句淡入淡出
export const Caption: React.FC<{ cues: Cue[] }> = ({ cues }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cue = cues.find((c) => frame >= c.from * fps && frame < c.to * fps);
  if (!cue) return null;
  const f0 = cue.from * fps;
  const f1 = cue.to * fps;
  const fadeIn = interpolate(frame, [f0, f0 + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [f1 - 6, f1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 64,
        display: "flex",
        justifyContent: "center",
        opacity: Math.min(fadeIn, fadeOut),
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontSize: 48,
          fontWeight: 700,
          color: C.white,
          background: C.captionBg,
          padding: "14px 36px",
          borderRadius: 16,
          letterSpacing: 2,
        }}
      >
        {cue.text}
      </div>
    </div>
  );
};
