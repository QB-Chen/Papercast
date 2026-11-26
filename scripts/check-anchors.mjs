// 渲染前安全检查：用真实时间线（含字幕分段 caps），按渲染器 cueAt 的同一套规则，解析全片所有时间锚点。
// 找不到的锚点会让渲染在中途崩溃（几十分钟之后才发现），所以必须在渲染前查出来。
//   node scripts/check-anchors.mjs <arXiv 编号> [--board-dir …]
// 退出码：有解析不了的锚点 → 1。跨字幕分段（要靠整句插值）的只警告，不算失败。
import { readFileSync, existsSync } from "node:fs";
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const bd = args.includes("--board-dir") ? args[args.indexOf("--board-dir") + 1] : `projects/${id}/storyboards`;
const tl = JSON.parse(readFileSync(`projects/${id}/timeline.json`, "utf8"));

/** 和 src/story/canvas.tsx 的 cueAt 保持一致。返回 {ok, spanning} */
function resolve(scene, ref) {
  const m = String(ref).match(/^([^+#@]+)(?:([+#@])(.*))?$/);
  if (!m) return { ok: false, why: "格式不对" };
  const s = scene.sentences.find((x) => x.id === m[1]);
  if (!s) return { ok: false, why: `没有句子 ${m[1]}` };
  if (!m[2] || m[2] === "+") return { ok: true };
  const caps = s.caps?.length ? s.caps : [{ at: 0, text: s.text }];
  if (m[2] === "#") return Number(m[3]) < caps.length ? { ok: true } : { ok: false, why: `句子 ${s.id} 只有 ${caps.length} 段字幕，没有第 ${m[3]} 段` };
  const phrase = m[3].replace(/\+\d+$/, "");
  if (caps.some((c) => c.text.includes(phrase))) return { ok: true };
  if (s.text.includes(phrase)) return { ok: true, spanning: true };
  return { ok: false, why: `句子 ${s.id} 里找不到短语「${phrase}」` };
}

const ANCHOR_KEYS = new Set(["at", "until", "newAt", "animAt", "statusAt", "hlAt"]);
function walk(node, out, path = "") {
  if (Array.isArray(node)) node.forEach((x, i) => walk(x, out, `${path}[${i}]`));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (ANCHOR_KEYS.has(k) && typeof v === "string") out.push({ ref: v, path: `${path}.${k}` });
      else if (k === "pulse" && Array.isArray(v)) v.forEach((r, i) => typeof r === "string" && out.push({ ref: r, path: `${path}.pulse[${i}]` }));
      else walk(v, out, `${path}.${k}`);
    }
  }
}

let bad = 0, spanning = 0, total = 0;
for (const sc of tl.scenes) {
  const f = `${bd}/${sc.id}.json`;
  if (!existsSync(f)) continue;
  const board = JSON.parse(readFileSync(f, "utf8"));
  const anchors = [];
  board.beats.forEach((b, i) => walk(b, anchors, `beats[${i}](${b.kind})`));
  // OpenMotion 式动画：时间锚点写在脚本的 cue("句子id@短语") 里（motion.script 是字符串，walk 看不到）
  board.beats.forEach((b, i) => { if (b.form === "motion" && b.motion?.script) for (const m of String(b.motion.script).matchAll(/cue\(\s*(["'`])([^"'`]*?)\1\s*\)/g)) anchors.push({ ref: m[2], path: `beats[${i}](motion).cue` }); });
  for (const a of anchors) {
    // 只检查带 @ # + 的锚点，以及纯句子 id（也要存在）
    if (!/^[A-Za-z]+\d+([+#@].*)?$/.test(a.ref)) continue;
    total++;
    const r = resolve(sc, a.ref);
    if (!r.ok) { bad++; console.log(`✗ ${sc.id} ${a.path} = 「${a.ref}」：${r.why}`); }
    else if (r.spanning) { spanning++; console.log(`△ ${sc.id} ${a.path} = 「${a.ref}」跨了字幕分段，按整句插值`); }
  }
}
console.log(`检查 ${total} 个时间锚点：解析失败 ${bad}，跨分段 ${spanning}`);
process.exit(bad ? 1 : 0);
