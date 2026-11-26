import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../theme";
import { Abs, Chip, Heading, MATH, SceneTag, useCue } from "../kit";

// 高亮某个符号
const Hi: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.pink }) => (
  <span style={{ color, background: "rgba(214,51,108,0.12)", borderRadius: 10, padding: "0 8px" }}>{children}</span>
);

const Arrow: React.FC<{ note?: string }> = ({ note }) => (
  <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", margin: "0 18px", verticalAlign: "middle" }}>
    <span style={{ fontSize: 28, fontWeight: 800, color: C.teal, lineHeight: 1 }}>{note ?? " "}</span>
    <span style={{ fontSize: 46, fontWeight: 900, color: C.teal, lineHeight: 1 }}>⟹</span>
  </span>
);

type StepProps = {
  y: number;
  n: string;
  title: string;
  color: string;
  p: number; // 卡片出现进度
  children: React.ReactNode; // 公式
  notes?: React.ReactNode; // 右侧注释
};

// 一步推导 = 一张卡片:左边标题和公式,右边结论
const Step: React.FC<StepProps> = ({ y, n, title, color, p, children, notes }) => (
  <Abs x={70} y={y} p={p} rise={26}>
    <div
      style={{
        width: 1780,
        height: 158,
        boxSizing: "border-box",
        borderRadius: 26,
        background: "rgba(255,255,255,0.9)",
        border: `5px solid ${color}`,
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", left: 22, top: 12, display: "flex", alignItems: "center", gap: 14 }}>
        <Chip text={n} bg={color} size={30} />
        <div style={{ fontSize: 36, fontWeight: 900, color: C.navy }}>{title}</div>
      </div>
      <div style={{ position: "absolute", left: 30, top: 62, fontSize: 52, fontWeight: 700, color: C.navy, fontFamily: MATH, whiteSpace: "nowrap" }}>
        {children}
      </div>
      <div style={{ position: "absolute", right: 24, top: 18, width: 760, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-end" }}>{notes}</div>
    </div>
  </Abs>
);

// 公式推导:四步,每步在对应旁白开始时出现
export const DeriveS: React.FC = () => {
  const { prog } = useCue();
  const fade = (id: string, delay = 0) => ({ opacity: prog(id, 14, delay) });

  return (
    <AbsoluteFill>
      <SceneTag text="⑥ 公式是怎么来的" />
      <Heading text="公式是怎么来的？" p={prog("v1")} sticker="memo" y={72} />

      {/* ① 把 DPPO 约束改写成比例界 */}
      <Step
        y={150}
        n="第 1 步"
        title="DPPO 的约束，改写成比例界"
        color={C.orange}
        p={prog("v2")}
        notes={
          <>
            <div style={fade("v5")}>
              <Chip text="μ 越小，δ/μ 越大：低概率词更宽松" bg={C.orange} size={30} />
            </div>
          </>
        }
      >
        <span>|π − μ| ≤ δ</span>
        <span style={fade("v3")}>
          <Arrow note="两边 ÷ μ" />
        </span>
        <span style={fade("v4")}>
          |r − 1| ≤ <Hi color={C.orange}>δ / μ</Hi>
        </span>
      </Step>

      {/* ② 借用 SPO:把比例界做成二次惩罚 */}
      <Step
        y={328}
        n="第 2 步"
        title="借用 SPO：把比例界做成二次惩罚"
        color={C.gray}
        p={prog("v6")}
        notes={
          <div style={fade("v7")}>
            <Chip text="∂/∂r = 0  ⟹  r* = 1 + sign(Â)·ε" bg={C.gray} size={30} />
            <div style={{ fontSize: 26, fontWeight: 800, color: C.navy, marginTop: 8, textAlign: "right" }}>最优点正好在边界上</div>
          </div>
        }
      >
        ℒ = r·Â − |Â| / 2<Hi color={C.gray}>ε</Hi> · (r − 1)²
      </Step>

      {/* ③ 把 ε 换成 δ/μ */}
      <Step
        y={506}
        n="第 3 步"
        title="把 ε 换成 δ / μ"
        color={C.teal}
        p={prog("v8")}
        notes={
          <>
            <div style={fade("v10")}>
              <Chip text="∂/∂r = 0  ⟹  π* = μ + sign(Â)·δ" bg={C.teal} size={30} />
            </div>
            <div style={fade("v11")}>
              <Chip text="✓ 和 DPPO 的边界一模一样" bg={C.pink} size={30} />
            </div>
          </>
        }
      >
        <span>ℒ = r·Â − |Â| / 2δ · </span>
        <span style={fade("v9")}>
          <Hi>μ</Hi>
        </span>
        <span> · (r − 1)²</span>
      </Step>

      {/* ④ 求梯度得到权重 */}
      <Step
        y={684}
        n="第 4 步"
        title="对参数求梯度"
        color={C.pink}
        p={prog("v12")}
        notes={
          <>
            <div style={fade("v12")}>
              <Chip text="μ·(r − 1) = π − μ，恰好是概率差" bg={C.navy} size={30} />
            </div>
            <div style={fade("v14")}>
              <Chip text="→ 会越界反向的弹簧权重" bg={C.pink} size={30} />
            </div>
          </>
        }
      >
        <span style={fade("v13")}>
          w = 1 − sign(Â·(r−1)) · D / δ
        </span>
      </Step>
    </AbsoluteFill>
  );
};
