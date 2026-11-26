import React from "react";
import { AbsoluteFill } from "remotion";
import { C, FONT } from "../../theme";
import { Abs, Card, Chip, Heading, MATH, SceneTag, Sticker, useCue } from "../kit";

// 比例尺的问题:蚂蚁(低概率词)和大象(高概率词)
type AnimalProps = {
  x: number;
  animal: string;
  title: string;
  muOld: string;
  muNew: string;
  ratio: string;
  ratioBar: number; // 0~1
  verdict: string;
  verdictIcon: string;
  verdictColor: string;
  absText: string;
  absBar: number; // px
  pName: [string, string, string]; // 出现顺序的句子 id:卡片 / 比例与结论 / 绝对变化
  prog: (id: string, dur?: number, delay?: number) => number;
};

const AnimalCard: React.FC<AnimalProps> = ({ x, animal, title, muOld, muNew, ratio, ratioBar, verdict, verdictIcon, verdictColor, absText, absBar, pName, prog }) => (
  <>
    <Abs x={x} y={460} p={prog(pName[0])}>
      <Card w={840} h={400} border={verdictColor}>
        <div style={{ position: "absolute", left: 28, top: 24, display: "flex", alignItems: "center", gap: 18 }}>
          <Sticker name={animal} size={animal === "ant" ? 90 : 150} style={{ marginTop: animal === "ant" ? 30 : 0 }} />
          <div>
            <div style={{ fontSize: 40, fontWeight: 900, color: C.navy }}>{title}</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: C.gray, fontFamily: MATH }}>
              μ = {muOld} → π = {muNew}
            </div>
          </div>
        </div>
        {/* 比例条 */}
        <div style={{ position: "absolute", left: 28, top: 190, opacity: prog(pName[1]) }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.navy }}>比例变化 r = {ratio}</div>
          <div style={{ width: 640, height: 22, background: "#DDE7E8", borderRadius: 11, marginTop: 8 }}>
            <div style={{ width: 640 * ratioBar, height: 22, background: verdictColor, borderRadius: 11 }} />
          </div>
        </div>
        <div style={{ position: "absolute", right: 30, top: 175, opacity: prog(pName[1]), display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <Sticker name={verdictIcon} size={84} />
          <div style={{ fontSize: 30, fontWeight: 900, color: verdictColor }}>{verdict}</div>
        </div>
        {/* 绝对变化条(按真实比例画:1 个百分点 = 20px) */}
        <div style={{ position: "absolute", left: 28, top: 285, opacity: prog(pName[2]) }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.navy }}>实际多搬走的概率 {absText}</div>
          <div style={{ width: 640, height: 22, background: "#DDE7E8", borderRadius: 11, marginTop: 8 }}>
            <div style={{ width: absBar, height: 22, background: C.teal, borderRadius: 11 }} />
          </div>
        </div>
      </Card>
    </Abs>
  </>
);

export const RatioS: React.FC = () => {
  const { prog } = useCue();
  const upper = 1 - prog("r11", 12);
  const lower = 1 - prog("r12", 12);

  return (
    <AbsoluteFill>
      <SceneTag text="② 比例尺的毛病" />
      <Heading text="这根绳，怎么量？" p={prog("r1")} sticker="straight-ruler" />

      <div style={{ opacity: upper }}>
        <Abs x={960} y={230} p={prog("r2")} center>
          <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
            <div style={{ fontSize: 66, fontWeight: 700, color: C.navy, fontFamily: MATH }}>r = π(y) / μ(y)</div>
            <Chip text="PPO" bg={C.teal} size={36} />
            <Chip text="GRPO" bg={C.teal} size={36} />
          </div>
        </Abs>
        {/* 剪切带 */}
        <Abs x={960} y={345} p={prog("r3")} center>
          <div style={{ position: "relative", width: 900, height: 80 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 36, height: 8, background: C.navy, borderRadius: 4 }} />
            <div style={{ position: "absolute", left: 300, width: 300, top: 14, height: 52, background: "rgba(62,156,140,0.35)", border: `4px solid ${C.teal}`, borderRadius: 12 }} />
            <div style={{ position: "absolute", left: 0, top: 80, fontSize: 28, fontWeight: 800, color: C.pink }}>超出 → 梯度剪成 0</div>
            <div style={{ position: "absolute", left: 300, width: 300, top: 80, fontSize: 28, fontWeight: 800, color: C.teal, textAlign: "center" }}>允许范围 1±ε</div>
            <div style={{ position: "absolute", left: 270, top: -22 }}>
              <Sticker name="scissors" size={56} />
            </div>
            <div style={{ position: "absolute", left: 575, top: -22 }}>
              <Sticker name="scissors" size={56} />
            </div>
          </div>
        </Abs>
        <Abs x={1400} y={170} p={prog("r4")}>
          <Chip text="词表是长尾的 ⚠" bg={C.orange} size={34} />
        </Abs>
      </div>

      <div style={{ opacity: Math.min(lower, 1) }}>
        <AnimalCard
          x={70}
          animal="ant"
          title="蚂蚁：低概率的小词"
          muOld="0.001"
          muNew="0.002"
          ratio="×2.0"
          ratioBar={1}
          verdict="立刻被拦"
          verdictIcon="stop-sign"
          verdictColor={C.pink}
          absText="+0.001"
          absBar={4}
          pName={["r5", "r6", "r7"]}
          prog={prog}
        />
        <AnimalCard
          x={1010}
          animal="elephant"
          title="大象：高概率的大词"
          muOld="0.5"
          muNew="0.6"
          ratio="×1.2"
          ratioBar={0.2}
          verdict="没人管"
          verdictIcon="check-mark-button"
          verdictColor={C.orange}
          absText="+0.10"
          absBar={200}
          pName={["r8", "r9", "r10"]}
          prog={prog}
        />
      </div>

      {/* r11:结论横幅 */}
      <Abs x={960} y={330} p={prog("r11")} center style={{ opacity: Math.min(prog("r11"), lower) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Sticker name="balance-scale" size={120} />
          <div style={{ fontSize: 62, fontWeight: 900, color: C.navy }}>
            对小词<span style={{ color: C.pink }}>太严</span>，对大词<span style={{ color: C.orange }}>太松</span>
          </div>
        </div>
      </Abs>

      {/* r12~r13:长尾统计 */}
      <Abs x={960} y={500} p={prog("r12", 16)} center>
        <div style={{ textAlign: "center", fontFamily: FONT }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28 }}>
            <Sticker name="magnifying-glass-tilted-left" size={150} />
            <div style={{ fontSize: 200, fontWeight: 900, color: C.pink, lineHeight: 1 }}>7.8%</div>
          </div>
          <div style={{ fontSize: 46, fontWeight: 800, color: C.navy, marginTop: 8 }}>概率 ≤ 0.01 的词，占全部采样的比例</div>
          <div style={{ width: 1100, height: 38, background: "#DDE7E8", borderRadius: 19, margin: "30px auto 0", overflow: "hidden", textAlign: "left" }}>
            <div style={{ width: 1100 * 0.078 + 6, height: 38, background: C.pink }} />
          </div>
        </div>
      </Abs>
      <Abs x={960} y={800} p={prog("r13")} center>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Sticker name="warning" size={70} />
          <div style={{ fontSize: 48, fontWeight: 900, color: C.navy }}>这条长尾，不能忽略</div>
        </div>
      </Abs>
    </AbsoluteFill>
  );
};
