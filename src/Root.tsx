import React from "react";
import { Composition } from "remotion";
import { Video } from "./Video";
import { DrpoVideo, timeline } from "./drpo/DrpoVideo";
import { FPS, TOTAL_FRAMES } from "./script";
import { PilotRatio, pilotTimeline } from "./pilot-ratio/PilotRatio";
import { Drpo2, drpo2Timeline } from "./drpo2/Drpo2";
import { StoryVideoView } from "./story/StoryVideo";
import type { Timeline } from "./drpo/types";
import type { Storyboard } from "./story/types";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* 样片:银行行不行(无声) */}
      <Composition id="Sample" component={Video} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
      {/* DRPO 论文解说(带配音),时长由 make-voice.mjs 生成的时间线决定 */}
      <Composition id="Drpo" component={DrpoVideo} durationInFrames={timeline.totalFrames} fps={timeline.fps} width={1920} height={1080} />
      {/* 试点:LLM 写的旁白 + LLM 设计的分镜(比例尺场景) */}
      <Composition id="PilotRatio" component={PilotRatio} durationInFrames={pilotTimeline.totalFrames} fps={pilotTimeline.fps} width={1920} height={1080} />
      {/* 全片 v2:LLM 写旁白 + LLM 设计分镜 */}
      <Composition id="Drpo2" component={Drpo2} durationInFrames={drpo2Timeline.totalFrames} fps={drpo2Timeline.fps} width={1920} height={1080} />
      {/* 通用：任意论文。时间线和分镜由 projects/<id>/props.json 传入(remotion render --props) */}
      <Composition
        id="Paper"
        component={StoryVideoView as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={30}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ timeline: { fps: 30, totalFrames: 30, scenes: [] } as Timeline, boards: {} as Record<string, Storyboard> } as unknown as Record<string, unknown>}
        calculateMetadata={({ props }) => {
          const tl = (props as unknown as { timeline: Timeline }).timeline;
          return { durationInFrames: Math.max(1, tl.totalFrames), fps: tl.fps };
        }}
      />
    </>
  );
};
