// 成片音轨质检:按时间线把成片(mp4)里每句话的那一段音频切出来，用 XingChen ASR 转写，和旁白原稿比对。
//   node scripts/check-video-audio.mjs out/drpo2.mp4 src/drpo2/timeline.json narration/drpo2.json
// 这检查的是最终成片里真正听到的内容(含变速、拼接、时间对齐)，而不是单句合成的中间文件。
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { asrFile, score } from "./lib.mjs";

const [video, tlFile, narrFile] = process.argv.slice(2);
const tl = JSON.parse(readFileSync(tlFile, "utf8"));
const narr = JSON.parse(readFileSync(narrFile, "utf8"));
const spoken = Object.fromEntries(narr.scenes.flatMap((sc) => sc.sentences.map((s) => [s.id, s.speak ?? s.text])));
const tmp = join("out", "vac");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const items = tl.scenes.flatMap((sc) => sc.sentences.map((s) => ({ ...s, scene: sc.id, abs: s.start })));
const queue = [...items];
const results = [];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      const wav = join(tmp, `${s.id}.wav`);
      // 前后各多取 0.15 秒，避免切头切尾
      const t0 = Math.max(0, s.abs / tl.fps - 0.15);
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", t0.toFixed(3), "-t", (s.dur / tl.fps + 0.3).toFixed(3), "-i", video, "-vn", "-ac", "1", "-ar", "16000", wav]);
      try {
        const heard = await asrFile(wav);
        results.push({ id: s.id, scene: s.scene, score: score(spoken[s.id] ?? s.text, heard), want: spoken[s.id] ?? s.text, heard });
      } catch (e) {
        results.push({ id: s.id, scene: s.scene, score: -1, want: spoken[s.id], heard: `ERROR ${e.message}` });
      }
    }
  }),
);
results.sort((a, b) => a.score - b.score);
writeFileSync(join("out", "video-audio-check.json"), JSON.stringify(results, null, 2));
const avg = results.reduce((a, b) => a + Math.max(b.score, 0), 0) / results.length;
const bad = results.filter((r) => r.score < 0.8);
console.log(`共 ${results.length} 句，成片音轨平均重合度 ${avg.toFixed(3)}，低于 0.8 的有 ${bad.length} 句`);
for (const r of results.slice(0, 12)) console.log(`[${r.id}] ${r.score.toFixed?.(2)}\n  原稿: ${r.want}\n  听到: ${r.heard}`);
