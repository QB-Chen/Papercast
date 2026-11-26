import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp, sec } from "../anim";
import { C, FONT } from "../theme";

type Item = { ch: string; pinyin: string; showAt: number; color: string; tag?: string };

// 5 个字的读音与颜色:第一个「行」读 háng(青绿),后两个读 xíng(橙色)
const ITEMS: Item[] = [
  { ch: "银", pinyin: "yín", showAt: 0, color: C.navy },
  { ch: "行", pinyin: "háng", showAt: sec(4), color: C.teal, tag: "银行" },
  { ch: "行", pinyin: "xíng", showAt: sec(9), color: C.orange, tag: "可以" },
  { ch: "不", pinyin: "bù", showAt: 0, color: C.navy },
  { ch: "行", pinyin: "xíng", showAt: sec(9), color: C.orange, tag: "可以" },
];

export const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const sentence = ramp(frame, 0, 15);
  const punch = ramp(frame, sec(13), 14);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 190,
          width: "100%",
          textAlign: "center",
          fontFamily: FONT,
          fontSize: 44,
          fontWeight: 700,
          color: C.gray,
          opacity: sentence,
        }}
      >
        Is the bank OK?
      </div>
      <div style={{ position: "absolute", top: 290, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 36 }}>
        {ITEMS.map((it, i) => {
          const colored = ramp(frame, it.showAt, 10);
          const isXing = it.ch === "行";
          const pinyinOp = isXing ? colored : sentence;
          return (
            <div key={i} style={{ width: 230, textAlign: "center", fontFamily: FONT, opacity: sentence }}>
              <div style={{ fontSize: 230, fontWeight: 900, color: isXing && colored > 0.5 ? it.color : C.navy, lineHeight: 1.1 }}>
                {it.ch}
              </div>
              <div style={{ fontSize: 60, fontWeight: 700, color: isXing ? it.color : C.gray, opacity: pinyinOp, marginTop: 4 }}>
                {it.pinyin}
              </div>
              {it.tag && (
                <div
                  style={{
                    margin: "18px auto 0",
                    width: 150,
                    padding: "6px 0",
                    borderRadius: 14,
                    background: it.color,
                    color: C.white,
                    fontSize: 40,
                    fontWeight: 700,
                    opacity: colored,
                    transform: `scale(${0.8 + 0.2 * colored})`,
                  }}
                >
                  {it.tag}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          top: 780,
          width: "100%",
          textAlign: "center",
          fontFamily: FONT,
          fontSize: 62,
          fontWeight: 900,
          color: C.pink,
          opacity: punch,
          transform: `scale(${0.9 + 0.1 * punch})`,
        }}
      >
        同一个字 ≠ 同一个意思
      </div>
    </AbsoluteFill>
  );
};
