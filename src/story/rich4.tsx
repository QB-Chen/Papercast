import React from "react";
import { Img, staticFile } from "remotion";
import { ramp } from "../anim";
import { C, FONT } from "../theme";
import { Sticker, useCue } from "../drpo/kit";
import type { Beat } from "./types";
import { AnimSticker } from "./AnimSticker";
import { StreamText } from "./hand";
import { fitFont } from "./elements";

type Box = { w: number; h: number };

/** 角色图（public/chars/<id>.svg） */
export const Char: React.FC<{ id: string; size: number; style?: React.CSSProperties }> = ({ id, size, style }) => (
  // 加一圈白色描边和轻影，让人物也像"贴纸"，和贴图包的风格靠近
  <Img
    src={staticFile(`chars/${id}.svg`)}
    style={{
      width: size,
      height: size,
      objectFit: "contain",
      filter: `drop-shadow(0 0 ${Math.max(2, size * 0.012)}px #fff) drop-shadow(0 0 ${Math.max(2, size * 0.012)}px #fff) drop-shadow(0 ${size * 0.015}px ${size * 0.03}px rgba(31,58,95,0.28))`,
      ...style,
    }}
  />
);

// ---------------------------------------------------------------------------
// stream:论文里真实的模型输出，逐字打出，关键短语依次点亮。文字由校验器核对必须是论文原文。
// ---------------------------------------------------------------------------
export const StreamEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at, scene } = useCue();
  const t0 = at(b.at);
  const sent = scene.sentences.find((s) => s.id === b.at);
  const dur = Math.max(60, sent?.dur ?? 120);
  const text = b.text ?? "";
  const reveal = Math.min(1, Math.max(0, (frame - t0 - 8) / Math.max(30, dur * 0.55))); // 打字占这句话前半段
  const ignite = Math.min(1, Math.max(0, (frame - t0 - 8 - dur * 0.55) / Math.max(30, dur * 0.4))); // 打完后依次点亮
  const enter = ramp(frame, t0, 12);
  const n = [...text].length;
  // 字号按"放得下几行"来定：先取大字号，文字允许折行；字符多就逐级缩小，直到整段能放进框（框内可用高度约 box.h*0.55）
  const innerW = box.w - 60 - 88;
  const innerH = box.h * 0.55;
  let size = 76;
  while (size > 36) {
    const perLine = Math.max(1, Math.floor(innerW / (size * 0.62)));
    const lines = Math.ceil(n / perLine);
    if (lines * size * 1.35 <= innerH) break;
    size -= 4;
  }
  const blink = Math.floor(frame / 12) % 2 === 0 && reveal < 1;
  return (
    <div style={{ width: box.w, height: box.h, display: "flex", alignItems: "center", justifyContent: "center", opacity: Math.min(1, enter) }}>
      <div style={{ boxSizing: "border-box", width: box.w - 60, minHeight: box.h * 0.62, borderRadius: 28, background: "rgba(255,255,255,0.94)", border: `5px solid ${C.pink}`, padding: "30px 44px", position: "relative" }}>
        <div style={{ position: "absolute", left: 36, top: -26, background: C.pink, color: C.white, borderRadius: 999, padding: "4px 24px", fontFamily: FONT, fontWeight: 900, fontSize: 32 }}>{b.label ?? "论文里模型的真实输出"}</div>
        <div style={{ fontFamily: `"Consolas", "Courier New", ${FONT}`, fontWeight: 700, fontSize: size, lineHeight: 1.35, color: C.navy, wordBreak: "break-word", marginTop: 14 }}>
          <StreamText text={text} phrases={b.phrases ?? []} reveal={reveal} ignite={ignite} hlColor={C.pink} />
          <span style={{ display: "inline-block", width: size * 0.5, height: size * 0.9, marginLeft: 6, verticalAlign: "-0.1em", background: blink ? C.navy : "transparent" }} />
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// paperbar:论文条。交代"这是哪篇论文、谁写的、发在哪"：一张倾斜的论文首页缩略图 + 标题 + 作者 + 单位。
// 数据由程序按项目的论文信息自动填入（build-props），不让模型写，免得拼错人名。放在顶部横条 T 位置。
// ---------------------------------------------------------------------------
export const PaperBarEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const info = b.paperInfo;
  if (!info) return null;
  const t0 = at(b.at);
  const enter = Math.min(1, ramp(frame, t0, 18));
  const sheetH = box.h - 6;
  const sheetW = sheetH * 0.77;
  const drift = Math.min(10, (frame - t0) * 0.03); // 纸页非常缓慢地往上飘
  return (
    <div style={{ width: box.w, height: box.h, position: "relative", opacity: enter, transform: `translateX(${(1 - enter) * -40}px)` }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: box.w, height: box.h, borderRadius: 24, background: "rgba(255,255,255,0.92)", border: `4px solid ${C.teal}`, boxSizing: "border-box" }} />
      {info.shot && (
        <div style={{ position: "absolute", left: 22, top: 4, width: sheetW, height: sheetH, overflow: "hidden", transform: "rotate(-2.5deg)", boxShadow: "0 6px 18px rgba(31,58,95,0.28)", background: "#fff", border: "2px solid #E3E8EA", borderRadius: 4 }}>
          <Img src={staticFile(info.shot)} style={{ width: sheetW * 1.18, marginLeft: -sheetW * 0.09, marginTop: -drift - 6 }} />
        </div>
      )}
      <div style={{ position: "absolute", left: sheetW + 56, right: 28, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, fontFamily: FONT }}>
        {/* 英文论文名和作者按拉丁字符宽度（约 0.52 个字号）估算，不用 fitFont（它按汉字宽度估，对英文太保守，会把字压得很小） */}
        <div style={{ fontSize: Math.min(38, Math.floor((box.w - sheetW - 110) / (info.title.length * 0.54))), fontWeight: 900, color: C.navy, lineHeight: 1.15, whiteSpace: "nowrap" }}>{info.title}</div>
        <div style={{ fontSize: Math.min(26, Math.floor((box.w - sheetW - 110) / (info.authors.length * 0.5))), fontWeight: 700, color: C.navy, opacity: 0.88, whiteSpace: "nowrap" }}>{info.authors}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.pink }}>{info.venue}</div>
      </div>
    </div>
  );
};

