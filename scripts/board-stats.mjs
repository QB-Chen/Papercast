// 打印一个项目每个场景的分镜用了哪些元素，以及模型花了几轮才过校验
//   node scripts/board-stats.mjs <arXiv 编号>
import { readFileSync, readdirSync, existsSync } from "node:fs";
const id = process.argv[2];
const plan = JSON.parse(readFileSync(`projects/${id}/plan.json`, "utf8"));
for (const s of plan.scenes) {
  const f = `projects/${id}/storyboards/${s.id}.json`;
  if (!existsSync(f)) {
    console.log(`${s.id}: （没有分镜）`);
    continue;
  }
  const b = JSON.parse(readFileSync(f, "utf8"));
  const k = {};
  b.beats.forEach((x) => (k[x.kind] = (k[x.kind] ?? 0) + 1));
  let rounds = "?";
  let model = "?";
  const log = `projects/${id}/logs/boards-${s.id}.log`;
  if (existsSync(log)) {
    const t = readFileSync(log, "utf8");
    rounds = (t.match(/通过校验（(\d+) 轮）/g) ?? []).pop()?.match(/\d+/)?.[0] ?? "未通过";
    model = (t.match(/分镜模型 (\S+)/g) ?? []).pop()?.replace("分镜模型 ", "") ?? "?";
  }
  console.log(`${s.id}: ${b.beats.length} 个镜头 ${JSON.stringify(k)}  [${model.split("/")[1]}, ${rounds} 轮]`);
}
