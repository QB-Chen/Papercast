import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { C, FONT } from "../theme";
import timelineJson from "./timeline.json";
import { SceneCtx } from "./kit";
import type { TScene, Timeline } from "./types";
import { AblS } from "./scenes/AblS";
import { DeriveS } from "./scenes/DeriveS";
import { DppoS } from "./scenes/DppoS";
import { DrpoS } from "./scenes/DrpoS";
import { ExpS } from "./scenes/ExpS";
import { HookS } from "./scenes/HookS";
import { OutS } from "./scenes/OutS";
import { RatioS } from "./scenes/RatioS";
import { SpoS } from "./scenes/SpoS";
import { WhyS } from "./scenes/WhyS";

export const timeline = timelineJson as Timeline;

const REGISTRY: Record<string, React.FC> = {
  hook: HookS,
  why: WhyS,
  ratio: RatioS,
  dppo: DppoS,
  drpo: DrpoS,
  spo: SpoS,
  derive: DeriveS,
  exp: ExpS,
  abl: AblS,
  out: OutS,
};

// 当前正在说的那一句,显示在底部
const NarrationCaption: React.FC<{ scene: TScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const s = scene.sentences.find((x) => frame >= x.local && frame < x.local + x.dur + 4);
  if (!s) return null;
  const end = s.local + s.dur + 4;
  const op = Math.min(
    interpolate(frame, [s.local, s.local + 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(frame, [end - 5, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 56, display: "flex", justifyContent: "center", opacity: op }}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: 46,
          fontWeight: 700,
          color: C.white,
          background: C.captionBg,
          padding: "14px 36px",
          borderRadius: 16,
          letterSpacing: 2,
          maxWidth: 1700,
          textAlign: "center",
          lineHeight: 1.35,
        }}
      >
        {s.text}
      </div>
    </div>
  );
};

// 场景首尾各 8 帧淡入淡出
const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, dur - 8, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const DrpoVideo: React.FC = () => (
  <AbsoluteFill>
    <Background />
    {timeline.scenes.map((scene) => {
      const Scene = REGISTRY[scene.id];
      if (!Scene) throw new Error(`没有注册场景 ${scene.id}`);
      return (
        <Sequence key={scene.id} from={scene.start} durationInFrames={scene.dur} premountFor={30}>
          <SceneCtx.Provider value={scene}>
            <Fade dur={scene.dur}>
              <Scene />
              <NarrationCaption scene={scene} />
            </Fade>
            {scene.sentences.map((s) => (
              <Sequence key={s.id} from={s.local} durationInFrames={s.dur + 2}>
                <Audio src={staticFile(s.audio)} />
              </Sequence>
            ))}
          </SceneCtx.Provider>
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
