import React from "react";
import { staticFile, useVideoConfig } from "remotion";
import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { C, FONT } from "../theme";
import { T, getLang } from "./i18n";
import { useCue } from "../drpo/kit";
import { prog } from "../anim";
import { cueAt } from "./canvas";
import { buildMotion } from "./motion-runtime.mjs";
import type { Beat } from "./types";

gsap.registerPlugin(MotionPathPlugin, DrawSVGPlugin, MorphSVGPlugin);

type Box = { w: number; h: number };

/**
 * 动画代码镜头（canvas 的 form:"motion"）：模型写的 HTML + CSS + GSAP 时间线脚本，逐帧 seek。
 * 做法来自 OpenMotion：结构用 HTML/SVG，动作用一条暂停的 GSAP 时间线，渲染器按帧定位，不实时播放。
 * cue("句子id@短语") 取旁白里这个动作开口的秒数（相对本镜头起点），所以动画和配音精确对时。
 */
export const MotionEl: React.FC<{ b: Beat; box: Box; endF?: number }> = ({ b, box, endF }) => {
  const { frame, scene } = useCue();
  const { fps } = useVideoConfig();
  const m = b.motion;
  const W = m?.w ?? 1600, H = m?.h ?? 520;
  const k = Math.min(box.w / W, box.h / H);
  const ox = (box.w - W * k) / 2, oy = (box.h - H * k) / 2;
  const root = React.useRef<HTMLDivElement>(null);
  const built = React.useRef<{ seek: (s: number) => void; dispose: () => void } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const startF = cueAt(scene, b.at);
  // 动画持续到哪里：公式下方的演示动画（insets）只持续它那几句，传入 endF；单独的镜头到场景结束。检查器用的 dur 要和这里一致
  const durSec = Math.max(1, ((endF ?? scene.dur) - startF) / fps);

  // 搭建一次（模型写的代码有问题时显示在画面里并抛到控制台，不让整片渲染崩掉）
  React.useLayoutEffect(() => {
    if (!root.current || !m) return;
    try {
      built.current = buildMotion({
        root: root.current,
        html: m.html,
        css: m.css ?? "",
        script: m.script,
        gsap,
        cue: (ref: string) => (cueAt(scene, ref) - startF) / fps,
        assetUrl: (p: string) => staticFile(p),
        W,
        H,
        dur: durSec,
      });
      setErr(null);
    } catch (e) {
      built.current = null;
      setErr(String((e as Error).message ?? e));
      // eslint-disable-next-line no-console
      console.error("[motion] 构建失败：", e);
    }
    return () => {
      built.current?.dispose();
      built.current = null;
    };
  }, [m?.html, m?.css, m?.script, startF]); // eslint-disable-line react-hooks/exhaustive-deps

  // 每一帧：时间线定位到这一刻
  React.useLayoutEffect(() => {
    built.current?.seek((frame - startF) / fps);
  });

  const enterB = Math.min(1, prog(frame, startF, 10, "out"));
  return (
    <div style={{ width: box.w, height: box.h, position: "relative", opacity: enterB }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 32, background: "rgba(255,255,255,0.55)", border: "3px solid rgba(31,58,95,0.10)" }} />
      <div style={{ position: "absolute", left: ox, top: oy, width: W, height: H, transform: `scale(${k})`, transformOrigin: "0 0", overflow: "visible" }}>
        <div ref={root} style={{ position: "relative", width: W, height: H, fontFamily: FONT, color: C.navy, overflow: "visible" }} />
      </div>
      {err && <div style={{ position: "absolute", left: 20, bottom: 14, right: 20, fontFamily: FONT, fontSize: 22, color: C.pink, fontWeight: 800 }}>{T().codeError}{err.slice(0, 160)}</div>}
      {b.schematic !== false && <div style={{ position: "absolute", right: 22, bottom: 14, fontFamily: FONT, fontWeight: 800, fontSize: 24, color: C.navy, opacity: 0.45, letterSpacing: getLang() === "en" ? 0.5 : 2 }}>{T().schematic}</div>}
    </div>
  );
};
