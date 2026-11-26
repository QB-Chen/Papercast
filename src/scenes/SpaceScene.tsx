import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp, sec } from "../anim";
import { C } from "../theme";
import { Dot, MONEY_WORDS, OK_WORDS, Plot, toPx } from "../components/Plot";

// 画出坐标轴,再把两组意思相近的词依次放进去
export const SpaceScene: React.FC = () => {
  const frame = useCurrentFrame();
  const axis = ramp(frame, 6, sec(4));
  const xLabel = ramp(frame, sec(5), 14);
  const yLabel = ramp(frame, sec(10), 14);
  const ring = ramp(frame, sec(25), 20);

  const money = toPx(0.8, 0.2);
  const ok = toPx(0.22, 0.77);

  return (
    <AbsoluteFill>
      <Plot axis={axis} xLabel={xLabel} yLabel={yLabel}>
        {MONEY_WORDS.map((w, i) => (
          <Dot key={w.label} x={w.x} y={w.y} label={w.label} color={C.teal} op={ramp(frame, sec(15) + i * 14, 12)} />
        ))}
        {OK_WORDS.map((w, i) => (
          <Dot key={w.label} x={w.x} y={w.y} label={w.label} color={C.orange} op={ramp(frame, sec(20) + i * 14, 12)} />
        ))}
        <ellipse
          cx={money.px}
          cy={money.py}
          rx={250 * ring}
          ry={110 * ring}
          fill="none"
          stroke={C.teal}
          strokeWidth={4}
          strokeDasharray="14 10"
          opacity={ring}
        />
        <ellipse
          cx={ok.px}
          cy={ok.py}
          rx={300 * ring}
          ry={130 * ring}
          fill="none"
          stroke={C.orange}
          strokeWidth={4}
          strokeDasharray="14 10"
          opacity={ring}
        />
      </Plot>
    </AbsoluteFill>
  );
};
