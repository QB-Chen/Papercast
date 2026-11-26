// 从时间线里为每个场景挑 N 个有代表性的帧（均匀取句子，句子开始后约 1.7 秒），并拼成每场景一张联系图。
//   node scripts/sample-frames.mjs src/drpo2/timeline.json 8 > frames.txt      → 打印 "场景:帧,帧,…" 每行一个场景
//   node scripts/sample-frames.mjs --sheets src/drpo2/timeline.json 8 out/d2    → 用已渲染的 out/d2_<帧>.png 拼图 out/d2_sheet_<场景>.jpg
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const a = process.argv.slice(2);
const sheets = a[0] === "--sheets";
if (sheets) a.shift();
const tl = JSON.parse(readFileSync(a[0], "utf8"));
const n = +(a[1] ?? 8);
const prefix = a[2] ?? "out/d2";

const pick = (sc) => {
  const k = Math.min(n, sc.sentences.length);
  const out = [];
  for (let i = 0; i < k; i++) {
    const s = sc.sentences[Math.floor(((i + 0.5) * sc.sentences.length) / k)];
    out.push({ id: s.id, text: s.text, frame: sc.start + s.local + 50 });
  }
  return out;
};

if (!sheets) {
  for (const sc of tl.scenes) console.log(`${sc.id}:${pick(sc).map((p) => p.frame).join(",")}`);
} else {
  const cols = 3;
  for (const sc of tl.scenes) {
    const ps = pick(sc);
    const args = ["-y", "-loglevel", "error"];
    for (const p of ps) args.push("-i", `${prefix}_${p.frame}.png`);
    const rows = Math.ceil(ps.length / cols);
    const layout = ps.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => "w0").join("+") : "0"}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => "h0").join("+") : "0"}`).join("|");
    const inputs = ps.map((_, i) => `[${i}]`).join("");
    args.push("-filter_complex", `${inputs}xstack=inputs=${ps.length}:layout=${layout},scale=1800:-1`, `${prefix}_sheet_${sc.id}.jpg`);
    execFileSync("ffmpeg", args, { stdio: "inherit" });
    console.log(`${prefix}_sheet_${sc.id}.jpg  (${rows} 行)  句子：${ps.map((p) => p.id).join(",")}`);
  }
}
