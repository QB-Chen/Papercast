// 把选定的 Lottie 动画下载到 public/lotties/，逐个核对授权页，并生成 src/story/lotties.ts（把 JSON 打进渲染包）和 src/story/lottie-map.json（贴图名 → 动画）。
//   node scripts/lottie-fetch.mjs        读 scripts/lottie-picks.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const picks = JSON.parse(readFileSync("scripts/lottie-picks.json", "utf8"));
const cands = JSON.parse(readFileSync("llm-test/lottie-cands.json", "utf8"));
mkdirSync("public/lotties", { recursive: true });
const map = {};
const report = [];
for (const [key, spec] of Object.entries(picks)) {
  const c = cands[spec.concept][spec.index];
  const json = await (await fetch(c.json)).text();
  writeFileSync(`public/lotties/${key}.json`, json);
  // 授权：读该动画的页面，找授权标注
  // 授权：只认这个动画自己的页面（/free-animation/<slug>）里的两处：结构化数据的 license 字段，和页面上"Free to use under …"那一行。
  // 页面模板里还固定出现 Premium、Marketplace 之类的字，不能搜关键词，否则每个动画读出来都一样
  let lic = "未核实（页面没取到）";
  try {
    const slug = c.url.split("/").pop();
    const page = `https://lottiefiles.com/free-animation/${slug}`;
    const html = await (await fetch(page, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    const ld = html.match(/"license":"(https:\/\/[^"]+)"/);
    const line = html.match(/Free to use under ([^<]{3,60})</);
    const paid = /"isAccessibleForFree":\s*false/.test(html) || />\s*Premium\s*</.test(html.split("Free to use under")[0].slice(-600));
    if (ld && line) lic = `${line[1].trim()}（结构化数据 license=${ld[1]}）${paid ? " ⚠ 附近出现 Premium 标记" : ""}`;
    else lic = `未核实：结构化数据 ${ld ? "有" : "无"}，页面标注行 ${line ? "有" : "无"}（${page}）`;
  } catch {}
  map[spec.sticker] = { key, loop: spec.loop ?? false, speed: spec.speed ?? 1 };
  report.push({ key, name: c.name, by: c.by, kb: c.kb, sec: c.sec, fr: c.fr, url: c.url, license: lic });
  console.log(`${key.padEnd(10)} ${String(c.name).slice(0, 22).padEnd(22)} ${c.kb}KB ${c.sec}s 作者 ${c.by}\n           授权标注：${lic}\n           ${c.url}`);
}
writeFileSync("src/story/lottie-map.json", JSON.stringify(map, null, 2));
const keys = Object.keys(picks);
writeFileSync(
  "src/story/lotties.ts",
  `// 由 scripts/lottie-fetch.mjs 生成，不要手改\n` + keys.map((k) => `import ${k} from "../../public/lotties/${k}.json";`).join("\n") + `\nexport const LOTTIES: Record<string, unknown> = { ${keys.join(", ")} };\n`,
);
writeFileSync("public/lotties/SOURCES.json", JSON.stringify(report, null, 2));
console.log("\n已写 src/story/lotties.ts、lottie-map.json、public/lotties/SOURCES.json");
