import React from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import "./eqx.css";
import { interpolateColors, delayRender, continueRender } from "remotion";
import { ramp } from "../anim";
import { C, FONT } from "../theme";
import { T, getLang } from "./i18n";
import { useCue } from "../drpo/kit";
import { fitFont } from "./elements";
import { sanitizeTex } from "./rich2";
import { Sticker } from "../drpo/kit";
import { Char } from "./rich4";
import { AnimSticker } from "./AnimSticker";
import { HandLoop, WipeReveal } from "./hand";
import { FreeEl } from "./free";
import { MotionEl } from "./motion-code";
import type { Beat } from "./types";

type Box = { w: number; h: number };
type Rect = { l: number; t: number; w: number; h: number };

/** 取 s 从 i 开始的一组花括号 {…}，返回结束位置（含右括号）的下标，找不到返回 -1 */
function matchBrace(s: string, i: number): number {
  if (s[i] !== "{") return -1;
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "{") d++;
    else if (s[j] === "}" && --d === 0) return j;
  }
  return -1;
}

/** 去掉论文原式里的 \underbrace{X}_{英文注释} / \overbrace{X}^{…}，只留 X：英文注释会和中文标签叠在一起 */
export function stripBraceNotes(tex: string): string {
  let out = tex;
  for (const [cmd, sc] of [["\\underbrace", "_"], ["\\overbrace", "^"]] as const) {
    for (;;) {
      const at = out.indexOf(cmd + "{");
      if (at < 0) break;
      const s1 = at + cmd.length;
      const e1 = matchBrace(out, s1);
      if (e1 < 0) break;
      let end = e1;
      if (out[e1 + 1] === sc && out[e1 + 2] === "{") {
        const e2 = matchBrace(out, e1 + 2);
        if (e2 > 0) end = e2;
      }
      out = out.slice(0, at) + out.slice(s1 + 1, e1) + out.slice(end + 1);
    }
  }
  return out;
}

/** 把第 active 项用 \htmlClass{hlpart}{…} 包起来（各项按在公式里出现的先后顺序依次查找位置） */
function wrapActive(tex: string, parts: { tex: string }[], active: number | null): string {
  const src = stripBraceNotes(sanitizeTex(tex));
  if (active == null) return src;
  let from = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = stripBraceNotes(sanitizeTex(parts[i].tex));
    const at = src.indexOf(p, from);
    if (at < 0) continue;
    if (i === active) return `${src.slice(0, at)}\\htmlClass{hlpart}{${p}}${src.slice(at + p.length)}`;
    from = at + p.length;
  }
  return src;
}

