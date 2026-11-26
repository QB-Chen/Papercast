// 配音质检:把每句合成的音频用 XingChen ASR 转写回文字,和旁白原稿比字符重合度。
//   node scripts/check-voice.mjs [narration/drpo.json]
// 重合度低的句子多半是读错、漏读或吞字,结果写到 out/voice-check.json 供人工复查。
// 注意:ASR 自己也会听错(比如「它/他」),得分只是线索,不是定论。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { asrFile, score } from "./lib.mjs";

const file = process.argv[2] ?? "narration/drpo.json";
const name = basename(file, ".json");
const narr = JSON.parse(readFileSync(file, "utf8"));

const items = narr.scenes.flatMap((sc) => sc.sentences);
const results = [];
const queue = [...items];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      const want = s.speak ?? s.text;
      try {
        // 有变速时质检变速后的版本,因为成片用的是它
        const dir = (narr.tempo ?? 1) === 1 ? join("public", "audio", name) : join("public", "audio", name, "fast");
        const heard = await asrFile(join(dir, `${s.id}.wav`));
        results.push({ id: s.id, score: score(want, heard), want, heard });
      } catch (e) {
        results.push({ id: s.id, score: -1, want, heard: `ERROR ${e.message}` });
      }
    }
  }),
);

results.sort((a, b) => a.score - b.score);
mkdirSync("out", { recursive: true });
writeFileSync(join("out", "voice-check.json"), JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.score < 0.85);
const avg = results.reduce((a, b) => a + Math.max(b.score, 0), 0) / results.length;
console.log(`共 ${results.length} 句,平均重合度 ${avg.toFixed(3)},低于 0.85 的有 ${bad.length} 句`);
for (const r of bad) console.log(`[${r.id}] ${r.score}\n  原稿: ${r.want}\n  听到: ${r.heard}`);
