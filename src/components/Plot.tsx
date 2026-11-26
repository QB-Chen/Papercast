import React from "react";
import { C, FONT } from "../theme";

// 二维语义坐标系的几何与公共元素。坐标范围 x,y ∈ [0,1]
export const PLOT = { x0: 300, y0: 800, w: 1200, h: 640 };

export const toPx = (x: number, y: number) => ({
  px: PLOT.x0 + x * PLOT.w,
  py: PLOT.y0 - y * PLOT.h,
});

type PlotProps = {
  axis?: number; // 坐标轴绘制进度 0~1
  xLabel?: number; // 横轴标签透明度
  yLabel?: number; // 纵轴标签透明度
  children?: React.ReactNode;
};

export const Plot: React.FC<PlotProps> = ({ axis = 1, xLabel = 1, yLabel = 1, children }) => {
  const xEnd = PLOT.x0 + (PLOT.w + 240) * axis;
  const yEnd = PLOT.y0 - (PLOT.h + 60) * axis;
  const done = axis > 0.98;
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      <line x1={PLOT.x0} y1={PLOT.y0} x2={xEnd} y2={PLOT.y0} stroke={C.teal} strokeWidth={5} strokeLinecap="round" />
      <line x1={PLOT.x0} y1={PLOT.y0} x2={PLOT.x0} y2={yEnd} stroke={C.teal} strokeWidth={5} strokeLinecap="round" />
      {done && (
        <>
          <polygon
            points={`${xEnd + 14},${PLOT.y0} ${xEnd - 8},${PLOT.y0 - 12} ${xEnd - 8},${PLOT.y0 + 12}`}
            fill={C.teal}
          />
          <polygon
            points={`${PLOT.x0},${yEnd - 14} ${PLOT.x0 - 12},${yEnd + 8} ${PLOT.x0 + 12},${yEnd + 8}`}
            fill={C.teal}
          />
        </>
      )}
      <text
        x={PLOT.x0 + PLOT.w + 240}
        y={PLOT.y0 + 62}
        textAnchor="end"
        fontFamily={FONT}
        fontSize={38}
        fontWeight={700}
        fill={C.navy}
        opacity={xLabel}
      >
        横轴 · 是否跟金钱相关
      </text>
      <text
        x={PLOT.x0 + 28}
        y={PLOT.y0 - PLOT.h - 40}
        textAnchor="start"
        fontFamily={FONT}
        fontSize={38}
        fontWeight={700}
        fill={C.navy}
        opacity={yLabel}
      >
        纵轴 · 是否表示「可以」
      </text>
      {children}
    </svg>
  );
};

// 坐标系里的一个词
export const Dot: React.FC<{
  x: number;
  y: number;
  label: string;
  color: string;
  op?: number;
  r?: number;
  labelDx?: number;
}> = ({ x, y, label, color, op = 1, r = 15, labelDx = 28 }) => {
  const { px, py } = toPx(x, y);
  return (
    <g opacity={op}>
      <circle cx={px} cy={py} r={r} fill={color} />
      <text x={px + labelDx} y={py + 13} fontFamily={FONT} fontSize={40} fontWeight={700} fill={color}>
        {label}
      </text>
    </g>
  );
};

// 两组词的聚类坐标,供多个场景共用
export const MONEY_WORDS = [
  { x: 0.84, y: 0.12, label: "银行" },
  { x: 0.64, y: 0.22, label: "存款" },
  { x: 0.9, y: 0.3, label: "利息" },
];
export const OK_WORDS = [
  { x: 0.1, y: 0.86, label: "可以" },
  { x: 0.2, y: 0.66, label: "没问题" },
  { x: 0.32, y: 0.8, label: "靠谱" },
];
