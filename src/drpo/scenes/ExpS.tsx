import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../theme";
import { Abs, Card, Chip, Heading, MATH, SceneTag, Sticker, useCue } from "../kit";

const MODELS: { name: string; note: string; sticker: string; at: "e2" | "e3" }[] = [
  { name: "Qwen3-4B-Base", note: "稠密 · 40 亿", sticker: "robot", at: "e2" },
  { name: "Qwen3-30B-A3B-Base", note: "MoE · 300 亿", sticker: "robot", at: "e2" },
  { name: "Qwen3.5-35B-A3B-Base", note: "MoE · 350 亿", sticker: "robot", at: "e2" },
  { name: "R1-Distill-Qwen-1.5B", note: "DeepSeek 蒸馏 · 15 亿", sticker: "robot", at: "e3" },
];

type Row = { label: string; sub: string; verdict: string; icon: string; color: string; at: string; extra?: string };

const ROWS: Row[] = [
  { label: "GRPO · SPO", sub: "基于比例", verdict: "训练不稳，低精度下常崩", icon: "cross-mark", color: C.pink, at: "e6" },
  { label: "DPPO", sub: "硬掩码", verdict: "能稳住，但收敛慢、终点低", icon: "warning", color: C.orange, at: "e8" },
  { label: "不加信任区域", sub: "对照组", verdict: "6 组里有 3 组掉点", icon: "chart-decreasing", color: C.gray, at: "e9" },
  { label: "DRPO", sub: "本文方法", verdict: "6 组都稳，追平或超过最强基线", icon: "trophy", color: C.teal, at: "e11" },
];

export const ExpS: React.FC = () => {
  const { prog } = useCue();
  return (
    <AbsoluteFill>
      <SceneTag text="⑦ 实验：6 组设置" />
      <Heading text="效果怎么样？" p={prog("e1")} sticker="test-tube" />

      {/* 左:实验设置 */}
      {MODELS.map((m, i) => (
        <Abs key={m.name} x={70} y={190 + i * 118} p={prog(m.at, 14, i === 3 ? 0 : i * 6)}>
          <Card w={640} h={108} border={C.teal}>
            <div style={{ position: "absolute", left: 18, top: 14, display: "flex", alignItems: "center", gap: 16 }}>
              <Sticker name={m.sticker} size={64} />
              <div>
                <div style={{ fontSize: 31, fontWeight: 900, color: C.navy, fontFamily: MATH }}>{m.name}</div>
                <div style={{ fontSize: 25, fontWeight: 700, color: C.gray }}>{m.note}</div>
              </div>
            </div>
          </Card>
        </Abs>
      ))}
      <Abs x={70} y={662} p={prog("e4")}>
        <Card w={640} h={108} border={C.navy}>
          <div style={{ position: "absolute", left: 18, top: 14, display: "flex", alignItems: "center", gap: 16 }}>
            <Sticker name="abacus" size={64} />
            <div>
              <div style={{ fontSize: 31, fontWeight: 900, color: C.navy }}>约 13K 道数学题</div>
              <div style={{ fontSize: 25, fontWeight: 700, color: C.gray }}>规则验证 · AIME24 / AIME25 评测</div>
            </div>
          </div>
        </Card>
      </Abs>
      <Abs x={70} y={780} p={prog("e5")}>
        <Card w={640} h={108} border={C.orange}>
          <div style={{ position: "absolute", left: 18, top: 14, display: "flex", alignItems: "center", gap: 16 }}>
            <Sticker name="high-voltage" size={64} />
            <div>
              <div style={{ fontSize: 31, fontWeight: 900, color: C.navy }}>还加了 FP8 低精度</div>
              <div style={{ fontSize: 25, fontWeight: 700, color: C.gray }}>训练与推理的差异更大</div>
            </div>
          </div>
        </Card>
      </Abs>

      {/* 右:结果(只写论文原文能支撑的定性结论) */}
      {ROWS.map((r, i) => (
        <Abs key={r.label} x={760} y={190 + i * 150} p={prog(r.at)}>
          <Card w={1090} h={132} border={r.color}>
            <div style={{ position: "absolute", left: 24, top: 18 }}>
              <div style={{ fontSize: 42, fontWeight: 900, color: r.color, fontFamily: MATH }}>{r.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: C.gray }}>{r.sub}</div>
            </div>
            <div style={{ position: "absolute", left: 330, top: 28, fontSize: 36, fontWeight: 800, color: C.navy, width: 620 }}>{r.verdict}</div>
            <div style={{ position: "absolute", right: 24, top: 22 }}>
              <Sticker name={r.icon} size={86} />
            </div>
          </Card>
        </Abs>
      ))}
      <Abs x={1010} y={838} p={prog("e10")}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Chip text="不加信任区域 · Qwen3-4B 准确率" bg={C.navy} size={30} />
          <div style={{ fontSize: 64, fontWeight: 900, color: C.gray, fontFamily: MATH }}>0.25</div>
          <div style={{ fontSize: 54, fontWeight: 900, color: C.pink }}>→</div>
          <div style={{ fontSize: 64, fontWeight: 900, color: C.pink, fontFamily: MATH }}>0.17</div>
        </div>
      </Abs>
    </AbsoluteFill>
  );
};
