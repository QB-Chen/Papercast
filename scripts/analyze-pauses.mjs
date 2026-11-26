// 分析每句配音里的"句中停顿":用 ffmpeg silencedetect 找出句子内部(去掉头尾)的静音段，
// 并统计语速(字/秒)，对照文本里的标点，看停顿是不是发生在逗号处。
//   node scripts/analyze-pauses.mjs narration/drpo2.json [--dir public/audio/drpo2] [--min 0.2] [--db -35]
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const a = process.argv.slice(2);
const flag = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const narr = JSON.parse(readFileSync(a[0], "utf8"));
const dir = flag("--dir", "public/audio/drpo2");
const minD = +flag("--min", 0.2);
const db = flag("--db", "-35");

const rows = [];
for (const sc of narr.scenes)
  for (const s of sc.sentences) {
    const wav = join(dir, `${s.id}.wav`);
    const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", wav, "-af", `silencedetect=noise=${db}dB:d=${minD}`, "-f", "null", "-"], { encoding: "utf8" });
    const log = r.stderr;
    const dur = +((log.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? []).slice(1).reduce((t, v, i) => t + +v * [3600, 60, 1][i], 0));
    const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
    const ends = [...log.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((m) => ({ end: +m[1], len: +m[2] }));
    const pauses = [];
    starts.forEach((st, i) => {
      const e = ends[i];
      const len = e ? e.len : dur - st;
      const endAt = e ? e.end : dur;
      // 去掉开头和结尾的静音
      if (st < 0.15 || endAt > dur - 0.15) return;
      pauses.push({ at: +st.toFixed(2), len: +len.toFixed(2), frac: +(st / dur).toFixed(2) });
    });
    const chars = [...s.text.replace(/[，。？！；：、,.?!;:\s]/g, "")].length;
    const commas = (s.text.match(/[，；：、]/g) ?? []).length;
    rows.push({ id: s.id, text: s.text, dur: +dur.toFixed(2), cps: +(chars / dur).toFixed(2), commas, pauses });
  }

writeFileSync("out/pauses.json", JSON.stringify(rows, null, 2));
const all = rows.flatMap((r) => r.pauses.map((p) => ({ id: r.id, ...p })));
const withPause = rows.filter((r) => r.pauses.length);
const longP = all.filter((p) => p.len >= 0.4);
const cps = rows.map((r) => r.cps).sort((x, y) => x - y);
console.log(`共 ${rows.length} 句；语速(字/秒，原始合成，未变速)：中位 ${cps[Math.floor(cps.length / 2)]}，最慢 ${cps[0]}，最快 ${cps.at(-1)}`);
console.log(`句中有 ≥${minD}s 静音的句子：${withPause.length} 句；≥0.4s 的长停顿：${longP.length} 处`);
const noComma = withPause.filter((r) => r.commas === 0);
console.log(`其中文本里没有逗号/分号/冒号、却有句中停顿的：${noComma.length} 句`);
for (const r of rows.filter((r) => r.pauses.some((p) => p.len >= 0.4)).slice(0, 40)) {
  console.log(`[${r.id}] ${r.dur}s 逗号${r.commas}个 停顿${r.pauses.map((p) => `${p.at}s(${p.len}s)`).join(" ")}  ${r.text}`);
}