const POS_X = { left: 0.27, center: 0.5, right: 0.73 } as const;
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// ---------------------------------------------------------------------------
// stage:角色小剧场。一两个人物（职业/动作姿势图）站在台上，随旁白出场、做动作、说话、冒出表情和道具。
// 用来"演"比喻和对比，代替大段文字。台词不含数字，不承载论文里的事实。
// ---------------------------------------------------------------------------
export const StageEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at } = useCue();
  const cast = b.cast ?? [];
  const acts = (b.acts ?? []).map((a) => ({ ...a, f: at(a.at) })).sort((x, y) => x.f - y.f);
const size = Math.min(350, box.h * 0.58);
  const ground = box.h - 90;
  const enter = ramp(frame, at(b.at), 12);

  // 当前正在显示的台词：最近一条已经开始的 say
  const talking = [...acts].reverse().find((a) => a.say && a.f <= frame);

  const actors = cast.map((c) => {
    const mine = acts.filter((a) => a.who === c.id && a.f <= frame);
    return { c, mine };
  });

  return (
    <div style={{ width: box.w, height: box.h, position: "relative", opacity: Math.min(1, enter) }}>
      {/* 舞台底板 */}
      <div style={{ position: "absolute", inset: 0, borderRadius: 40, background: "linear-gradient(180deg, rgba(255,255,255,0.35), rgba(214,228,226,0.55))", border: "3px solid rgba(31,58,95,0.10)" }} />
      <div style={{ position: "absolute", left: 40, right: 40, top: ground + 6, height: 4, borderRadius: 2, background: "rgba(31,58,95,0.12)" }} />

      {actors.map(({ c, mine }) => {
        if (!mine.length) return null;
        const pos = c.pos ?? "center";
        const ax = box.w * POS_X[pos];
        const first = mine[0];
        const last = mine[mine.length - 1];
        const ep = easeOut((frame - first.f) / 16);
        const look = [...mine].reverse().find((a) => a.look)?.look ?? c.look;

        // 放大/缩小（持续状态）
        let sc = 1;
        for (const a of mine) {
          if (a.do === "grow" || a.do === "shrink") {
            const target = a.do === "grow" ? 1.35 : 0.78;
            sc = sc + (target - sc) * easeOut((frame - a.f) / 14);
          }
        }
        // 最近一次动作的瞬时动画
        const lastDo = [...mine].reverse().find((a) => a.do && a.do !== "idle" && a.do !== "grow" && a.do !== "shrink" && a.do !== "enter");
        let dx = 0, dy = 0, rot = 0;
        if (lastDo) {
          const t = frame - lastDo.f;
          const decay = (n: number) => Math.max(0, 1 - t / n);
          if (lastDo.do === "bounce") dy = -Math.abs(Math.sin(t / 5)) * 70 * decay(40);
          if (lastDo.do === "shake") dx = Math.sin(t * 0.8) * 22 * decay(30);
          if (lastDo.do === "nod") dy = Math.sin(t / 3.5) * 16 * decay(30);
          if (lastDo.do === "wiggle") rot = Math.sin(t * 0.7) * 14 * decay(36);
        }
        // 出场：从两侧滑入（中间的从下面升起）
        const slide = (1 - ep) * (pos === "left" ? -280 : pos === "right" ? 280 : 0);
        const rise = pos === "center" ? (1 - ep) * 140 : 0;
        const bob = Math.sin(frame / 14 + (pos === "left" ? 0 : 2)) * 5; // 一直轻轻晃，显得是活的

        const mood = [...mine].reverse().find((a) => a.mood);
        const prop = [...mine].reverse().find((a) => a.prop);
        const sz = size * sc;
        const tag = c.tag;
        const side = pos === "right" ? -1 : 1;

        return (
          <React.Fragment key={c.id}>
            {/* 地面影子 */}
            <div style={{ position: "absolute", left: ax - sz * 0.38, top: ground - 8, width: sz * 0.76, height: 22, borderRadius: "50%", background: "rgba(31,58,95,0.16)", opacity: ep, transform: `scaleX(${1 - Math.abs(dy) / 260})` }} />
            <div style={{ position: "absolute", left: ax - sz / 2 + dx + slide, top: ground - sz + dy + rise + bob, width: sz, height: sz, opacity: Math.min(1, ep * 1.4), transform: `rotate(${rot}deg)`, transformOrigin: "50% 90%" }}>
              <Char id={look} size={sz} />
            </div>
            {tag && (
              <div style={{ position: "absolute", left: ax - 130, top: ground + 18, width: 260, textAlign: "center", fontFamily: FONT, fontWeight: 900, fontSize: 36, color: C.navy, opacity: ep }}>
                <span style={{ background: C.white, borderRadius: 999, padding: "2px 22px", boxShadow: "0 2px 0 rgba(31,58,95,0.18)" }}>{tag}</span>
              </div>
            )}
            {prop && (
              <div style={{ position: "absolute", left: ax + side * sz * 0.62 - 55, top: ground - sz * 0.5 - 55 + dy * 0.5, opacity: ramp(frame, prop.f, 10), transform: `scale(${0.5 + 0.5 * easeOut((frame - prop.f) / 12)})` }}>
                <AnimSticker name={prop.prop as string} size={110} from={prop.f} />
              </div>
            )}
            {mood && frame - mood.f < 140 && (
              <div style={{ position: "absolute", left: ax + sz * 0.22, top: ground - sz - 56 + dy, opacity: Math.min(1, ramp(frame, mood.f, 8)) * (frame - mood.f > 110 ? 1 - (frame - mood.f - 110) / 30 : 1), transform: `scale(${easeOut((frame - mood.f) / 10) * (1 + 0.08 * Math.sin((frame - mood.f) / 4))})` }}>
                <AnimSticker name={mood.mood as string} size={96} from={mood.f} />
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* 对话气泡 */}
      {talking &&
        (() => {
          const spk = cast.find((x) => x.id === talking.who);
          const pos = spk?.pos ?? "center";
          const ax = box.w * POS_X[pos];
          const bw = Math.min(box.w * 0.44, 600);
          const bx = Math.min(Math.max(ax - bw * 0.5 + (pos === "left" ? bw * 0.18 : pos === "right" ? -bw * 0.18 : 0), 20), box.w - bw - 20);
          const tailX = Math.min(Math.max(ax - bx, 40), bw - 40);
          const p = easeOut((frame - talking.f) / 10);
          const hasMine = actors.find((x) => x.c.id === talking.who)?.mine.length;
          if (!hasMine) return null;
          return (
            <div style={{ position: "absolute", left: bx, top: 28, width: bw, opacity: p, transform: `translateY(${(1 - p) * 14}px) scale(${0.92 + 0.08 * p})`, transformOrigin: `${tailX}px 100%` }}>
              <div style={{ background: C.white, border: `5px solid ${C.pink}`, borderRadius: 32, padding: "16px 26px", fontFamily: FONT, fontWeight: 800, fontSize: 40, lineHeight: 1.28, color: C.navy, textAlign: "center" }}>{talking.say}</div>
              <div style={{ position: "absolute", left: tailX - 18, bottom: -26, width: 0, height: 0, borderLeft: "18px solid transparent", borderRight: "18px solid transparent", borderTop: `28px solid ${C.pink}` }} />
              <div style={{ position: "absolute", left: tailX - 12, bottom: -16, width: 0, height: 0, borderLeft: "12px solid transparent", borderRight: "12px solid transparent", borderTop: "20px solid #fff" }} />
            </div>
          );
        })()}
    </div>
  );
};
