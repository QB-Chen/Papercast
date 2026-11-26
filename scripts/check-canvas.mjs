// 画布几何检查：按真实配音时间每 3 帧采样一次，算出每个"实心"原件（点、点上的字、方块、文字、括号文字、箭头文字、向量格）
// 那一刻的位置和包围盒，报告：持续重叠的一对原件、跑出画布的原件。
//   node scripts/check-canvas.mjs <arXiv 编号> [场景id] [--board=分镜文件]
// 注意：缓动用平滑曲线近似，字宽按"每字一个字号"估算，所以只当预警，不替代看画面。
import { readFileSync } from "node:fs";
import { validateStoryboard } from "./storyboard-schema.mjs";
let problems = 0;
const boardFile = process.argv.find((a) => a.startsWith("--board="))?.slice(8); // 可选：直接检查某个分镜文件
const [id, only] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const root = `projects/${id}`;
const tl = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8"));
const CW = 1600, CH = 520, STEP = 3, MIN_RUN = 9; // 连续 9 次采样（0.9 秒）才算持续重叠

function cueAt(scene, ref) {
  const m = ref.match(/^([^+#@]+)(?:([+#@])(.*))?$/);
  const s = scene.sentences.find((x) => x.id === m[1]);
  if (!m[2]) return s.local;
  if (m[2] === "+") return s.local + Number(m[3]);
  const caps = s.caps?.length ? s.caps : [{ at: 0, text: s.text }];
  if (m[2] === "#") return s.local + (caps[Number(m[3])]?.at ?? 0);
  const off = m[3].match(/^(.*)\+(\d+)$/);
  const phrase = off ? off[1] : m[3];
  const extra = off ? Number(off[2]) : 0;
  for (let i = 0; i < caps.length; i++) {
    const idx = caps[i].text.indexOf(phrase);
    if (idx < 0) continue;
    const end = i + 1 < caps.length ? caps[i + 1].at : s.dur;
    return s.local + extra + Math.round(caps[i].at + ((end - caps[i].at) * idx) / Math.max(1, caps[i].text.length));
  }
  throw new Error(`找不到短语 ${phrase}`);
}
const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const len = (s) => [...(s ?? "")].length;

function pos(it, f, at) {
  let x = it.x ?? 0, y = it.y ?? 0, h = it.h ?? 0;
  for (const m of it.moves ?? []) {
    const p = smooth((f - at(m.at)) / (m.dur ?? 24));
    x += (m.x - x) * p;
    y += ((m.y ?? y) - y) * p;
    if (m.h !== undefined) h += (m.h - h) * p;
  }
  return { x, y, h };
}

/** 一个原件在 f 帧的实心包围盒列表 [{name,x0,y0,x1,y1}] */
function boxes(it, f, at) {
  const t0 = at(it.at);
  if (f < t0 + 4) return [];
  if (it.until && f >= at(it.until)) return [];
  const { x, y, h: curH } = pos(it, f, at);
  const out = [];
  const rect = (name, cx, top, w, h) => out.push({ name, x0: cx - w / 2, y0: top, x1: cx + w / 2, y1: top + h });
  const grow = Math.min(1, (f - t0) / 12); // 出场的前 12 帧还在长大，别误报
  switch (it.type) {
    case "dot": {
      const r = (it.r ?? 22) * grow;
      out.push({ name: it.id, x0: x - r, y0: y - r, x1: x + r, y1: y + r });
      if (it.text) rect(`${it.id}字`, x, y + (it.r ?? 22) + 10, len(it.text) * (it.size ?? 38), (it.size ?? 38) * 1.25);
      break;
    }
    case "bar": {
      const hh = curH * Math.min(1, (f - t0) / 22);
      out.push({ name: it.id, x0: x - (it.w ?? 120) / 2, y0: y - hh, x1: x + (it.w ?? 120) / 2, y1: y });
      break;
    }
    case "box": rect(it.id, x, y - (it.h ?? 96) / 2, it.w ?? 240, it.h ?? 96); break;
    case "text": rect(it.id, x, y - (it.size ?? 44) * 0.7, len(it.text) * (it.size ?? 44), (it.size ?? 44) * 1.3); break;
    case "vec": {
      const n = it.n ?? 4, cw = it.cw ?? 56, ch = it.ch ?? 44;
      out.push({ name: it.id, x0: x, y0: y - ch / 2, x1: x + n * (cw + 4), y1: y + ch / 2 });
      break;
    }
    case "brace": {
      const x2 = it.x2 ?? x + 300, y2 = it.y2 ?? y;
      if (it.text && Math.abs(x2 - x) >= Math.abs(y2 - y)) {
        const size = it.size ?? 36, base = it.dir === "up" ? y - 34 : y + 28 + size;
        rect(`${it.id}字`, (x + x2) / 2, base - size * 0.9, len(it.text) * size, size * 1.2);
      }
      break;
    }
    case "arrow": {
      if (it.text) {
        const x2 = it.x2 ?? x + 200, y2 = it.y2 ?? y, size = it.size ?? 34;
        rect(`${it.id}字`, (x + x2) / 2, Math.min(y, y2) - 20 - size * 0.9, len(it.text) * size, size * 1.2);
      }
      break;
    }
    case "ring": {
      const w = (it.w ?? 200) + 2 * (it.pad ?? 10), h = (it.h ?? 100) + 2 * (it.pad ?? 10);
      out.push({ name: it.id, ring: true, x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 });
      break;
    }
    default: break;
  }
  return out;
}

const inter = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 4 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 4;
for (const sc of tl.scenes) {
  if (only && sc.id !== only) continue;
  const board = JSON.parse(readFileSync(boardFile ?? `${root}/storyboards/${sc.id}.json`, "utf8"));
  if (board.beats.some((x) => x.kind === "canvas" && x.things)) {
    // 模型写的是 things/marks，cv 由编译器算；先按当前规则重新编译，避免检查到旧结果
    const ids = sc.sentences.map((s) => s.id);
    const errs = validateStoryboard(board, ids, Object.fromEntries(sc.sentences.map((s) => [s.id, s.text])), { lang: tl.lang ?? "zh" }).filter((e) => /（at=\w+）/.test(e) && /canvas|画布|things|marks|cv\[/.test(e));
    for (const e of errs) { problems++; console.log(`  ✗ 编译失败：${e}`); }
  }
  const at = (ref) => cueAt(sc, ref);
  for (const b of board.beats.filter((x) => x.kind === "canvas")) {
    const cv = b.cv ?? [];
    const start = at(b.at);
    // 画布存在到下一个 C 位置镜头（或带 clear 的镜头）开始为止，没有就到场景结束
    const next = board.beats.filter((x) => x !== b && (x.slot === "C" || x.clear) && at(x.at) > start).map((x) => at(x.at));
    const end = next.length ? Math.min(...next) : sc.dur;
    const runs = new Map(); // "a|b" -> {run,first,max}
    const outside = new Map();
    for (let f = start; f < end; f += STEP) {
      const all = cv.flatMap((it) => boxes(it, f, at).map((bx) => ({ ...bx, owner: it.id })));
      for (const bx of all) {
        if (bx.x0 < -2 || bx.y0 < -2 || bx.x1 > CW + 2 || bx.y1 > CH + 2) outside.set(bx.name, (outside.get(bx.name) ?? 0) + 1);
      }
      const hit = new Set();
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        if (all[i].owner === all[j].owner) continue;
        if (all[i].ring || all[j].ring) {
          const [rg, o] = all[i].ring ? [all[i], all[j]] : [all[j], all[i]];
          if (o.ring || !inter(rg, o)) continue;
          const inside = o.x0 >= rg.x0 && o.x1 <= rg.x1 && o.y0 >= rg.y0 && o.y1 <= rg.y1;
          if (inside) continue;
          const key = `${rg.name} 切开 ${o.name}`;
          hit.add(key);
          const r = runs.get(key) ?? { run: 0, best: 0, first: f };
          if (r.run === 0) r.first = f;
          r.run++; r.best = Math.max(r.best, r.run);
          runs.set(key, r);
          continue;
        }
        if (!inter(all[i], all[j])) continue;
        const key = [all[i].name, all[j].name].sort().join(" × ");
        hit.add(key);
        const r = runs.get(key) ?? { run: 0, best: 0, first: f };
        if (r.run === 0) r.first = f;
        r.run++; r.best = Math.max(r.best, r.run);
        runs.set(key, r);
      }
      for (const [k, r] of runs) if (!hit.has(k)) r.run = 0;
    }
    console.log(`${sc.id} 画布（${b.at}，${cv.length} 个原件）`);
    for (const [k, r] of runs) if (r.best >= MIN_RUN) {
      problems++;
      console.log(`  ✗ ${k.includes("切开") ? "圈切到了别的东西" : "重叠"} ${k}：连续 ${(r.best * STEP / tl.fps).toFixed(1)} 秒，约从场景内第 ${r.first} 帧起`);
    }
    for (const [k, n] of outside) if (n >= 3) { problems++; console.log(`  ✗ 出画布 ${k}：${n} 次采样`); }
  }
}
console.log(problems ? `共 ${problems} 处预警` : "没有预警");
process.exit(problems ? 1 : 0);
