import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../theme";
import { Abs, Chip, ChartFrame, Curve, Heading, Leash, MATH, SceneTag, Sticker, cx, cy, useCue } from "../kit";

// DPPO:绝对概率变化 + 硬掩码
export const DppoS: React.FC = () => {
  const { prog } = useCue();
  const early = 1 - prog("d5", 12); // 前半段:新尺子
  const late = prog("d5", 14); // 后半段:硬掩码图

  // 尺子:0 ~ 0.2 的绝对概率变化
  const RULER = { x: 260, y: 520, w: 1400, max: 0.2 };
  const rx = (v: number) => RULER.x + (v / RULER.max) * RULER.w;
  const deltaX = rx(0.15);

  // d6~d7:硬掩码曲线,梯度权重在 δ 处从 1 掉到 0
  const stepPts: [number, number][] = [
    [0, 1],
    [1, 1],
    [1, 0],
    [1.6, 0],
  ];
  const cut = prog("d7", 14);
  // 右侧小图:人站在圈心,狗跑到圈外,绳子在 d7 被剪断
  const OX = 1560;
  const OY = 400;
  const DOG_X = OX + 250;
  const DOG_Y = OY + 20;

  return (
    <AbsoluteFill>
      <SceneTag text="③ DPPO：换一把尺" />
      <Heading text="DPPO：换一把尺" p={prog("d1")} sticker="straight-ruler" />

      <div style={{ opacity: early }}>
        <Abs x={960} y={290} p={prog("d2")} center>
          <div style={{ fontSize: 88, fontWeight: 700, color: C.navy, fontFamily: MATH }}>|π(y) − μ(y)| ≤ δ</div>
        </Abs>
        <Abs x={960} y={385} p={prog("d2")} center>
          <Chip text="直接量：绝对概率变了多少" bg={C.teal} size={38} />
        </Abs>

        {/* 尺子 */}
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: prog("d3") }}>
          <line x1={RULER.x} y1={RULER.y} x2={RULER.x + RULER.w} y2={RULER.y} stroke={C.navy} strokeWidth={8} strokeLinecap="round" />
          {[0, 0.05, 0.1, 0.15, 0.2].map((v) => (
            <g key={v}>
              <line x1={rx(v)} y1={RULER.y - 16} x2={rx(v)} y2={RULER.y + 16} stroke={C.navy} strokeWidth={5} />
              <text x={rx(v)} y={RULER.y + 64} textAnchor="middle" fontSize={34} fontWeight={700} fill={C.navy} fontFamily={MATH}>
                {v}
              </text>
            </g>
          ))}
          <line x1={deltaX} y1={RULER.y - 120} x2={deltaX} y2={RULER.y + 16} stroke={C.pink} strokeWidth={6} strokeDasharray="12 10" opacity={prog("d4")} />
        </svg>
        <Abs x={rx(0.001) - 40} y={RULER.y - 150} p={prog("d3")}>
          <div style={{ textAlign: "center" }}>
            <Sticker name="ant" size={80} />
            <div style={{ fontSize: 32, fontWeight: 800, color: C.navy }}>+0.001</div>
          </div>
        </Abs>
        <Abs x={rx(0.1) - 60} y={RULER.y - 220} p={prog("d3", 14, 10)}>
          <div style={{ textAlign: "center" }}>
            <Sticker name="elephant" size={150} />
            <div style={{ fontSize: 32, fontWeight: 800, color: C.navy }}>+0.10</div>
          </div>
        </Abs>
        <Abs x={960} y={700} p={prog("d3")} center>
          <div style={{ fontSize: 40, fontWeight: 800, color: C.teal }}>蚂蚁和大象，用同一把尺</div>
        </Abs>
        <Abs x={deltaX} y={RULER.y - 205} p={prog("d4")} center>
          <Chip text="δ = 0.15（论文推荐值）" bg={C.pink} size={32} />
        </Abs>
        <Abs x={deltaX + 140} y={RULER.y + 105} p={prog("d4")} center>
          <div style={{ fontSize: 36, fontWeight: 900, color: C.pink }}>超过就算越界 →</div>
        </Abs>
      </div>

      {/* 后半段:硬掩码 */}
      <ChartFrame p={late}>
        <Curve pts={stepPts} color={C.orange} p={prog("d6", 40)} width={10} />
        <g opacity={prog("d8", 14)}>
          <circle cx={cx(1)} cy={cy(0.5)} r={62} fill="none" stroke={C.pink} strokeWidth={6} />
        </g>
      </ChartFrame>
      <Abs x={cx(0.45)} y={cy(1) - 78} p={late} center>
        <Chip text="硬掩码：权重 1 或 0" bg={C.orange} size={34} />
      </Abs>
      <Abs x={cx(1.3)} y={cy(0) - 100} p={prog("d6")} center>
        <div style={{ fontSize: 34, fontWeight: 900, color: C.orange }}>梯度 = 0</div>
      </Abs>
      <Abs x={cx(1) + 90} y={cy(0.5) - 150} p={prog("d8")}>
        <Chip text="上一秒全力 → 下一秒归零" bg={C.pink} size={32} />
      </Abs>

      {/* 右侧:人在圈心,狗在圈外,绳子被剪断 */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: late }}>
        <circle cx={OX} cy={OY} r={150} fill="rgba(214,51,108,0.06)" stroke={C.pink} strokeWidth={8} strokeDasharray="16 12" />
        <Leash x1={OX + 40} y1={OY + 10} x2={DOG_X - 50} y2={DOG_Y} sag={26} broken={cut > 0.5} color={C.orange} />
      </svg>
      <Abs x={OX} y={OY} p={late} center>
        <Sticker name="man-walking" size={120} />
      </Abs>
      <Abs x={DOG_X} y={DOG_Y} p={prog("d5")} center rise={0}>
        <Sticker name="dog-face" size={130} />
      </Abs>
      <Abs x={OX + 100} y={OY + 12} p={cut} center>
        <Sticker name="scissors" size={84} style={{ transform: `rotate(${(1 - cut) * -50}deg)` }} />
      </Abs>
      <Abs x={OX + 70} y={OY + 230} p={prog("d7")} center>
        <div style={{ fontSize: 34, fontWeight: 800, color: C.navy, textAlign: "center", whiteSpace: "nowrap" }}>
          跑出圈了<br />你只是撒手不管
        </div>
      </Abs>
    </AbsoluteFill>
  );
};
