import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../theme";
import { Abs, Card, Chip, Heading, MATH, SceneTag, Sticker, useCue } from "../kit";

const Pink: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: C.pink, background: "rgba(214,51,108,0.12)", borderRadius: 10, padding: "0 8px" }}>{children}</span>
);

// 为什么不直接用 SPO:有没有乘旧概率 μ
export const SpoS: React.FC = () => {
  const { prog } = useCue();

  // 权重随 μ 变化的小图(x: μ 从 0.05 到 1;SPO 近似 1/μ,DRPO 有界)
  const W = { x: 120, y: 520, w: 820, h: 330 };
  const mx = (m: number) => W.x + ((m - 0.04) / 0.96) * W.w;
  const wy = (v: number) => W.y + W.h - Math.min(v, 6) / 6 * W.h;
  const spo: string[] = [];
  for (let m = 0.18; m <= 1.0001; m += 0.02) spo.push(`${spo.length ? "L" : "M"} ${mx(m)} ${wy(1 / m)}`);
  const drpo = `M ${mx(0.04)} ${wy(1)} L ${mx(1)} ${wy(1)}`;

  return (
    <AbsoluteFill>
      <SceneTag text="⑤ 为什么不用 SPO" />
      <Heading text="为什么不直接用 SPO？" p={prog("s1")} sticker="thinking-face" />

      <Abs x={110} y={190} p={prog("s2")}>
        <Card w={830} h={220} border={C.gray}>
          <div style={{ position: "absolute", left: 28, top: 20, fontSize: 38, fontWeight: 900, color: C.gray }}>SPO</div>
          <div style={{ position: "absolute", left: 28, top: 90, fontSize: 52, fontWeight: 700, color: C.navy, fontFamily: MATH, whiteSpace: "nowrap" }}>
            |Â| / 2ε · (r − 1)²
          </div>
          <div style={{ position: "absolute", left: 28, top: 160, fontSize: 30, fontWeight: 800, color: C.pink, opacity: prog("s3") }}>
            等价于：(π − μ)² <Pink>÷ μ</Pink>
          </div>
        </Card>
      </Abs>
      <Abs x={980} y={190} p={prog("s2", 14, 8)}>
        <Card w={830} h={220} border={C.teal}>
          <div style={{ position: "absolute", left: 28, top: 20, fontSize: 38, fontWeight: 900, color: C.teal }}>DRPO</div>
          <div style={{ position: "absolute", left: 28, top: 90, fontSize: 52, fontWeight: 700, color: C.navy, fontFamily: MATH, whiteSpace: "nowrap" }}>
            |Â| / 2δ · <Pink>μ</Pink> · (r − 1)²
          </div>
          <div style={{ position: "absolute", left: 28, top: 160, fontSize: 30, fontWeight: 800, color: C.teal, opacity: prog("s6") }}>
            等价于：(π − μ)² ，纯绝对概率差
          </div>
        </Card>
      </Abs>

      {/* 下左:权重曲线 */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <g opacity={prog("s4")}>
          <line x1={W.x} y1={W.y + W.h} x2={W.x + W.w + 20} y2={W.y + W.h} stroke={C.navy} strokeWidth={5} strokeLinecap="round" />
          <line x1={W.x} y1={W.y - 20} x2={W.x} y2={W.y + W.h} stroke={C.navy} strokeWidth={5} strokeLinecap="round" />
          <text x={W.x + W.w} y={W.y + W.h + 44} textAnchor="end" fontSize={32} fontWeight={800} fill={C.navy} fontFamily={MATH}>
            旧概率 μ →
          </text>
          <text x={W.x + 14} y={W.y - 28} fontSize={32} fontWeight={800} fill={C.navy}>
            梯度权重
          </text>
        </g>
        <path d={spo.join(" ")} fill="none" stroke={C.pink} strokeWidth={9} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - prog("s4", 40)} />
        <path d={drpo} fill="none" stroke={C.teal} strokeWidth={9} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - prog("s7", 30)} />
      </svg>
      <Abs x={W.x + 150} y={W.y - 6} p={prog("s4")}>
        <Chip text="SPO：μ→0 时趋向 ∞" bg={C.pink} size={28} />
      </Abs>
      <Abs x={W.x + 30} y={wy(1) + 12} p={prog("s7")}>
        <Chip text="DRPO：始终有界" bg={C.teal} size={26} />
      </Abs>

      {/* 下右:被勒住的小词 vs 有分寸 */}
      <Abs x={1010} y={470} p={prog("s5")}>
        <Card w={800} h={250} border={C.pink}>
          <div style={{ position: "absolute", left: 28, top: 30, display: "flex", alignItems: "center", gap: 24 }}>
            <Sticker name="ant" size={90} />
            <div style={{ fontSize: 100, color: C.orange, fontWeight: 900, letterSpacing: -6 }}>⟶</div>
            <Sticker name="face-with-spiral-eyes" size={100} />
          </div>
          <div style={{ position: "absolute", left: 28, bottom: 24, fontSize: 36, fontWeight: 900, color: C.pink }}>SPO：绳子越拉越紧，勒住小词</div>
        </Card>
      </Abs>
      <Abs x={1010} y={745} p={prog("s8")}>
        <Card w={800} h={150} border={C.teal}>
          <div style={{ position: "absolute", left: 28, top: 28, display: "flex", alignItems: "center", gap: 20 }}>
            <Sticker name="check-mark-button" size={80} />
            <div style={{ fontSize: 36, fontWeight: 900, color: C.teal }}>
              DRPO：概率差最大不过 1，<br />怎么拉都有分寸
            </div>
          </div>
        </Card>
      </Abs>
    </AbsoluteFill>
  );
};
