// 批量渲染静帧:只打包一次、只开一次浏览器，然后连续出很多帧，比逐帧启动 remotion still 快得多。
//   node scripts/stills.mjs --comp PilotRatio --frames 100,200,300 --prefix pr
//   node scripts/stills.mjs --comp PilotRatio --frames 100,200 --props storyboards/ratio.kimi-k3.json --key ratio --prefix kimi
// --props 指向一个分镜 JSON，--key 是它对应的场景 id；脚本会把它包装成 { boards: { [key]: 分镜 } } 作为 inputProps 注入。
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const comp = flag("--comp", "PilotRatio");
const frames = (flag("--frames", "") || "").split(",").map((s) => +s.trim()).filter((n) => Number.isFinite(n) && n >= 0);
const prefix = flag("--prefix", "st");
const outDir = flag("--out", "out");
const propsFile = flag("--props");
const key = flag("--key");
const scale = +(flag("--scale", "0.5"));
if (!frames.length) throw new Error("需要 --frames");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
mkdirSync(outDir, { recursive: true });

const parsed = propsFile ? JSON.parse(readFileSync(propsFile, "utf8")) : null;
// 文件可以是单个分镜(含 beats，配合 --key)，也可以是 { 场景id: 分镜 } 的映射(覆盖多个场景)
// --input-props <文件>：整个文件原样当作 inputProps（新流水线的 Paper 合成用 projects/<id>/props.json）
const fullProps = flag("--input-props") ? JSON.parse(readFileSync(flag("--input-props"), "utf8")) : null;
const inputProps = fullProps ?? (parsed ? { boards: parsed.beats ? { [key ?? "ratio"]: parsed } : parsed } : {});

const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: resolve("src/index.ts"), onProgress: () => {} });
console.log(`打包完成 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const browser = await openBrowser("chrome", { browserExecutable: EDGE, chromiumOptions: {}, forceDeviceScaleFactor: scale });
console.log(`浏览器就绪 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const composition = await selectComposition({ serveUrl, id: comp, inputProps, puppeteerInstance: browser });
for (const frame of frames) {
  const output = join(outDir, `${prefix}_${frame}.png`);
  await renderStill({ composition, serveUrl, output, frame, inputProps, puppeteerInstance: browser, scale });
  console.log(`  帧 ${frame} → ${output}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
}
await browser.close({ silent: true });
console.log(`全部完成，共 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
