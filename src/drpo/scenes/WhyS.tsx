import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../theme";
import { Abs, Card, Chip, Heading, SceneTag, Sticker, useCue } from "../kit";

const MU = [0.12, 0.46, 0.22, 0.1, 0.1];
const PI_SMALL = [0.14, 0.43, 0.23, 0.1, 0.1];
const PI_BIG = [0.04, 0.2, 0.12, 0.52, 0.12];

// 一组柱子表示词表上的概率分布
const Dist: React.FC<{ values: number[]; x: number; y: number; color: string; label: string; p: number }> = ({ values, x, y, color, label, p }) => (
  <Abs x={x} y={y} p={p}>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 16, height: 230 }}>
      {values.map((v, i) => (
        <div key={i} style={{ width: 52, height: v * 460, background: color, borderRadius: "10px 10px 0 0" }} />
      ))}
    </div>
    <div style={{ height: 5, background: C.navy, borderRadius: 3 }} />
    <div style={{ fontSize: 36, fontWeight: 800, color, marginTop: 10, textAlign: "center" }}>{label}</div>
  </Abs>
);

export const WhyS: React.FC = () => {
  const { prog } = useCue();
  const phase1 = 1 - prog("b8", 12);
  const big = prog("b3", 16);
  // 新策略的柱子:b2 时小幅变化,b3 时大幅漂移
  const piVals = PI_SMALL.map((v, i) => v + (PI_BIG[i] - v) * big);

  return (
    <AbsoluteFill>
      <SceneTag text="① 为什么需要这根绳" />
      <div style={{ opacity: phase1 }}>
        <Heading text="为什么需要这根绳" p={prog("b1")} sticker="dog-face" />

        {/* 左:分布漂移 */}
        <Abs x={90} y={190} p={prog("b2")}>
          <Card w={820} h={520} border={C.teal} />
        </Abs>
        <Dist values={MU} x={150} y={300} color={C.teal} label="旧策略 μ" p={prog("b2")} />
        <Dist values={piVals} x={540} y={300} color={C.orange} label="新策略 π" p={prog("b2", 14, 8)} />
        <Abs x={120} y={205} p={prog("b2")}>
          <div style={{ fontSize: 34, fontWeight: 800, color: C.navy }}>每更新一步，输出分布就变一点</div>
        </Abs>
        <Abs x={250} y={608} p={prog("b3")}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Sticker name="exploding-head" size={80} />
            <Chip text="步子太大 → 训练崩" bg={C.pink} size={36} />
          </div>
        </Abs>

        {/* 右:离策略 */}
        <Abs x={960} y={190} p={prog("b4")}>
          <Card w={870} h={520} border={C.orange} />
        </Abs>
        <Abs x={1000} y={205} p={prog("b4")}>
          <div style={{ fontSize: 34, fontWeight: 800, color: C.navy }}>现实：离策略（off-policy）</div>
        </Abs>
        <Abs x={1010} y={290} p={prog("b5")}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ textAlign: "center" }}>
              <Sticker name="rocket" size={120} />
              <div style={{ fontSize: 30, fontWeight: 800, color: C.navy }}>推理引擎</div>
            </div>
            <div style={{ fontSize: 80, fontWeight: 900, color: C.pink }}>≠</div>
            <div style={{ textAlign: "center" }}>
              <Sticker name="gear" size={120} />
              <div style={{ fontSize: 30, fontWeight: 800, color: C.navy }}>训练引擎</div>
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: C.gray, width: 190 }}>数值有细微差异</div>
          </div>
        </Abs>
        <Abs x={1010} y={500} p={prog("b6")}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Sticker name="books" size={120} />
            <div style={{ fontSize: 44, fontWeight: 900, color: C.teal }}>→</div>
            <div style={{ display: "flex", gap: 10 }}>
              {[1, 2, 3].map((n) => (
                <Chip key={n} text={`小批 ${n}`} bg={C.tealLight} color={C.navy} size={30} />
              ))}
            </div>
            <div style={{ fontSize: 30, fontWeight: 700, color: C.gray, width: 150 }}>反复更新</div>
          </div>
        </Abs>

        {/* 下:b7 两条狗 */}
        <Abs x={960} y={812} p={prog("b7")} center>
          <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
            <div style={{ textAlign: "center" }}>
              <Sticker name="dog" size={100} />
              <div style={{ fontSize: 30, fontWeight: 800, color: C.teal }}>出门那条（μ）</div>
            </div>
            <div style={{ fontSize: 64, fontWeight: 900, color: C.pink }}>≠</div>
            <div style={{ textAlign: "center" }}>
              <Sticker name="dog-face" size={100} />
              <div style={{ fontSize: 30, fontWeight: 800, color: C.orange }}>手里这条（π）</div>
            </div>
          </div>
        </Abs>
      </div>

      {/* 第二阶段:信任区域 */}
      <Abs x={960} y={470} p={prog("b8", 16)} center>
        <div style={{ position: "relative", width: 640, height: 640 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: `10px dashed ${C.pink}`,
              background: "rgba(214,51,108,0.06)",
            }}
          />
          <div style={{ position: "absolute", left: 220, top: 210 }}>
            <Sticker name="dog-face" size={200} />
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 70, textAlign: "center" }}>
            <Chip text="信任区域" bg={C.pink} size={50} />
          </div>
        </div>
      </Abs>
      <Abs x={960} y={850} p={prog("b9")} center>
        <div style={{ fontSize: 46, fontWeight: 900, color: C.navy }}>不许跑出去的圈</div>
      </Abs>
    </AbsoluteFill>
  );
};
