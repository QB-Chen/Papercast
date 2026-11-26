import React from "react";
import { Sequence } from "remotion";
import { Lottie, type LottieAnimationData } from "@remotion/lottie";
import { Sticker } from "../drpo/kit";
import { LOTTIES } from "./lotties";
import MAP from "./lottie-map.json";

const map = MAP as Record<string, { key: string; loop: boolean; speed: number }>;

/** 这个贴图名有没有对应的 Lottie 动画 */
export const hasAnim = (name: string) => !!map[name] && !!LOTTIES[map[name].key];

/**
 * 动画贴图：有对应的 Lottie 动画就播放，没有就退回静态贴图。
 * from = 开始播放的帧（场景内），动画从这一帧起从头播；放在 Sequence 里，动画的时间就是从 0 开始的本地时间，渲染时每一帧是确定的。
 */
export const AnimSticker: React.FC<{ name: string; size: number; from: number; style?: React.CSSProperties }> = ({ name, size, from, style }) => {
  const m = map[name];
  const data = m ? (LOTTIES[m.key] as LottieAnimationData | undefined) : undefined;
  if (!m || !data) return <Sticker name={name} size={size} style={style} />;
  return (
    <Sequence from={from} layout="none">
      <div style={{ width: size, height: size, ...style }}>
        <Lottie animationData={data} loop={m.loop} playbackRate={m.speed} style={{ width: size, height: size }} />
      </div>
    </Sequence>
  );
};
