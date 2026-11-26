// 把 public/stickers 里每个贴图名，在选定的图标集里找一个对应的图标，下载到 public/stickers-<包名>/，保持文件名不变。
//   node scripts/fetch-sticker-pack.mjs <图标集前缀，如 withicons-sticker> [--sheet]   只出对照页，不下载
//   node scripts/fetch-sticker-pack.mjs withicons-sticker --apply                     下载
// 找图用 Iconify 搜索 API：先用 overrides 里手工指定的英文搜索词，没有就用贴图名本身（连字符换成空格）。
// 对照页 llm-test/pack-<包名>.html 把"旧贴图 / 新贴图 / 搜索词 / 匹配到的图标名"并排放，肉眼核对后再 --apply。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const set = args[0];
if (!set) throw new Error("用法：node scripts/fetch-sticker-pack.mjs <图标集前缀> [--apply]");
const APPLY = args.includes("--apply");
const names = readdirSync("public/stickers").filter((f) => f.endsWith(".svg")).map((f) => f.replace(/\.svg$/, "")).sort();

// 贴图名 → 搜索词（可以写多个备选，按顺序试）。没写的直接用贴图名
const OVERRIDES = JSON.parse(readFileSync("scripts/sticker-queries.json", "utf8"));
const queryOf = (n) => OVERRIDES[n] ?? [n.replace(/-/g, " ")];

const pickedFile = `scripts/sticker-picks-${set}.json`;
const picks = existsSync(pickedFile) ? JSON.parse(readFileSync(pickedFile, "utf8")) : {};
const out = {};
for (const n of names) {
  if (picks[n] === null) {
    out[n] = null;
    continue;
  }
  if (picks[n]) {
    out[n] = picks[n]; // 人工定过的
    continue;
  }
  let hit = null;
  for (const q of queryOf(n)) {
    const r = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(q)}&prefix=${set}&limit=4`);
    const j = await r.json();
    if (j.icons?.length) {
      hit = j.icons[0];
      break;
    }
  }
  out[n] = hit;
}
const found = Object.values(out).filter(Boolean).length;
console.log(`${set}：${names.length} 个贴图名里找到 ${found} 个，缺 ${names.length - found} 个`);
console.log("缺：", names.filter((n) => !out[n]).join("、"));
writeFileSync(`llm-test/picks-${set}.json`, JSON.stringify(out, null, 2));

const cell = (n) =>
  `<td><div style="display:flex;gap:4px;justify-content:center"><img src="file:///${process.cwd().replace(/\\/g, "/")}/public/stickers/${n}.svg" width="40" height="40" style="opacity:.55"/>` +
  (out[n] ? `<img src="https://api.iconify.design/${out[n].replace(":", "/")}.svg" width="84" height="84"/>` : `<div style="width:84px;height:84px;border:2px dashed #c33;font:10px sans-serif;color:#c33">缺</div>`) +
  `</div><div>${n.slice(0, 20)}</div><div style="color:#08a">${out[n] ? out[n].split(":")[1].slice(0, 20) : ""}</div></td>`;
const rows = [];
for (let i = 0; i < names.length; i += 9) rows.push(`<tr>${names.slice(i, i + 9).map(cell).join("")}</tr>`);
writeFileSync(`llm-test/pack-${set}.html`, `<html><body style="background:#EAF2F1;margin:8px"><table style="border-spacing:6px;text-align:center;font:10px sans-serif">${rows.join("")}</table></body></html>`);

if (APPLY) {
  const dir = `public/stickers-${set}`;
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const [name, icon] of Object.entries(out)) {
    if (!icon) continue;
    if (existsSync(`${dir}/${name}.svg`)) {
      n++;
      continue; // 已经下载过
    }
    let t = "";
    for (let a = 1; a <= 5; a++) {
      const r = await fetch(`https://api.iconify.design/${icon.replace(":", "/")}.svg`);
      t = await r.text();
      if (r.ok && t.startsWith("<svg")) break;
      t = "";
      await new Promise((ok) => setTimeout(ok, 1200 * a)); // 被限流就等一会儿再试
    }
    if (!t) {
      console.log(`  ✗ ${name} ← ${icon}`);
      continue;
    }
    writeFileSync(`${dir}/${name}.svg`, t);
    n++;
    await new Promise((ok) => setTimeout(ok, 120));
  }
  console.log(`已下载 ${n} 个到 ${dir}`);
}
