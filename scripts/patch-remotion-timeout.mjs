// 本机内存紧张、Defender 扫描时,浏览器启动常超过 Remotion 写死的 25 秒连接超时,
// 导致 "Timed out after 25000 ms while trying to connect to the browser"。
// 这里把它改成 TARGET_MS(默认 10 分钟)。npm install 之后由 postinstall 自动执行,可重复运行,
// 也能把之前改过的值(如 120000)再次调整。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TARGET_MS = Number(process.env.REMOTION_BROWSER_TIMEOUT_MS ?? 600000);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "node_modules", "@remotion", "renderer", "dist", "open-browser.js");

if (!existsSync(target)) {
  console.log("[patch] open-browser.js 不存在,跳过");
  process.exit(0);
}
const src = readFileSync(target, "utf8");
const m = src.match(/timeout: (\d{5,7}),/);
if (!m) {
  console.log("[patch] 没找到 timeout 配置,Remotion 版本可能已变化,请手动检查");
  process.exit(0);
}
if (Number(m[1]) === TARGET_MS) {
  console.log(`[patch] 已是 ${TARGET_MS} 毫秒`);
  process.exit(0);
}
writeFileSync(target, src.replace(m[0], `timeout: ${TARGET_MS},`));
console.log(`[patch] 浏览器连接超时 ${m[1]} → ${TARGET_MS} 毫秒`);
