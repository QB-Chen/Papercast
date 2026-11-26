import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { C, FONT } from "../../theme";
import { Abs, Chip, Leash, SceneTag, Sticker, useCue } from "../kit";

// 开场:遛狗要牵引绳 → 大模型 RL 也要 → 点出论文
export const HookS: React.FC = () => {
  const { frame, at, prog } = useCue();
  const fadeOut = 1 - prog("h4", 12);
  const dash = interpolate(frame, [at("h1"), at("h1") + 36], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  // 狗往右冲,被绳子拉住后轻微回弹
  const dogX = 520 + dash * 330 - Math.max(0, prog("h2", 10)) * 40 + Math.sin(frame / 5) * prog("h2", 10) * 4;
  const personX = 230;
  const robotP = prog("h3");

  return (
    <AbsoluteFill>
      <SceneTag text="开场" />
      <div style={{ opacity: fadeOut }}>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <Leash x1={personX + 150} y1={520} x2={dogX + 40} y2={540} sag={prog("h2") > 0.3 ? 30 : 6} opacity={prog("h2", 8)} />
          {robotP > 0 && (
            <Leash x1={1180} y1={520} x2={1330} y2={540} sag={30} opacity={robotP} />
          )}
        </svg>
        <Abs x={personX} y={430} p={prog("h2", 10)} center={false}>
          <Sticker name="man-walking" size={260} />
        </Abs>
        <Abs x={dogX} y={400} p={prog("h1", 8)} rise={0}>
          <Sticker name="dog-face" size={280} />
        </Abs>
        <Abs x={dogX + 60} y={300} p={prog("h1", 8)} rise={0}>
          <Chip text="冲！" bg={C.orange} size={44} />
        </Abs>
        <Abs x={personX + 20} y={720} p={prog("h2")}>
          <Chip text="牵引绳" bg={C.teal} size={42} />
        </Abs>
        <Abs x={1330} y={380} p={robotP} rise={0}>
          <Sticker name="robot" size={300} />
        </Abs>
        <Abs x={1480} y={720} p={robotP} center>
          <Chip text="大模型强化学习" bg={C.navy} size={42} />
        </Abs>
      </div>

      <Abs x={960} y={380} p={prog("h4", 16)} center>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 190, fontWeight: 900, color: C.navy, letterSpacing: 10, lineHeight: 1.05 }}>DRPO</div>
          <div style={{ fontSize: 64, fontWeight: 900, color: C.teal, marginTop: 10 }}>给信任区域换个新设计</div>
        </div>
      </Abs>
      <Abs x={960} y={700} p={prog("h4", 16, 8)} center>
        <div style={{ textAlign: "center", fontFamily: FONT, color: C.navy }}>
          <div style={{ fontSize: 40, fontWeight: 800 }}>Rethinking the Divergence Regularization in LLM RL</div>
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 12, color: C.gray }}>Tencent Hunyuan · arXiv:2606.09821</div>
        </div>
      </Abs>
    </AbsoluteFill>
  );
};
