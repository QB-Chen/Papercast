import React from "react";
import { AbsoluteFill } from "remotion";
import { prog, ramp, type EaseName } from "../anim";
import { FONT } from "../theme";
import { Abs, Heading, SceneTag, useCue } from "../drpo/kit";
import { ELEMENTS as STATIC_ELEMENTS } from "./elements";
import { GrowEl, LeashEl } from "./motion";
import { DistEl, EqEl, NumberLineEl, PlotEl, RowsEl, TitleEl } from "./rich";
import { ChartEl, DiagramEl, FigEl, TableEl } from "./rich2";
import { EqxEl } from "./rich3";
import { PaperBarEl, StageEl, StreamEl } from "./rich4";
import { CanvasEl as CanvasItemsEl } from "./canvas";
import { FreeEl } from "./free";
import { MotionEl } from "./motion-code";
const CanvasEl: React.FC<{ b: Beat; box: { w: number; h: number } }> = (props) => (props.b.form === "motion" ? <MotionEl {...props} /> : props.b.form === "free" ? <FreeEl {...props} /> : <CanvasItemsEl {...props} />);

// 静态元素 + 有运动的元素（运动元素依赖旁白时间线，所以单独放在 motion.tsx）
const ELEMENTS = { ...STATIC_ELEMENTS, leash: LeashEl, grow: GrowEl, title: TitleEl, dist: DistEl, numberline: NumberLineEl, plot: PlotEl, eq: EqEl, rows: RowsEl, fig: FigEl, table: TableEl, chart: ChartEl, diagram: DiagramEl, eqx: EqxEl, stage: StageEl, stream: StreamEl, paperbar: PaperBarEl, canvas: CanvasEl };
import { CONFLICTS, SLOT_RECT, SLOTS, type Beat, type Slot, type Storyboard } from "./types";

type Placed = { beat: Beat; from: number; to: number }; // 帧区间 [from, to)

/**
 * 把分镜展开成"每个位置在什么时间段显示哪个元素"。
 * 规则:同位置后来的元素替换前面的;互斥位置(C 与 L/R)互相清掉;clear 清空所有位置。
 */
export function planBeats(story: Storyboard, at: (id: string) => number, endFrame: number): Placed[] {
  const sorted = story.beats
    .map((beat, order) => ({ beat, order, from: at(beat.at) }))
    .sort((a, b) => a.from - b.from || a.order - b.order);

  const placed: Placed[] = [];
  const open: Partial<Record<Slot, Placed>> = {};
  const closeSlot = (slot: Slot, frame: number) => {
    const cur = open[slot];
    if (cur) {
      cur.to = Math.max(frame, cur.from);
      delete open[slot];
    }
  };

  for (const { beat, from } of sorted) {
    if (beat.clear) for (const s of SLOTS) closeSlot(s, from);
    closeSlot(beat.slot, from);
    for (const other of CONFLICTS[beat.slot]) closeSlot(other, from);
    const p: Placed = { beat, from, to: endFrame };
    open[beat.slot] = p;
    placed.push(p);
  }
  return placed;
}

