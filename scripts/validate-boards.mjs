// 用当前的校验规则检查一批分镜。
//   node scripts/validate-boards.mjs [分镜目录=storyboards/gen] [旁白=narration/drpo2.json]
import { readFileSync, existsSync } from "node:fs";
import { validateStoryboard } from "./storyboard-schema.mjs";

const dir = process.argv[2] ?? "storyboards/gen";
const narr = JSON.parse(readFileSync(process.argv[3] ?? "narration/drpo2.json", "utf8"));
let total = 0;
for (const sc of narr.scenes) {
  const file = `${dir}/${sc.id}.json`;
  if (!existsSync(file)) {
    console.log(`${sc.id}: （没有分镜）`);
    continue;
  }
  const board = JSON.parse(readFileSync(file, "utf8"));
  const ids = sc.sentences.map((s) => s.id);
  const errs = validateStoryboard(board, ids, Object.fromEntries(sc.sentences.map((s) => [s.id, s.text])));
  total += errs.length;
  const kinds = {};
  board.beats.forEach((b) => (kinds[b.kind] = (kinds[b.kind] ?? 0) + 1));
  console.log(`${sc.id}: ${errs.length} 个问题，${board.beats.length} 个镜头 ${JSON.stringify(kinds)}`);
  errs.forEach((e) => console.log("   - " + e.slice(0, 170)));
}
console.log(`合计 ${total} 个问题`);
