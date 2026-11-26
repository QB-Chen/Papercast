import React from "react";
import { C, FONT } from "../theme";
import { Sticker, useCue } from "../drpo/kit";
import type { Beat, SideSpec, Tone } from "./types";

const MATH = '"Cambria Math", "Times New Roman", "Microsoft YaHei", serif';

export const TONE: Record<Tone, string> = {
  teal: C.teal,
  orange: C.orange,
  pink: C.pink,
  navy: C.navy,
  gray: C.gray,
};
const tone = (t?: Tone, fallback: Tone = "teal") => TONE[t ?? fallback];
const ease01 = (frame: number, start: number, dur: number): number => Math.min(1, Math.max(0, (frame - start) / dur)) ** 0.6;

/** 按文字长度估算合适字号,保证一行放得下(中文按 1 个字≈1 个字号宽,字母数字按 0.55 计) */
export function fitFont(text: string, maxW: number, maxSize: number, minSize = 22): number {
  let w = 0;
  for (const ch of text) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.58;
  const size = Math.floor(maxW / Math.max(w, 1));
  return Math.max(minSize, Math.min(maxSize, size));
}

/** 解析 **加粗强调**:返回带高亮的片段 */
export function emph(text: string, color: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") ? (
      <span key={i} style={{ color, fontWeight: 900 }}>
        {p.slice(2, -2)}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/** 解析 {{高亮}}:公式里的重点部分 */
function formulaNodes(text: string, color: string): React.ReactNode {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((p, i) =>
    p.startsWith("{{") ? (
      <span key={i} style={{ color, background: "rgba(214,51,108,0.12)", borderRadius: 10, padding: "0 8px" }}>
        {p.slice(2, -2)}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

type Box = { w: number; h: number };

// ---- 1. text:一句大字 ----
const TextEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const text = b.text ?? "";
  const plain = text.replace(/\*\*/g, "");
  const size = fitFont(plain, box.w - 40, box.h > 200 ? 84 : 66, 34);
  return (
    <div style={{ width: box.w, height: box.h, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ fontSize: size, fontWeight: 900, color: C.navy, lineHeight: 1.25 }}>{emph(text, tone(b.tone, "pink"))}</div>
    </div>
  );
};

// ---- 2. card:带标题和要点的卡片(字号随卡片大小放大,内容居中) ----
const CardEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const color = tone(b.tone);
  const lines = b.lines ?? [];
  const big = box.w > 1200 || box.h >= 500; // 中央大卡片，或被拉高的整侧卡片
  const padX = 36, padY = 20, gap = big ? 48 : 28;
  const innerH = box.h - 10 - padY * 2;
  const longest = Math.max(...lines.map((l) => l.replace(/\*\*/g, "").length), 1);
  // 贴图宽度：不超过卡片高度的一半，也不超过卡片宽度的 28%，更不能把文字挤得没地方放
  let stickerSize = b.sticker ? Math.min(big ? 260 : 130, innerH * 0.62, box.w * 0.28) : 0;
  const textWFor = (sz: number) => box.w - 10 - padX * 2 - (sz ? sz + gap : 0);
  let textW = textWFor(stickerSize);
  // 文字字号：宽度够放下最长的一行，且整块文字（标题 + 各行）高度放得进卡片
  const maxLine = big ? 62 : 40;
  const fit = (w: number) => {
    let lf = Math.max(24, Math.min(maxLine, Math.floor(w / longest)));
    let tf = fitFont(b.title ?? "", w, big ? 74 : 44, 28);
    const h = (l: number, t: number) => (b.title ? t * 1.3 + (big ? 18 : 8) : 0) + lines.length * l * 1.5;
    while (h(lf, tf) > innerH && lf > 22) {
      lf -= 2;
      tf = Math.max(24, tf - 2);
    }
    return { lf, tf, h: h(lf, tf) };
  };
  let f = fit(textW);
  // 文字块已经顶满，还有贴图：把贴图缩小一点，给文字腾出宽度
  while (b.sticker && f.lf < Math.min(maxLine, 40) && stickerSize > 80) {
    stickerSize -= 20;
    textW = textWFor(stickerSize);
    f = fit(textW);
  }
  const lineFont = f.lf;
  const titleFont = f.tf;
  return (
    <div
      style={{
        width: box.w,
        height: box.h,
        boxSizing: "border-box",
        borderRadius: 28,
        background: "rgba(255,255,255,0.9)",
        border: `5px solid ${color}`,
        padding: "20px 36px",
        display: "flex",
        gap: 40,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {b.sticker && <Sticker name={b.sticker} size={stickerSize} />}
      <div style={{ minWidth: 0 }}>
        {b.title && <div style={{ fontSize: titleFont, fontWeight: 900, color, marginBottom: big ? 18 : 8 }}>{b.title}</div>}
        {lines.map((l, i) => (
          <div key={i} style={{ fontSize: lineFont, fontWeight: 700, color: C.navy, lineHeight: 1.5 }}>
            {emph(l, color)}
          </div>
        ))}
      </div>
    </div>
  );
};
// ---- 3. formula:公式(可高亮)+ 说明 ----
const FormulaEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const f = b.formula ?? "";
  const plain = f.replace(/\{\{|\}\}/g, "");
  const size = fitFont(plain, box.w - 60, box.h > 200 ? 82 : 58, 30);
  return (
    <div style={{ width: box.w, height: box.h, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
      <div style={{ fontSize: size, fontWeight: 700, color: C.navy, fontFamily: MATH, whiteSpace: "nowrap" }}>{formulaNodes(f, tone(b.tone, "pink"))}</div>
      {b.note && <div style={{ fontSize: fitFont(b.note, box.w - 60, 36, 24), fontWeight: 800, color: tone(b.tone, "teal") }}>{b.note}</div>}
    </div>
  );
};

// ---- 4. compare:左右对比 ----
/**
 * 贴图 + 文字的竖排版面：先算出文字要占多少高度，剩下的空间才给贴图，保证加起来放得进卡片，不挤也不被切。
 * 贴图剩的空间太小时，先把文字整体缩小，再重算。返回贴图大小和文字缩放系数。
 */
export function stackLayout(availH: number, textHeights: number[], gap: number, maxSticker: number, minSticker = 90) {
  const total = (k: number) => textHeights.reduce((a, h) => a + h * k, 0) + gap * textHeights.length; // 每段文字后一个间距（含贴图和文字之间）
  let k = 1;
  let st = Math.min(maxSticker, availH - total(k));
  while (st < minSticker && k > 0.55) {
    k -= 0.1;
    st = Math.min(maxSticker, availH - total(k));
  }
  return { sticker: Math.max(0, Math.floor(st)), k };
}

const Side: React.FC<{ s: SideSpec; box: Box }> = ({ s, box }) => {
  const color = tone(s.tone);
  const bigBox = box.h > 400;
  const tF = fitFont(s.title, box.w - 60, bigBox ? 72 : 42, 26);
  const bF = s.big ? fitFont(s.big, box.w - 60, bigBox ? 120 : 66, 30) : 0;
  const sF = s.small ? fitFont(s.small, box.w - 60, bigBox ? 46 : 32, 22) : 0;
  const lay = stackLayout(box.h - 24 - 10, [tF * 1.3, bF * 1.25, sF * 1.4].filter((h) => h > 0), 8, bigBox ? 260 : 150, bigBox ? 110 : 60);
  const st = s.sticker ? lay.sticker : 0;
  const k = s.sticker ? lay.k : 1;
  return (
    <div
      style={{
        width: box.w,
        height: box.h,
        boxSizing: "border-box",
        borderRadius: 28,
        background: "rgba(255,255,255,0.9)",
        border: `5px solid ${color}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "12px 18px",
        overflow: "hidden",
      }}
    >
      {s.sticker && st > 0 && <Sticker name={s.sticker} size={st} />}
      <div style={{ fontSize: Math.round(tF * k), lineHeight: 1.3, fontWeight: 900, color }}>{s.title}</div>
      {s.big && <div style={{ fontSize: Math.round(bF * k), lineHeight: 1.25, fontWeight: 900, color: C.navy, fontFamily: MATH }}>{s.big}</div>}
      {s.small && <div style={{ fontSize: Math.round(sF * k), lineHeight: 1.4, fontWeight: 700, color: C.gray, textAlign: "center" }}>{s.small}</div>}
    </div>
  );
};

const CompareEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const vsW = 150;
  const sideW = (box.w - vsW) / 2;
  return (
    <div style={{ width: box.w, height: box.h, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {b.left && <Side s={b.left} box={{ w: sideW, h: box.h }} />}
      <div style={{ width: vsW, textAlign: "center", fontSize: (b.vs ?? "VS").length > 2 ? 40 : 54, fontWeight: 900, color: C.pink }}>{b.vs ?? "VS"}</div>
      {b.right && <Side s={b.right} box={{ w: sideW, h: box.h }} />}
    </div>
  );
};

// ---- 5. dots:用点点表示"一共多少个,其中几个" ----
const DotsEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const total = Math.max(1, Math.min(b.total ?? 100, 200));
  const marked = Math.max(0, Math.min(b.marked ?? 0, total));
  const cols = total <= 20 ? total : total <= 50 ? 10 : 20;
  const rows = Math.ceil(total / cols);
  const cell = Math.min(Math.floor((box.w - 80) / cols), Math.floor((box.h - 110) / rows), total <= 20 ? 150 : 56);
  const { frame, at } = useCue();
  const t0 = at(b.at) + 14;
  const stepF = Math.min(3, 40 / Math.max(Math.ceil(marked), 1));
  const color = tone(b.tone, "pink");
  return (
    <div style={{ width: box.w, height: box.h, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${cell}px)`, gap: 4 }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{ width: cell, height: cell, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div
              style={{
                width: cell * 0.74,
                height: cell * 0.74,
                borderRadius: "50%",
                // marked 可以是小数：第 floor(marked) 个点按小数部分从左到右部分填充（如 7.8 → 7 个满点 + 1 个填 80% 的点）
                background:
                  i + 1 <= Math.floor(marked) && frame >= t0 + i * stepF
                    ? color
                    : i === Math.floor(marked) && marked % 1 > 0 && frame >= t0 + i * stepF
                      ? `linear-gradient(90deg, ${color} ${(marked % 1) * 100}%, #C9D5D8 ${(marked % 1) * 100}%)`
                      : "#C9D5D8",
              }}
            />
          </div>
        ))}
      </div>
      {b.label && <div style={{ fontSize: fitFont(b.label, box.w - 40, 38, 24), fontWeight: 900, color: C.navy }}>{b.label}</div>}
      {b.unitNote && <div style={{ fontSize: 26, fontWeight: 700, color: C.gray }}>{b.unitNote}</div>}
    </div>
  );
};

// ---- 6. bars:横向条形对比(条长严格按 value 比例,最短保留 6px 以免看不见) ----
const BarsEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const items = b.items ?? [];
  const big = box.w > 1200;
  const { frame, at } = useCue();
  const grow = ease01(frame, at(b.at) + 8, 30);
  const rowH = Math.min(big ? 150 : 86, Math.floor((box.h - 20) / Math.max(items.length, 1)));
  const labelW = Math.min(big ? 340 : 260, box.w * 0.3);
  const valueW = big ? 300 : 200;
  const barMax = box.w - labelW - valueW - 40;
  return (
    <div style={{ width: box.w, height: box.h, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", height: rowH }}>
          <div style={{ width: labelW, fontSize: fitFont(it.label, labelW - 10, big ? 54 : 38, 24), fontWeight: 800, color: C.navy }}>{it.label}</div>
          <div style={{ width: barMax, height: rowH * 0.52, background: "#DDE7E8", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: Math.max(6, barMax * Math.max(0, Math.min(1, it.value)) * grow), height: "100%", background: tone(it.tone) }} />
          </div>
          <div style={{ width: valueW, paddingLeft: 18, fontSize: fitFont(it.display ?? "", valueW - 20, big ? 50 : 36, 22), fontWeight: 900, color: tone(it.tone), fontFamily: MATH }}>{it.display ?? ""}</div>
        </div>
      ))}
    </div>
  );
};
// ---- 7. flow:一串步骤,用箭头连接 ----
const FlowEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const steps = b.steps ?? [];
  const n = Math.max(steps.length, 1);
  const arrowW = 56;
  const cardW = Math.floor((box.w - arrowW * (n - 1)) / n);
  const bigBox = box.h > 400;
  const cardH = Math.min(box.h, bigBox ? 400 : 270); // 之前固定 270，贴图 200 加文字 75 就超了
  // 每张卡片：文字按最长的一张定字号，剩下的高度给贴图
  const textFonts = steps.map((s) => fitFont(s.text, cardW - 40, bigBox ? 60 : 36, 22));
  const tF = Math.min(...textFonts, 999);
  const lay = stackLayout(cardH - 20 - 10, [tF * 1.3], 8, bigBox ? 200 : 110, bigBox ? 100 : 56);
  const st = lay.sticker;
  return (
    <div style={{ width: box.w, height: box.h, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div
            style={{
              width: cardW,
              height: cardH,
              boxSizing: "border-box",
              borderRadius: 24,
              background: "rgba(255,255,255,0.9)",
              border: `5px solid ${tone(s.tone)}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "10px 12px",
              overflow: "hidden",
            }}
          >
            {s.sticker && st > 0 && <Sticker name={s.sticker} size={st} />}
            <div style={{ fontSize: Math.round(tF * lay.k), fontWeight: 900, color: C.navy, textAlign: "center", lineHeight: 1.3 }}>{s.text}</div>
          </div>
          {i < n - 1 && <div style={{ width: arrowW, textAlign: "center", fontSize: 48, fontWeight: 900, color: C.teal }}>→</div>}
        </React.Fragment>
      ))}
    </div>
  );
};

// ---- 8. sticker:一到三个大贴图,可带说明 ----
const StickerEl: React.FC<{ b: Beat; box: Box }> = ({ b, box }) => {
  const list = b.stickers ?? [];
  const n = Math.max(list.length, 1);
  const size = Math.min(Math.floor(box.h * 0.6), Math.floor((box.w / n) * 0.62), 220);
  return (
    <div style={{ width: box.w, height: box.h, display: "flex", alignItems: "center", justifyContent: "center", gap: 70 }}>
      {list.map((s, i) => (
        <div key={i} style={{ textAlign: "center" }}>
          <Sticker name={s.name} size={size} />
          {s.caption && <div style={{ fontSize: fitFont(s.caption, size * 1.6, 38, 24), fontWeight: 900, color: C.navy, marginTop: 6 }}>{s.caption}</div>}
        </div>
      ))}
    </div>
  );
};

export const ELEMENTS: Partial<Record<Beat["kind"], React.FC<{ b: Beat; box: Box }>>> = {
  text: TextEl,
  card: CardEl,
  formula: FormulaEl,
  compare: CompareEl,
  dots: DotsEl,
  bars: BarsEl,
  flow: FlowEl,
  sticker: StickerEl,
};