export const StoryScene: React.FC<{ story: Storyboard }> = ({ story }) => {
  const { frame, at, scene } = useCue();
  const placed = React.useMemo(() => planBeats(story, at, scene.dur), [story, scene]);

  // 小格子的实际显示区域:同一侧的另一个小格在此刻没有元素时，就把这个元素拉成整侧高度并居中，避免只用半个屏幕
  const rectFor = (p: Placed) => {
    const base = SLOT_RECT[p.beat.slot];
    const pair: Partial<Record<Slot, Slot>> = { L1: "L2", L2: "L1", R1: "R2", R2: "R1" };
    const mate = pair[p.beat.slot];
    if (!mate) return base;
    const mateBusy = placed.some((q) => q.beat.slot === mate && q.from < p.to && p.from < q.to && q !== p);
    if (mateBusy) return base;
    // 同侧另一格空着：占满该侧 300~900
    return { x: base.x, y: 300, w: base.w, h: 600 };
  };
  const headingP = story.heading ? ramp(frame, at(story.heading.at), 14) : 0;

  return (
    <AbsoluteFill>
      <SceneTag text={story.tag} />
      {story.heading && <Heading text={story.heading.text} sticker={story.heading.sticker} p={headingP} y={78} />}
      {placed.map((p, i) => {
        // 开关：story.motionStyle === "classic" 时用原来的统一淡入上浮 + 叠化转场（方便对比和回退），默认用新的"进场短句 + 接力转场"
        const classic = story.motionStyle === "classic";
        // 接力：被替换时旧镜头 6 帧内收走（缩小、上移、变淡），新镜头晚 DELAY 帧再出现，两者基本错开，不再半透明地叠在一起。
        // 只对中央整屏的替换这样做；第一个镜头不延后，保证开场画面立刻就位
        // "有前一个镜头在被它替换"：同一个槽位里存在一个更早开始、并且在这一刻之后才结束的镜头
        const replacing = placed.some((q) => q !== p && q.beat.slot === p.beat.slot && q.from < p.from && q.to >= p.from - 1 && q.to <= p.from + 1);
        const DELAY = !classic && p.beat.slot === "C" && replacing ? 4 : 0;
        const OUT = classic ? 8 : 6;
        if (frame < p.from + DELAY || frame >= p.to + OUT) return null;
        const rect = rectFor(p);
        // 进场的"性格"按元素种类选：沉稳的讲解主体平滑落定，活泼的元素轻微过冲，不再所有镜头同一个淡入上浮
        const FEEL: Record<string, { kind: EaseName; dur: number; rise: number; grow: number }> = {
          eqx: { kind: "out", dur: 16, rise: 14, grow: 0.97 },
          fig: { kind: "out", dur: 18, rise: 16, grow: 0.96 },
          table: { kind: "out", dur: 16, rise: 14, grow: 0.97 },
          chart: { kind: "out", dur: 18, rise: 14, grow: 0.97 },
          diagram: { kind: "out", dur: 18, rise: 14, grow: 0.97 },
          canvas: { kind: "out", dur: 14, rise: 8, grow: 0.98 },
          stream: { kind: "out", dur: 14, rise: 12, grow: 0.97 },
          stage: { kind: "pop", dur: 18, rise: 22, grow: 0.92 },
          sticker: { kind: "bounce", dur: 20, rise: 16, grow: 0.7 },
          card: { kind: "pop", dur: 18, rise: 24, grow: 0.93 },
          flow: { kind: "pop", dur: 18, rise: 20, grow: 0.94 },
          compare: { kind: "pop", dur: 18, rise: 22, grow: 0.94 },
          dots: { kind: "pop", dur: 18, rise: 18, grow: 0.93 },
          bars: { kind: "out", dur: 16, rise: 16, grow: 0.95 },
          text: { kind: "out", dur: 12, rise: 26, grow: 0.96 },
          title: { kind: "out", dur: 16, rise: 22, grow: 0.94 },
        };
        const feel = classic ? { kind: "out" as EaseName, dur: 14, rise: 20, grow: 0.94 } : (FEEL[p.beat.kind] ?? { kind: "out" as EaseName, dur: 14, rise: 20, grow: 0.94 });
        const start = p.from + DELAY; // 进场进度从延后后的起点算，不然一露面就已经走了几帧
        const inP = ramp(frame, start, 12); // 透明度仍用平滑进度（不能超过 1）
        const motionP = prog(frame, start, feel.dur, feel.kind); // 位移和缩放用带性格的进度（可以过冲）
        const outT = frame >= p.to ? Math.min(1, (frame - p.to) / OUT) : 0; // 被替换时的退场进度 0→1
        const outP = classic ? 1 - outT : 1 - outT * outT; // 新：先慢后快地淡出，旧镜头一开始还可读，很快收走；旧：线性淡出
        const El = ELEMENTS[p.beat.kind];
        if (!El) throw new Error(`未知的元素种类 ${p.beat.kind}（at=${p.beat.at}）`);
        return (
          <Abs key={i} x={rect.x} y={rect.y} p={Math.min(inP, outP)} pm={outP < 1 ? Math.min(inP, outP) : motionP} grow={feel.grow} rise={feel.rise} style={{ width: rect.w, height: rect.h, fontFamily: FONT }}>
            {/* 镜头缓慢推近：每个镜头在停留期间轻微放大，让静止画面也有"呼吸感" */}
            <div style={{ width: rect.w, height: rect.h, transform: `scale(${1 + 0.03 * Math.min(1, (frame - p.from) / Math.max(1, Math.min(p.to - p.from, 300)))})`, transformOrigin: "50% 50%" }}>
              <El b={p.beat} box={{ w: rect.w, h: rect.h }} />
            </div>
          </Abs>
        );
      })}
    </AbsoluteFill>
  );
};

