import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { sec } from "./anim";
import { Background } from "./components/Background";
import { Caption } from "./components/Caption";
import { SCENES, SceneId } from "./script";
import { HookScene } from "./scenes/HookScene";
import { NumbersScene } from "./scenes/NumbersScene";
import { OutroScene } from "./scenes/OutroScene";
import { ProblemScene } from "./scenes/ProblemScene";
import { PullScene } from "./scenes/PullScene";
import { SpaceScene } from "./scenes/SpaceScene";
import { TitleCardScene } from "./scenes/TitleCardScene";
import { VectorScene } from "./scenes/VectorScene";

const REGISTRY: Record<SceneId, React.FC> = {
  hook: HookScene,
  problem: ProblemScene,
  titlecard: () => <TitleCardScene title="Token 与向量" />,
  numbers: NumbersScene,
  space: SpaceScene,
  pull: PullScene,
  vector: VectorScene,
  outro: OutroScene,
};

// 场景首尾各 8 帧淡入淡出,背景网格始终保持不动
const SceneFade: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 8, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const Video: React.FC = () => {
  let cursor = 0;
  return (
    <AbsoluteFill>
      <Background />
      {SCENES.map((scene) => {
        const from = cursor;
        const duration = sec(scene.dur);
        cursor += duration;
        const Scene = REGISTRY[scene.id];
        return (
          <Sequence key={scene.id} from={from} durationInFrames={duration} premountFor={30}>
            <SceneFade>
              <Scene />
              <Caption cues={scene.cues} />
            </SceneFade>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
