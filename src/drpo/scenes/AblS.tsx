import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../theme";
import { Abs, Card, Chip, Heading, MATH, SceneTag, Sticker, useCue } from "../kit";

const RULES = [
  { n: "1", title: "边界要贴合真实偏移", sub: "也就是绝对概率变化", sticker: "straight-ruler", at: "a2" },
  { n: "2", title: "长尾词表下，权重必须有界", sub: "不能被小词放大", sticker: "balance-scale", at: "a3" },
  { n: "3", title: "越界后给平滑的纠正信号", sub: "而不是直接归零", sticker: "wrench", at: "a4" },
];

// 消融实验与三条设计准则
export const AblS: React.FC = () => {
  const { prog } = useCue();
  return (
    <AbsoluteFill>
      <SceneTag text="⑧ 消融：三条设计准则" />
      <Heading text="消融出的三条准则" p={prog("a1")} sticker="graduation-cap" />

      {RULES.map((r, i) => (
        <Abs key={r.n} x={70 + i * 600} y={200} p={prog(r.at)}>
          <Card w={570} h={330} border={C.teal}>
            <div style={{ position: "absolute", left: 24, top: 18 }}>
              <Chip text={`准则 ${r.n}`} bg={C.teal} size={32} />
            </div>
            <div style={{ position: "absolute", right: 24, top: 20 }}>
              <Sticker name={r.sticker} size={110} />
            </div>
            <div style={{ position: "absolute", left: 28, top: 150, width: 510, fontSize: 40, fontWeight: 900, color: C.navy, lineHeight: 1.3 }}>
              {r.title}
            </div>
            <div style={{ position: "absolute", left: 28, top: 255, fontSize: 30, fontWeight: 700, color: C.gray }}>{r.sub}</div>
          </Card>
        </Abs>
      ))}

      <Abs x={70} y={580} p={prog("a5")}>
        <Card w={880} h={260} border={C.orange}>
          <div style={{ position: "absolute", left: 28, top: 20, fontSize: 36, fontWeight: 900, color: C.orange }}>惩罚要乘上优势的绝对值</div>
          <div style={{ position: "absolute", left: 28, top: 85, fontSize: 56, fontWeight: 700, color: C.navy, fontFamily: MATH }}>|Â| / 2δ · μ · (r − 1)²</div>
          <div style={{ position: "absolute", left: 28, top: 175, display: "flex", alignItems: "center", gap: 16, opacity: prog("a6") }}>
            <Sticker name="chart-decreasing" size={64} />
            <div style={{ fontSize: 34, fontWeight: 900, color: C.pink }}>去掉它：性能下降，训练不稳</div>
          </div>
        </Card>
      </Abs>
      <Abs x={990} y={580} p={prog("a7")}>
        <Card w={860} h={260} border={C.pink}>
          <div style={{ position: "absolute", left: 28, top: 20, fontSize: 36, fontWeight: 900, color: C.pink }}>换成常见的惩罚呢？</div>
          <div style={{ position: "absolute", left: 28, top: 90, display: "flex", gap: 18 }}>
            <Chip text="KL 惩罚" bg={C.gray} size={36} />
            <Chip text="TV 惩罚" bg={C.gray} size={36} />
            <div style={{ fontSize: 50, fontWeight: 900, color: C.navy }}>＜</div>
            <Chip text="DRPO" bg={C.teal} size={36} />
          </div>
          <div style={{ position: "absolute", left: 28, top: 180, fontSize: 32, fontWeight: 800, color: C.navy }}>
            它们的梯度会重新带回「比例」的几何
          </div>
        </Card>
      </Abs>
    </AbsoluteFill>
  );
};
