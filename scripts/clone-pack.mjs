// 把已经人工核对过的贴图对应关系，搬到另一个同系列图标集（withicons-* 各风格的图标名大多一致）。
//   node scripts/clone-pack.mjs <源图标集> <目标图标集>
// 对每个贴图名：用源集里选定的图标名，到目标集直接取；取不到再按关键词搜，且图标名必须包含关键词，避免像之前那样搜出风马牛不相及的图。
// 结果下载到 public/stickers-<目标>/，缺的不补（渲染时回退到默认贴图），并写 llm-test/clone-<目标>.html 对照页。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const [src, dst] = process.argv.slice(2);
if (!src || !dst) throw new Error("用法：node scripts/clone-pack.mjs <源图标集> <目标图标集>");
const picks = JSON.parse(readFileSync(`llm-test/picks-${src}.json`, "utf8"));
const queries = JSON.parse(readFileSync("scripts/sticker-queries.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function svg(icon) {
  for (let a = 1; a <= 4; a++) {
    const r = await fetch(`https://api.iconify.design/${icon.replace(":", "/")}.svg`);
    const t = await r.text();
    if (r.ok && t.startsWith("<svg")) return t;
    if (r.status === 404) return null;
    await sleep(1000 * a);
  }
  return null;
}
async function search(q) {
  const r = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(q)}&prefix=${dst}&limit=8`);
  const j = await r.json();
  return j.icons ?? [];
}
const dir = `public/stickers-${dst}`;
mkdirSync(dir, { recursive: true });
const result = {};
let same = 0, searched = 0, missing = 0;
for (const [name, from] of Object.entries(picks)) {
  const file = `${dir}/${name}.svg`;
  let icon = null, text = null;
  if (from) {
    const nm = from.split(":")[1];
    text = await svg(`${dst}:${nm}`);
    if (text) {
      icon = `${dst}:${nm}`;
      same++;
    }
  }
  if (!text) {
    // 按关键词搜，图标名必须包含关键词的某个词，才算数
    for (const q of queries[name] ?? [name.replace(/-/g, " ")]) {
      if (q === "__skip__") break;
      const words = q.toLowerCase().split(/\s+/);
      const hit = (await search(q)).find((i) => words.some((w) => w.length > 2 && i.split(":")[1].toLowerCase().includes(w)));
      if (hit) {
        text = await svg(hit);
        if (text) {
          icon = hit;
          searched++;
          break;
        }
      }
    }
  }
  if (text) writeFileSync(file, text);
  else missing++;
  result[name] = icon;
  await sleep(60);
}
writeFileSync(`llm-test/picks-${dst}.json`, JSON.stringify(result, null, 2));
console.log(`${dst}：直接沿用 ${same} 个，按关键词重新找到 ${searched} 个，缺 ${missing} 个`);
console.log("缺：", Object.entries(result).filter(([, v]) => !v).map(([k]) => k).join("、"));
