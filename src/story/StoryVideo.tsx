import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { C, FONT } from "../theme";
import { SceneCtx, setStickerPack } from "../drpo/kit";
import type { TScene, Timeline } from "../drpo/types";
import { StoryScene } from "./StoryScene";
import type { Storyboard } from "./types";
import { setLang, getLang, splitCaptionLang } from "./i18n";

// 把一句长旁白按标点切成一行放得下的几段，随配音依次显示（口播稿句子偏长，整句挤在一起会变成两三行）
export const splitCaption = (text: string, max = 30): string[] => {
  const parts = text.match(/[^，。？！；：、]+[，。？！；：、]?/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (!cur || [...cur + p].length <= max) cur += p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  // 单段仍然太长（没有标点的长句），硬切
  return out.flatMap((seg) => {
    const chars = [...seg];
    if (chars.length <= max + 6) return [seg];
    const n = Math.ceil(chars.length / max);
    const size = Math.ceil(chars.length / n);
    return Array.from({ length: n }, (_, i) => chars.slice(i * size, (i + 1) * size).join(""));
  });
};

// 底部字幕:当前正在说的那一句（长句分段显示，每段按字数占比分配时间）
const Caption: React.FC<{ scene: TScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const s = scene.sentences.find((x) => frame >= x.local && frame < x.local + x.dur + 4);
  if (!s) return null;
  const end = s.local + s.dur + 4;
  const on = s.local + (s.onset ?? 0); // 第一个字开口的帧：字幕跟着声音出现，不比声音早
  const op = Math.min(
    interpolate(frame, [on, on + 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(frame, [end - 5, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  let shown: string;
  if (s.caps && s.caps.length) {
    // 按真实配音时间换段
    const rel = frame - s.local;
    shown = s.caps[0].text;
    for (const c of s.caps) if (rel >= c.at) shown = c.text;
  } else {
    // 没有对齐数据时，按字数比例分配
    const segs = splitCaptionLang(s.text, getLang());
    const total = segs.reduce((a, t) => a + [...t].length, 0) || 1;
    const t = Math.min(0.999, Math.max(0, (frame - s.local) / Math.max(1, s.dur)));
    let acc = 0;
    shown = segs[segs.length - 1];
    for (const seg of segs) {
      acc += [...seg].length / total;
      if (t < acc) {
        shown = seg;
        break;
      }
    }
  }
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 56, display: "flex", justifyContent: "center", opacity: op }}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: getLang() === "en" ? 44 : 46,
          fontWeight: 700,
          color: C.white,
          background: C.captionBg,
          padding: "14px 36px",
          borderRadius: 16,
          letterSpacing: getLang() === "en" ? 0.4 : 2,
          maxWidth: 1700,
          textAlign: "center",
          lineHeight: 1.35,
        }}
      >
        {shown}
      </div>
    </div>
  );
};

const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, dur - 8, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** 通用:一个时间线 + 若干分镜(按场景 id 对应)渲染成完整视频 */
export type StoryVideoProps = { boards?: Record<string, Storyboard> };

/** 通用视图：时间线和分镜都从 props 来（新流水线的 Paper 合成用它） */
export const StoryVideoView: React.FC<{ timeline: Timeline; boards: Record<string, Storyboard>; stickerPack?: string; stickerNames?: string[]; lang?: string }> = ({ timeline, boards, stickerPack, stickerNames, lang }) => {
  setStickerPack(stickerPack, stickerNames);
  setLang(lang);
  return <StoryVideoBody timeline={timeline} boards={boards} />;
};
const StoryVideoBody: React.FC<{ timeline: Timeline; boards: Record<string, Storyboard> }> = ({ timeline, boards }) => (
  <AbsoluteFill>
    <Background />
    {timeline.scenes.map((scene) => {
      const board = boards[scene.id];
      if (!board) throw new Error(`没有场景 ${scene.id} 的分镜`);
      return (
        <Sequence key={scene.id} from={scene.start} durationInFrames={scene.dur} premountFor={30}>
          <SceneCtx.Provider value={scene}>
            <Fade dur={scene.dur}>
              <StoryScene story={board} />
              <Caption scene={scene} />
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

export const makeStoryVideo = (timeline: Timeline, defaultBoards: Record<string, Storyboard>): React.FC<StoryVideoProps> => {
  // 通过 inputProps 传入 boards 可以临时替换分镜(用于对比不同模型的设计,不用改文件)
  const StoryVideo: React.FC<StoryVideoProps> = ({ boards: override }) => {
    const boards = { ...defaultBoards, ...(override ?? {}) };
    return (
    <AbsoluteFill>
      <Background />
      {timeline.scenes.map((scene) => {
        const board = boards[scene.id];
        if (!board) throw new Error(`没有场景 ${scene.id} 的分镜`);
        return (
          <Sequence key={scene.id} from={scene.start} durationInFrames={scene.dur} premountFor={30}>
            <SceneCtx.Provider value={scene}>
              <Fade dur={scene.dur}>
                <StoryScene story={board} />
                <Caption scene={scene} />
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
  };
  return StoryVideo;
};
