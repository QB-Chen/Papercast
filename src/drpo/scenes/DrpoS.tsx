import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { C } from "../../theme";
import { Abs, Card, Chip, ChartFrame, Curve, Heading, MATH, SceneTag, Spring, Sticker, cx, cy, useCue } from "../kit";

const Mu: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: C.pink, background: "rgba(214,51,108,0.12)", borderRadius: 10, padding: "0 8px" }}>{children}</span>
);

// DRPO:硬开关换成弹簧
export const DrpoS: React.FC = () => {
  const { frame, at, prog } = useCue();
  const phaseA = 1 - prog("p7", 12);
  const phaseB = prog("p7", 14);

  // 阶段 B 的曲线
  const diverge: [number, number][] = [
    [0, 1],
    [1.6, -0.6],
  ];
  const converge: [number, number][] = [
    [0, 1],
    [1.6, 2.6],
  ];
  const step: [number, number][] = [
    [0, 1],
    [1, 1],
    [1, 0],
    [1.6, 0],
  ];
  // 往外冲(p7~p10):先画到 δ,p10 再画完
  const divP = frame < at("p10") ? prog("p7", 70) * 0.62 : 0.62 + prog("p10", 40) * 0.38;

  // 右侧:狗相对圆心的距离(像素)。0=圈心,150=边界
  const dist = interpolate(
    frame,
    [at("p7"), at("p9"), at("p10"), at("p10") + 24, at("p11"), at("p11") + 30],
    [0, 150, 150, 245, 245, 170],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );
  const ox = 1560;
  const oy = 470;
  const outside = dist > 152;

  return (
    <AbsoluteFill>
      <SceneTag text="④ DRPO：把开关换成弹簧" />
      <Heading text="DRPO：硬开关 → 弹簧" p={prog("p1")} sticker="sparkles" />

      {/* 阶段 A:对比卡 + 公式 */}
      <div style={{ opacity: phaseA }}>
        <Abs x={150} y={190} p={prog("p1")}>
          <Card w={760} h={290} border={C.orange}>
            <div style={{ position: "absolute", left: 30, top: 26, fontSize: 40, fontWeight: 900, color: C.orange }}>DPPO · 硬掩码</div>
            <div style={{ position: "absolute", left: 30, top: 100 }}>
              <Sticker name="scissors" size={130} />
            </div>
            <div style={{ position: "absolute", left: 190, top: 140, fontSize: 36, fontWeight: 800, color: C.navy }}>
              越界就剪断梯度
              <br />
              开关：全开 / 全关
            </div>
          </Card>
        </Abs>
        <Abs x={1010} y={190} p={prog("p1", 14, 6)}>
          <Card w={760} h={290} border={C.teal}>
            <div style={{ position: "absolute", left: 30, top: 26, fontSize: 40, fontWeight: 900, color: C.teal }}>DRPO · 平滑弹簧</div>
            <svg width={700} height={150} style={{ position: "absolute", left: 30, top: 100 }}>
              <Spring x1={20} y1={70} x2={660} y2={70} coils={11} amp={26} color={C.teal} width={9} />
            </svg>
            <div style={{ position: "absolute", left: 30, bottom: 22, fontSize: 36, fontWeight: 800, color: C.navy }}>越偏离，拉得越狠</div>
          </Card>
        </Abs>

        <Abs x={960} y={560} p={prog("p2")} center>
          <div style={{ fontSize: 56, fontWeight: 700, color: C.navy, fontFamily: MATH, whiteSpace: "nowrap" }}>
            ℒ = r·Â − <span style={{ color: C.teal }}>|Â| / 2δ</span> · <Mu>μ(y)</Mu> · (r − 1)²
          </div>
        </Abs>
        <Abs x={640} y={640} p={prog("p2")} center>
          <Chip text="平滑的二次惩罚" bg={C.teal} size={32} />
        </Abs>
        <Abs x={1180} y={640} p={prog("p3")} center>
          <Chip text="多乘一个旧概率 μ" bg={C.pink} size={32} />
        </Abs>
        <Abs x={960} y={735} p={prog("p4")} center>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <Chip text="尺子：比例" bg={C.gray} size={36} />
            <div style={{ fontSize: 50, fontWeight: 900, color: C.navy }}>→</div>
            <Chip text="绝对概率变化" bg={C.pink} size={36} />
          </div>
        </Abs>
        <Abs x={960} y={835} p={prog("p5")} center>
          <div style={{ fontSize: 50, fontWeight: 700, color: C.navy, fontFamily: MATH }}>
            w = 1 − sign(Â·(r−1)) · D / δ
          </div>
        </Abs>
        <Abs x={1560} y={760} p={prog("p6")} center>
          <Chip text="D：越界多少" bg={C.orange} size={30} />
        </Abs>
        <Abs x={1560} y={820} p={prog("p6", 14, 10)} center>
          <Chip text="sign：往哪走" bg={C.navy} size={30} />
        </Abs>
      </div>

      {/* 阶段 B:权重曲线 + 狗 */}
      <ChartFrame p={phaseB}>
        <Curve pts={step} color={C.gray} p={prog("p14", 20)} dashed width={7} />
        <Curve pts={diverge} color={C.pink} p={divP} width={11} />
        <Curve pts={converge} color={C.teal} p={prog("p12", 50)} width={11} />
        <g opacity={prog("p9", 12)}>
          <circle cx={cx(1)} cy={cy(0)} r={20} fill={C.pink} />
        </g>
      </ChartFrame>
      <Abs x={cx(0.05)} y={cy(1) - 96} p={prog("p7")}>
        <div style={{ fontSize: 34, fontWeight: 900, color: C.pink, fontFamily: MATH, whiteSpace: "nowrap" }}>往外冲：w = 1 − D/δ</div>
      </Abs>
      <Abs x={cx(0.05)} y={cy(2.75)} p={prog("p12")}>
        <div style={{ fontSize: 34, fontWeight: 900, color: C.teal, fontFamily: MATH, whiteSpace: "nowrap" }}>往回走：w = 1 + D/δ（放大）</div>
      </Abs>
      <Abs x={cx(1) + 28} y={cy(0) + 28} p={prog("p9")}>
        <Chip text="边界处 w = 0" bg={C.pink} size={28} />
      </Abs>
      <Abs x={cx(1.12)} y={cy(-0.62)} p={prog("p10")}>
        <Chip text="w < 0：反向拽回" bg={C.pink} size={30} />
      </Abs>
      <Abs x={cx(1.02)} y={cy(1) - 70} p={prog("p14")}>
        <Chip text="灰虚线：DPPO，边界相同" bg={C.gray} size={28} />
      </Abs>
      <Abs x={cx(0.4)} y={cy(-0.7)} p={prog("p15")}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Sticker name="chart-decreasing" size={64} />
          <div style={{ fontSize: 42, fontWeight: 900, color: C.navy }}>悬崖 → 斜坡</div>
        </div>
      </Abs>

      {/* 右侧:弹簧牵引 */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: phaseB }}>
        <circle cx={ox} cy={oy} r={150} fill="rgba(214,51,108,0.06)" stroke={C.pink} strokeWidth={8} strokeDasharray="16 12" />
        <Spring
          x1={ox}
          y1={oy}
          x2={ox + dist}
          y2={oy}
          coils={Math.max(3, Math.round(dist / 22))}
          amp={14}
          color={outside ? C.pink : C.teal}
          width={7}
          opacity={dist > 8 ? 1 : 0}
        />
      </svg>
      <Abs x={ox} y={oy} p={phaseB} center rise={0}>
        <Sticker name="man-walking" size={110} />
      </Abs>
      <Abs x={ox + dist + 60} y={oy} p={phaseB} center rise={0}>
        <Sticker name="dog-face" size={130} />
      </Abs>
      <Abs x={ox} y={oy + 215} p={prog("p8")} center>
        <div style={{ fontSize: 34, fontWeight: 800, color: C.navy, textAlign: "center" }}>
          {outside ? "冲出圈：弹簧把它拽回" : "越靠近边界，劲儿越小"}
        </div>
      </Abs>
    </AbsoluteFill>
  );
};