// ---------------------------------------------------------------------------
// eqx:公式逐项讲解。整条公式放大居中；旁白讲到哪一项，那一项就高亮、其余变淡，
// 下面画一条下划线 + 名字标签，再用一行写"作用"、一行写"为什么"。
// 每一项出现的时间由程序按旁白里的关键词自动对齐（sync-formula-steps），不靠模型猜。
// ---------------------------------------------------------------------------
export const EqxEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const { frame, at, scene } = useCue();
  const parts = b.parts ?? [];
  // 插入演示：当前帧落在哪一段 insets 里（from 句开口 → to 句结束）。进入时公式缩小到上方，退出时恢复
  const insets = (b.insets ?? []).map((n) => {
    const a = scene.sentences.findIndex((s) => s.id === n.from), z = scene.sentences.findIndex((s) => s.id === n.to);
    const f0 = a >= 0 ? scene.sentences[a].local : 0;
    const f1 = z >= 0 && z + 1 < scene.sentences.length ? scene.sentences[z + 1].local : scene.dur;
    return { n, f0, f1 };
  });
  const activeInset = insets.find((x) => frame >= x.f0 && frame < x.f1 + 14) ?? null;
  const shrinkT = insets.reduce((m, x) => Math.max(m, ramp(frame, x.f0, 14) - ramp(frame, x.f1, 14)), 0);
  const SH = 1 - 0.26 * Math.max(0, Math.min(1, shrinkT)); // 公式缩放系数 1 → 0.74
  const steps = [...(b.partSteps ?? [])].map((s) => ({ ...s, f: at(s.at) })).sort((x, y) => x.f - y.f);
  let k = -1;
  steps.forEach((s, i) => {
    if (frame >= s.f) k = i;
  });
  const cur = k >= 0 ? steps[k] : null;
  const part = cur ? parts[cur.part] : null;
  const tt = cur ? ramp(frame, cur.f, 12) : 0;
  const enter = ramp(frame, at(b.at), 14);
  const wipeP = Math.min(1, Math.max(0, (frame - at(b.at) - 4) / 34)); // 公式"写出来"的进度，约 1 秒

  const html = React.useMemo(
    () => katex.renderToString(wrapActive(b.tex ?? "", parts, cur ? cur.part : null), { throwOnError: false, displayMode: true, strict: "ignore", output: "html", trust: (c: { command: string }) => c.command === "\\htmlClass" }),
    [b.tex, cur?.part], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const FW = box.w - 60;
  const FH = 290;
  const outer = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const [boxSize, setBoxSize] = React.useState<{ w: number; h: number } | null>(null); // 公式缩放前的布局尺寸，用来让蒙版盒子跟着缩放后的大小走（否则放大的公式两端被蒙版切掉）
  const [rects, setRects] = React.useState<Rect[]>([]);
  const [formB, setFormB] = React.useState(0);
  const [tick, setTick] = React.useState(0);
  const handle = React.useRef<number | null>(null);
  if (handle.current === null) handle.current = delayRender("eqx-fit");

  React.useLayoutEffect(() => {
    let alive = true;
    const run = () => {
      const el = inner.current;
      const ou = outer.current;
      if (!el || !ou) return;
      const w = el.offsetWidth || 1;
      const h = el.offsetHeight || 1;
      const want = Math.min(1.25, FW / w, FH / h);
      if (!boxSize || Math.abs(boxSize.w - w) > 0.5 || Math.abs(boxSize.h - h) > 0.5) setBoxSize({ w, h });
      if (Math.abs(want - scale) > 0.004) {
        setScale(want);
        return;
      }
      // 量出高亮部分的位置（换算成 outer 内的局部坐标，抵消镜头缓慢推近的缩放）
      const oRect = ou.getBoundingClientRect();
      const k2 = oRect.width / (ou.offsetWidth || 1);
      const list = Array.from(el.querySelectorAll(".hlpart")).map((n) => {
        // span 自己的外框不含分式的分母/上下标，要取所有后代元素的并集
        let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
        for (const d of [n, ...Array.from(n.querySelectorAll("*"))]) {
          const r = (d as HTMLElement).getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          L = Math.min(L, r.left);
          T = Math.min(T, r.top);
          R = Math.max(R, r.right);
          B = Math.max(B, r.bottom);
        }
        return { l: (L - oRect.left) / k2, t: (T - oRect.top) / k2, w: (R - L) / k2, h: (B - T) / k2 };
      });
      setRects(list);
      setFormB((el.getBoundingClientRect().bottom - oRect.top) / k2);
    };
    run();
    const fonts = (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts;
    (fonts?.ready ?? Promise.resolve()).then(() => {
      if (!alive) return;
      setTick((x) => x + 1);
      if (handle.current !== null) {
        continueRender(handle.current);
        handle.current = -1;
      }
    });
    return () => {
      alive = false;
    };
  }, [html, scale, tick, FW]);

  // 颜色按帧渐变：高亮部分 navy→pink，其余部分 navy→灰
  const dim = interpolateColors(tt, [0, 1], ["#1F3A5F", "#9AA9B5"]);
  const hl = interpolateColors(tt, [0, 1], ["#1F3A5F", "#D6336C"]);
  const pulse = 0.82 + 0.18 * Math.sin(frame / 5);
  const cssVars = { "--eqx-dim": part ? dim : "#1F3A5F", "--eqx-hl": hl, "--eqx-bg": `rgba(214,51,108,${(0.16 * tt * pulse).toFixed(3)})` } as React.CSSProperties;

  const union = rects.length
    ? { l: Math.min(...rects.map((r) => r.l)), r: Math.max(...rects.map((r) => r.l + r.w)), b: Math.max(...rects.map((r) => r.t + r.h)) }
    : null;
  // 高亮项的整体外接矩形（含上下左右），手绘圈用
  const unionBox = rects.length
    ? (() => {
        const l = Math.min(...rects.map((r) => r.l));
        const t = Math.min(...rects.map((r) => r.t));
        const r2 = Math.max(...rects.map((r) => r.l + r.w));
        const b2 = Math.max(...rects.map((r) => r.t + r.h));
        // 测出的区域在字符上方多出一截行高占位（下沿是准的）：只收上沿，圈才不会压到上一行，也不会切到字
        const hh = b2 - t;
        return { l, t: t + hh * 0.22, w: r2 - l, h: hh * 0.78 };
      })()
    : null;
  const pillText = part ? `${part.name}：${part.role}` : "";
  const pillW = Math.min(box.w - 40, [...pillText].length * 40 + 60);
  const pillX = union ? Math.min(Math.max((union.l + union.r) / 2 - pillW / 2, 10), box.w - pillW - 10) : 0;
  const pillY = union ? Math.min(Math.max(union.b, formB) + 26, FH + 20) : 0;

  return (
    <div style={{ width: box.w, height: box.h, position: "relative", opacity: Math.min(1, enter) }}>
      <div ref={outer} className="eqx" style={{ position: "absolute", left: 30, top: 0, width: FW, height: FH + 70, transform: `scale(${SH})`, transformOrigin: "50% 0%", ...cssVars }}>
        <div style={{ width: FW, height: FH, display: "flex", alignItems: "center", justifyContent: "center", overflow: "visible" }}>
          {/* 整条公式第一次出现时从左到右"写"出来（蒙版从左扫开）；测量位置用的是 inner，蒙版不影响布局 */}
          <WipeReveal p={wipeP} style={boxSize ? { display: "block", position: "relative", width: boxSize.w * scale, height: boxSize.h * scale, flexShrink: 0 } : { display: "inline-block" }}>
            <div ref={inner} style={boxSize ? { display: "inline-block", fontSize: 56, position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: "center center", whiteSpace: "nowrap" } : { display: "inline-block", fontSize: 56, transform: `scale(${scale})`, transformOrigin: "center center", whiteSpace: "nowrap" }} dangerouslySetInnerHTML={{ __html: html }} />
          </WipeReveal>
        </div>
        {/* 高亮部分的下划线 + 连接线 + 名字标签 */}
        {/* 手绘圈：围着高亮的这一项，笔画随旁白画出来（换一项就重新画一圈）。用整体外接矩形圈住，多段高亮时圈住全部 */}
        {part && unionBox && <HandLoop key={cur?.part} x={unionBox.l} y={unionBox.t} w={unionBox.w} h={unionBox.h} p={Math.min(1, tt * 1.3)} seed={(cur?.part ?? 0) * 7 + 3} pad={5} width={4} />}
        {part && union && (
          <>
            <div style={{ position: "absolute", left: (union.l + union.r) / 2 - 2, top: union.b + 14, width: 4, height: Math.max(0, pillY - union.b - 14), background: C.pink, opacity: tt }} />
            <div
              style={{
                position: "absolute",
                left: pillX,
                top: pillY,
                width: pillW,
                padding: "6px 14px",
                borderRadius: 999,
                background: C.pink,
                color: C.white,
                fontFamily: FONT,
                fontWeight: 900,
                fontSize: fitFont(pillText, pillW - 30, 40, 24),
                textAlign: "center",
                whiteSpace: "nowrap",
                opacity: tt,
                transform: `translateY(${(1 - tt) * 12}px)`,
                boxSizing: "border-box",
              }}
            >
              {pillText}
            </div>
          </>
        )}
      </div>

      {/* 插入演示：公式缩小后，下方整块给自由动画 */}
      {activeInset && (
        <div style={{ position: "absolute", left: 30, top: (FH + 70) * SH + 4, width: FW, height: box.h - (FH + 70) * SH - 4, opacity: Math.min(1, ramp(frame, activeInset.f0 + 4, 10)) * (1 - ramp(frame, activeInset.f1, 12)) }}>
          {activeInset.n.motion ? (
            <MotionEl b={{ ...b, kind: "canvas", form: "motion", motion: { w: 1600, h: 300, ...activeInset.n.motion }, at: activeInset.n.from, schematic: false }} box={{ w: FW, h: box.h - (FH + 70) * SH - 4 }} endF={activeInset.f1} />
          ) : (
            <FreeEl b={{ ...b, form: "free", objs: activeInset.n.objs ?? [], at: activeInset.n.from, schematic: false }} box={{ w: FW, h: box.h - (FH + 70) * SH - 4 }} fill />
          )}
        </div>
      )}
      {/* 下方：这一项为什么有这个作用 / 整条公式在干什么 */}
      <div style={{ position: "absolute", left: 30, top: FH + 90, width: FW, height: box.h - FH - 90, display: activeInset ? "none" : "flex", flexDirection: "column", justifyContent: "center", gap: 8, fontFamily: FONT }}>
        {part && cur ? (
          <div style={{ opacity: Math.min(1, tt * 1.5), display: "flex", alignItems: "center", gap: 24, height: "100%" }}>
            {/* 角色：每切到新的一项就蹦一下，用动作把"为什么"演出来 */}
            {part.actor && (
              <div style={{ position: "relative", width: 270, height: 190, flexShrink: 0 }}>
                <div style={{ position: "absolute", left: 30, bottom: 4, width: 130, height: 16, borderRadius: "50%", background: "rgba(31,58,95,0.16)" }} />
                <div style={{ position: "absolute", left: 0, top: 0, transform: `translateY(${-Math.abs(Math.sin((frame - cur.f) / 5)) * 36 * Math.max(0, 1 - (frame - cur.f) / 30) + Math.sin(frame / 14) * 3}px)` }}>
                  <Char id={part.actor.look} size={176} />
                </div>
                {part.actor.mood && (
                  <div style={{ position: "absolute", left: 172, top: 0, transform: `scale(${ramp(frame, cur.f + 6, 8)})` }}>
                    <AnimSticker name={part.actor.mood} size={72} from={cur.f + 6} />
                  </div>
                )}
                {part.actor.prop && (
                  <div style={{ position: "absolute", left: 172, top: 92, transform: `scale(${ramp(frame, cur.f + 10, 8)})` }}>
                    <AnimSticker name={part.actor.prop} size={84} from={cur.f + 10} />
                  </div>
                )}
              </div>
            )}
            {/* 对话气泡：这一项为什么有这个作用 */}
            <div style={{ flex: 1, position: "relative", transform: `translateX(${(1 - tt) * 24}px)` }}>
              <div style={{ display: "inline-block", background: C.navy, color: C.white, borderRadius: 999, padding: "2px 18px", fontSize: 26, fontWeight: 900, marginBottom: 8 }}>
                {T().partOf(cur.part + 1, parts.length)}
              </div>
              <div style={{ background: C.white, border: `4px solid ${C.pink}`, borderRadius: 28, padding: "12px 24px", fontSize: fitFont(`${T().why}${part.why}`, FW - 330, 40, 26), fontWeight: 800, color: C.navy, lineHeight: 1.25 }}>{T().why}{part.why}</div>
            </div>
          </div>
        ) : (
          <div style={{ opacity: ramp(frame, at(b.at) + 6, 14), fontSize: fitFont(b.overview ?? "", FW - 40, 46, 28), fontWeight: 900, color: C.navy, textAlign: "center" }}>
            {b.overview}
          </div>
        )}
      </div>
    </div>
  );
};
