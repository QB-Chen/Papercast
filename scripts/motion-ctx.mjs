// 一个演示的上下文：句子、时长、cue 解析、导演动作的时刻。gen-motion 之外的脚本（看图评审、重检）共用。
import { readFileSync } from "node:fs";
import { estimateSec } from "./canvas-compile.mjs";
import { existsSync } from "node:fs";

/** 和渲染器 cueAt 完全一致：返回相对场景起点的帧数。ref 形如 "d1" / "d1+30" / "d1#2" / "d1@短语" / "d1@短语+10" */
export function realCue(scene, ref) {
  const m = String(ref).match(/^([^+#@]+)(?:([+#@])(.*))?$/);
  if (!m) return NaN;
  const s = scene.sentences.find((x) => x.id === m[1]);
  if (!s) return NaN;
  if (!m[2]) return s.local;
  if (m[2] === "+") return s.local + Number(m[3]);
  const caps = s.caps && s.caps.length ? s.caps : [{ at: 0, text: s.text }];
  if (m[2] === "#") return s.local + (caps[Number(m[3])]?.at ?? 0);
  const off = m[3].match(/^(.*)\+(\d+)$/);
  const phrase = off ? off[1] : m[3], extra = off ? Number(off[2]) : 0;
  for (let i = 0; i < caps.length; i++) {
    const idx = caps[i].text.indexOf(phrase);
    if (idx < 0) continue;
    const end = i + 1 < caps.length ? caps[i + 1].at : s.dur;
    return s.local + extra + Math.round(caps[i].at + ((end - caps[i].at) * idx) / Math.max(1, caps[i].text.length));
  }
  const whole = s.text.indexOf(phrase);
  if (whole >= 0) return s.local + extra + Math.round((s.onset ?? 0) + ((s.dur - (s.onset ?? 0)) * whole) / Math.max(1, s.text.length));
  return NaN;
}

export function demoContext(id, sceneId, fromId) {
  const root = `projects/${id}`;
  const tl = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8")).scenes.find((s) => s.id === sceneId);
  const demos = JSON.parse(readFileSync(`${root}/narration/demos.json`, "utf8"))[sceneId] ?? [];
  const demo = demos.find((d) => d.from === fromId);
  if (!demo) throw new Error(`demos.json 里 ${sceneId} 没有从 ${fromId} 开始的演示`);
  const ids = tl.sentences.map((s) => s.id);
  const texts = Object.fromEntries(tl.sentences.map((s) => [s.id, s.text]));
  const a = ids.indexOf(demo.from), z = ids.indexOf(demo.to);
  const sents = tl.sentences.slice(a, z + 1);
  const fps = 30;
  const startF = realCue(tl, demo.from);
  const endF = sents.length ? sents[sents.length - 1].local + sents[sents.length - 1].dur : startF; // 这个演示最后一句结束的帧
  const durSec = Math.max(1, (endF - startF) / fps); // 真实时长（不再按字数估算，所以任何语言都准）
  const lang = JSON.parse(readFileSync(`${root}/plan.json`, "utf8").replace(/^\uFEFF/, "")).lang ?? process.env.VIDEO_LANG ?? "zh";
  function cuesOf(script) {
    const out = {};
    for (const m of String(script).matchAll(/cue\(\s*(["'`])([^"'`]*?)\1\s*\)/g)) {
      const ref = m[2], mm = ref.match(/^([^@]+)@(.+)$/);
      const okRef = mm && ids.slice(a, z + 1).includes(mm[1]) && texts[mm[1]].includes(mm[2].replace(/\+\d+$/, ""));
      const f = okRef || /^[A-Za-z]+\d+$/.test(ref) ? realCue(tl, ref) : NaN;
      out[ref] = Number.isFinite(f) ? (f - startF) / fps : NaN;
    }
    return out;
  }
  const beatSecsFor = (plan) => plan.beats.map((b) => ({ ref: b.at, what: b.change, sec: (realCue(tl, b.at) - startF) / fps }));
  // 舞台高度：演示落在公式（eqx）讲解范围里 → 放在公式下方的演示区（1600×300）；否则是整块画布（1600×520）
  let inEqx = false;
  const bf = `${root}/storyboards/${sceneId}.json`;
  if (existsSync(bf)) {
    const board = JSON.parse(readFileSync(bf, "utf8"));
    const cs = board.beats.filter((x) => x.slot === "C").map((x) => ({ x, i: ids.indexOf(x.at) })).sort((p, q) => p.i - q.i);
    cs.forEach((c, k) => { const end = (cs[k + 1]?.i ?? ids.length) - 1; if ((c.x.kind === "eqx") && c.i <= z && end >= a) inEqx = true; });
  }
  const stageW = 1600, stageH = inEqx ? 300 : 520;
  return { root, tl, demo, ids, texts, sents, durSec, cuesOf, beatSecsFor, inEqx, stageW, stageH, lang, startF };
}
