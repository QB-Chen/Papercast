import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp, sec } from "../anim";
import { C, FONT } from "../theme";
import { Dot, MONEY_WORDS, OK_WORDS, Plot, toPx } from "../components/Plot";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 多义字「行」单独时停在中间,结合上下文后被拉向不同的语义区域
export const PullScene: React.FC = () => {
  const frame = useCurrentFrame();
  const center = toPx(0.5, 0.46);
  const bank = toPx(0.78, 0.17);
  const ok = toPx(0.18, 0.74);

  const t1 = ramp(frame, sec(5), 70);
  const t2 = ramp(frame, sec(10), 70);
  const blink = 0.55 + 0.45 * Math.sin(frame / 6);

  // dy 是标签顶边相对圆点的纵向偏移:负数在点上方,正数在点下方
  const chip = (px: number, py: number, text: string, color: string, op: number, dy = -118) => (
    <g opacity={op}>
      <rect x={px - 110} y={py + dy} width={220} height={58} rx={16} fill={color} />
      <text x={px} y={py + dy + 41} textAnchor="middle" fontFamily={FONT} fontSize={34} fontWeight={700} fill={C.white}>
        {text}
      </text>
    </g>
  );

  return (
    <AbsoluteFill>
      <Plot>
        {MONEY_WORDS.map((w) => (
          <Dot key={w.label} x={w.x} y={w.y} label={w.label} color={C.teal} op={0.4} />
        ))}
        {OK_WORDS.map((w) => (
          <Dot key={w.label} x={w.x} y={w.y} label={w.label} color={C.orange} op={0.4} />
        ))}

        {/* 单独的「行」:中间的灰色虚线圈 */}
        <circle cx={center.px} cy={center.py} r={26} fill="none" stroke={C.gray} strokeWidth={4} strokeDasharray="8 6" />
        <text x={center.px} y={center.py + 76} textAnchor="middle" fontFamily={FONT} fontSize={36} fontWeight={700} fill={C.gray}>
          单独的「行」
        </text>
        {t1 === 0 && <circle cx={center.px} cy={center.py} r={14} fill={C.gray} opacity={blink} />}

        {/* 第一个「行」:被「银」拉向银行 */}
        {t1 > 0 && (
          <>
            <circle cx={lerp(center.px, bank.px, t1)} cy={lerp(center.py, bank.py, t1)} r={17} fill={C.teal} />
            <line
              x1={center.px}
              y1={center.py}
              x2={lerp(center.px, bank.px, t1)}
              y2={lerp(center.py, bank.py, t1)}
              stroke={C.teal}
              strokeWidth={4}
              strokeDasharray="10 8"
              opacity={0.7}
            />
            {chip(lerp(center.px, bank.px, t1), lerp(center.py, bank.py, t1), "前面是「银」", C.teal, ramp(frame, sec(5), 10))}
          </>
        )}

        {/* 后面的「行」:被「不」拉向「可以」 */}
        {t2 > 0 && (
          <>
            <circle cx={lerp(center.px, ok.px, t2)} cy={lerp(center.py, ok.py, t2)} r={17} fill={C.orange} />
            <line
              x1={center.px}
              y1={center.py}
              x2={lerp(center.px, ok.px, t2)}
              y2={lerp(center.py, ok.py, t2)}
              stroke={C.orange}
              strokeWidth={4}
              strokeDasharray="10 8"
              opacity={0.7}
            />
            {chip(lerp(center.px, ok.px, t2), lerp(center.py, ok.py, t2), "后面是「不」", C.orange, ramp(frame, sec(10), 10), 95)}
          </>
        )}
      </Plot>
    </AbsoluteFill>
  );
};
