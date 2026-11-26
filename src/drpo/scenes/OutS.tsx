import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../theme";
import { Abs, Chip, Heading, SceneTag, Spring, Sticker, useCue } from "../kit";

// 收尾:一句话总结 + 论文信息
export const OutS: React.FC = () => {
  const { prog } = useCue();
  return (
    <AbsoluteFill>
      <SceneTag text="总结" />
      <Heading text="一句话总结" p={prog("o1")} sticker="light-bulb" />

      <Abs x={960} y={290} p={prog("o1")} center>
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <div style={{ textAlign: "center" }}>
            <Sticker name="scissors" size={150} />
            <div style={{ fontSize: 40, fontWeight: 900, color: C.orange }}>硬掩码</div>
          </div>
          <div style={{ fontSize: 100, fontWeight: 900, color: C.navy }}>→</div>
          <div style={{ textAlign: "center" }}>
            <svg width={300} height={150}>
              <Spring x1={10} y1={75} x2={290} y2={75} coils={7} amp={26} color={C.teal} width={10} />
            </svg>
            <div style={{ fontSize: 40, fontWeight: 900, color: C.teal }}>平滑弹簧</div>
          </div>
        </div>
      </Abs>

      <Abs x={960} y={505} p={prog("o2")} center>
        <div style={{ display: "flex", gap: 22 }}>
          <Chip text="边界不变" bg={C.navy} size={40} />
          <Chip text="梯度连续" bg={C.teal} size={40} />
          <Chip text="越界能被拉回" bg={C.pink} size={40} />
        </div>
      </Abs>

      <Abs x={330} y={710} p={prog("o3")} center>
        <Sticker name="dog-face" size={190} />
      </Abs>
      <Abs x={520} y={710} p={prog("o3", 14, 8)} center>
        <Sticker name="waving-hand" size={110} />
      </Abs>

      <Abs x={1180} y={715} p={prog("o4")} center>
        <div
          style={{
            background: "rgba(255,255,255,0.9)",
            border: `5px solid ${C.navy}`,
            borderRadius: 28,
            padding: "26px 40px",
            width: 1000,
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 900, color: C.navy }}>Rethinking the Divergence Regularization in LLM RL</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: C.gray, marginTop: 8 }}>arXiv:2606.09821 · Tencent Hunyuan</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.teal, marginTop: 12 }}>github.com/Tencent-Hunyuan/UniRL/tree/main/DRPO</div>
        </div>
      </Abs>
    </AbsoluteFill>
  );
};
