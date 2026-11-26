// 把 "场景/句子+偏移帧" 换算成成片里的绝对帧号，方便只渲染想看的几帧。
//   node scripts/frame-at.mjs src/drpo2/timeline.json hook/h7+45 dppo/d5+70
import { readFileSync } from "node:fs";
const [file, ...specs] = process.argv.slice(2);
const tl = JSON.parse(readFileSync(file, "utf8"));
const out = specs.map((spec) => {
  const m = spec.match(/^([^/]+)\/([^+]+)(?:\+(\d+))?$/);
  if (!m) throw new Error(`格式应为 场景/句子+偏移，收到 ${spec}`);
  const sc = tl.scenes.find((s) => s.id === m[1]);
  const s = sc?.sentences.find((x) => x.id === m[2]);
  if (!s) throw new Error(`找不到 ${m[1]}/${m[2]}`);
  return sc.start + s.local + +(m[3] ?? 0);
});
console.log(out.join(","));
