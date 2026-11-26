// 只渲染指定的几帧并拼成一张图，方便改完分镜或元素后快速看效果。
//   node scripts/quick-shots.mjs <arXiv 编号> gradient/g2+70 insight/i4+60 …     （场景/句子+偏移帧）
// 输出 projects/<id>/out/shots.jpg
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [id, ...specs] = process.argv.slice(2);
const root = `projects/${id}`;
const tl = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8"));
const frames = specs.map((spec) => {
  const m = spec.match(/^([^/]+)\/([^+]+)(?:\+(\d+))?$/);
  const sc = tl.scenes.find((s) => s.id === m[1]);
  const s = sc.sentences.find((x) => x.id === m[2]);
  return sc.start + s.local + +(m[3] ?? 0);
});
process.env.PATH += ";E:\\Program Files\\ffmpeg\\bin";
execFileSync("node", ["scripts/stills.mjs", "--comp", "Paper", "--input-props", `${root}/props.json`, "--frames", frames.join(","), "--prefix", "qs", "--out", `${root}/out`], { stdio: "inherit" });
const cols = 2;
const args = ["-y", "-loglevel", "error"];
frames.forEach((f) => args.push("-i", `${root}/out/qs_${f}.png`));
const layout = frames.map((_, i) => `${(i % cols) * 1440}_${Math.floor(i / cols) * 810}`).join("|");
args.push("-filter_complex", `${frames.map((_, i) => `[${i}]`).join("")}xstack=inputs=${frames.length}:layout=${layout},scale=1800:-1`, `${root}/out/shots.jpg`);
execFileSync("ffmpeg", args, { stdio: "inherit" });
console.log(`→ ${root}/out/shots.jpg（帧 ${frames.join(", ")}）`);
