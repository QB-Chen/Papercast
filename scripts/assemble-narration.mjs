// 把各场景的旁白稿(narration/gen/<场景>.revised.json + manual-fixes.json)合并成完整的 narration/drpo2.json。
//   node scripts/assemble-narration.mjs
// ratio 场景用试点稿 narration/pilot/ratio.revised.json。
import { readFileSync, writeFileSync } from "node:fs";

const ORDER = ["hook", "why", "ratio", "dppo", "drpo", "spo", "derive", "exp", "abl", "out"];
const SRC = { ratio: "narration/pilot/ratio.revised.json" };
const base = JSON.parse(readFileSync("narration/drpo.json", "utf8"));
const fixes = JSON.parse(readFileSync("narration/gen/manual-fixes.json", "utf8"));

const scenes = [];
for (const id of ORDER) {
  const file = SRC[id] ?? `narration/gen/${id}.revised.json`;
  const sentences = JSON.parse(readFileSync(file, "utf8")).sentences.map((s) => ({ ...s }));
  for (const [sid, fx] of Object.entries(fixes[id] ?? {})) {
    const s = sentences.find((x) => x.id === sid);
    if (!s) throw new Error(`manual-fixes 里的 ${id}/${sid} 在稿子里找不到`);
    s.llmText = s.text;
    s.text = fx.text;
  }
  scenes.push({ id, sentences });
  // 分镜生成用的最终稿(含人工修订),UTF-8 无 BOM
  writeFileSync(`narration/gen/${id}.final.json`, JSON.stringify({ sentences: sentences.map(({ id, text, visual }) => ({ id, text, visual })) }, null, 2));
}
const out = { ...base, scenes };
writeFileSync("narration/drpo2.json", JSON.stringify(out, null, 2));
const n = scenes.reduce((a, s) => a + s.sentences.length, 0);
console.log(`已合并 ${scenes.length} 个场景，共 ${n} 句 → narration/drpo2.json`);
for (const s of scenes) console.log(`  ${s.id}: ${s.sentences.length} 句，${s.sentences.reduce((a, x) => a + [...x.text].length, 0)} 字`);
const over = scenes.flatMap((s) => s.sentences.filter((x) => [...x.text].length > 36).map((x) => x.id));
if (over.length) console.log("超长句：", over.join(", "));
