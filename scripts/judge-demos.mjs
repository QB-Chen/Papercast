// 评审：每一处"需要演示"的片段，动画事件和旁白的动作对不对得上？
//   node scripts/judge-demos.mjs <arXiv 编号> [--board-dir …] [--model sensenova/kimi-k3] [--scene hook]
// 把动画翻译成"时间线事件清单"（谁在什么时候出现、移动到哪里、说了什么、换了什么表情、什么东西从谁手里到谁手里），
// 连同旁白原文交给另一个模型，问：旁白里的每个动作和反应，画面上有没有对应的事件？缺了什么？有没有和旁白矛盾的？
// 结果写到 projects/<id>/narration/demo-judge.json；不合格的处会打印出来，可以拿它去让分镜模型改。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { chatJson } from "./llm.mjs";
import { estimateSec } from "./canvas-compile.mjs";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--") && !/^sensenova\//.test(a));
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const model = flag("--model", "sensenova/kimi-k3");
const only = flag("--scene");
const root = `projects/${id}`;
const boardDir = flag("--board-dir", `${root}/storyboards`);
const demos = JSON.parse(readFileSync(`${root}/narration/demos.json`, "utf8"));
const tl = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8"));

/** 把一个镜头在 [a,b] 句范围内的动画翻译成按时间排序的中文事件清单 */
function describe(beat, ids, texts, a, b) {
  const t0 = estimateSec(ids[a], ids, texts);
  const tEnd = estimateSec(ids[b], ids, texts) + [...(texts[ids[b]] ?? "")].length / 5;
  const when = (ref) => {
    const s = estimateSec(ref, ids, texts);
    if (s === null) return null;
    const m = String(ref).match(/^([^+#@]+)(?:@(.*))?/);
    return { s, label: m ? (m[2] ? `${m[1]}「${m[2].replace(/\+\d+$/, "")}」时` : `${m[1]} 句开头`) : ref };
  };
  const ev = [];
  const push = (ref, text) => { const w = when(ref); if (w && w.s >= t0 - 0.05 && w.s < tEnd) ev.push({ s: w.s, t: `${w.label}：${text}` }); };
  const objs = beat.kind === "canvas" && beat.form === "free" ? beat.objs ?? [] : [];
  const nameOf = (o) => (o.type === "char" ? `角色「${o.tag ?? o.look}」(${o.look})` : o.type === "icon" ? `道具「${o.prop ?? o.sticker}」` : o.type === "shape" ? `图形「${o.text ?? o.id}」` : o.type === "text" ? `文字「${o.text}」` : o.type === "bars" ? `柱子组(${(o.labels ?? []).join("/")})` : o.type === "curve" ? `曲线图(${o.fn})` : o.type === "line" ? `连线 ${typeof o.from === "string" ? o.from : "点"}→${typeof o.to === "string" ? o.to : "点"}` : o.type === "ring" ? `手绘圈(圈住 ${o.of})` : `括号(${o.text ?? ""})`);
  for (const o of objs) {
    push(o.at, `${nameOf(o)} 出现${o.type === "char" && o.say ? `，说「${o.say}」` : ""}${o.type === "char" && o.mood ? `，头上冒出 ${o.mood}` : ""}`);
    for (const k of o.keys ?? []) {
      const bits = [];
      if (k.x !== undefined || k.y !== undefined) bits.push(`移动到横${k.x ?? "不变"}%纵${k.y ?? "不变"}%`);
      if (k.s !== undefined) bits.push(`缩放到${k.s}`);
      if (k.o !== undefined) bits.push(k.o < 0.3 ? "淡出消失" : "透明度变化");
      if (k.look) bits.push(`换成姿势 ${k.look}`);
      if (k.say) bits.push(`说「${k.say}」`);
      if (k.mood) bits.push(`头上冒出 ${k.mood}`);
      if (k.act) bits.push(`做动作 ${k.act}`);
      if (k.vals) bits.push(`数值变成 [${k.vals.join(",")}]`);
      if (k.params) bits.push(`参数变成 ${JSON.stringify(k.params)}`);
      if (k.mark !== undefined) bits.push("圆点沿曲线移动");
      if (k.text) bits.push(`文字变成「${k.text}」`);
      if (bits.length) push(k.at, `${nameOf(o)} ${bits.join("，")}`);
    }
    for (const p of o.pulse ?? []) push(p, `${nameOf(o)} 弹一下强调`);
  }
  if (beat.kind === "canvas" && beat.form !== "free") {
    for (const th of beat.things ?? []) { push(th.at, `${th.label} 出现`); for (const m of th.moves ?? []) push(m.at, `${th.label} 移动`); }
    for (const m of beat.marks ?? []) push(m.at, `${m.type}${m.text ? "「" + m.text + "」" : ""}${m.who ? " 标出 " + m.who : ""}`);
  }
  if (beat.kind === "stage") {
    const cast = Object.fromEntries((beat.cast ?? []).map((c) => [c.id, c.tag ?? c.look]));
    for (const ac of beat.acts ?? []) { const k = ids.indexOf(ac.at); if (k >= a && k <= b) ev.push({ s: estimateSec(ac.at, ids, texts), t: `${ac.at} 句开头：角色「${cast[ac.who] ?? ac.who}」${ac.do ?? "出场"}${ac.say ? `，说「${ac.say}」` : ""}${ac.mood ? `，冒出 ${ac.mood}` : ""}${ac.prop ? `，手边出现 ${ac.prop}` : ""}` }); }
  }
  return ev.sort((x, y) => x.s - y.s).map((e) => e.t);
}

const results = {};
let bad = 0, total = 0;
for (const sc of tl.scenes) {
  if (only && sc.id !== only) continue;
  const list = demos[sc.id];
  const f = `${boardDir}/${sc.id}.json`;
  if (!list || !existsSync(f)) continue;
  const board = JSON.parse(readFileSync(f, "utf8"));
  const ids = sc.sentences.map((s) => s.id);
  const texts = Object.fromEntries(sc.sentences.map((s) => [s.id, s.text]));
  const centers = board.beats.filter((x) => x.slot === "C" || x.clear).map((x) => ({ b: x, i: ids.indexOf(x.at) })).filter((x) => x.i >= 0).sort((p, q) => p.i - q.i);
  const items = [];
  for (const d of list) {
    const a = ids.indexOf(d.from), z = ids.indexOf(d.to);
    const events = [];
    centers.forEach((c, k) => {
      const next = centers.slice(k + 1).find((y) => y.i > c.i);
      const endI = (next ? next.i : ids.length) - 1;
      if (c.i > z || endI < a || c.b.slot !== "C") return;
      events.push(...describe(c.b, ids, texts, a, z));
      if (c.b.kind === "eqx") for (const n of c.b.insets ?? []) { const ia = ids.indexOf(n.from), iz = ids.indexOf(n.to); if (ia <= z && iz >= a) events.push(...describe({ kind: "canvas", form: "free", objs: n.objs }, ids, texts, a, z)); }
      if (!["canvas", "stage", "eqx"].includes(c.b.kind)) events.push(`（这段画面是 ${c.b.kind}，论文原图/原表/数据图或静态元素）`);
    });
    items.push({ d, events });
  }
  const user = `场景 ${sc.id}。下面每一项是旁白里一处"需要演示"的片段：先给旁白原文和导演要求演出的内容，再给画面上实际会发生的事件（按时间顺序）。请逐项评审。\n\n${items.map((x, i) => `### 第 ${i + 1} 项 ${x.d.from}${x.d.to !== x.d.from ? "~" + x.d.to : ""}（${x.d.kind}）\n旁白：${sc.sentences.filter((s) => ids.indexOf(s.id) >= ids.indexOf(x.d.from) && ids.indexOf(s.id) <= ids.indexOf(x.d.to)).map((s) => s.text).join("")}\n要演出的内容：${x.d.summary}\n导演要求的画面事件：\n${x.d.beats.map((b) => "  - " + b.at + "：" + b.what).join("\n")}\n画面实际事件：\n${x.events.length ? x.events.map((e) => "  - " + e).join("\n") : "  （没有动画事件）"}`).join("\n\n")}`;
  const SYSTEM = `你是严格的画面评审。对每一项判断：旁白里的每个动作、例子、反应，画面上有没有对应的事件？
评分 verdict：
- "ok"：旁白里的主要动作和反应都有对应的画面事件，顺序大致对得上，没有和旁白矛盾的内容。
- "weak"：有动画，但缺了旁白里的某个关键动作或反应，或只是人物站着、东西冒出来，没有"做"这个动作。
- "wrong"：画面和旁白矛盾（比如旁白说端给客人，画面上东西却没有移向客人）或完全没有演到点子上。
注意：画面事件里"论文原图/原表/数据图"的项，如果旁白是在讲那张图，算 ok。
每一项还要写 missing：缺了什么（具体到"旁白说了…，画面没有…"），不超过 60 字；ok 的写空字符串。
只输出 JSON：{"items":[{"n":1,"verdict":"ok|weak|wrong","missing":""}]}，n 从 1 开始，个数和项数一致。`;
  const { obj, errors } = await chatJson(model, [{ role: "system", content: SYSTEM }, { role: "user", content: user }], (o) => {
    if (!Array.isArray(o?.items) || o.items.length !== items.length) return [`items 个数必须是 ${items.length}`];
    return o.items.flatMap((x, i) => (["ok", "weak", "wrong"].includes(x.verdict) ? [] : [`第 ${i + 1} 项 verdict 不对`]));
  }, { maxRounds: 4, temperature: 0.2, maxTokens: 6000, tag: `judge-${sc.id}`, timeoutMs: 600_000 });
  if (errors?.length) { console.log(`✗ ${sc.id} 评审失败：${errors[0]}`); continue; }
  results[sc.id] = items.map((x, i) => ({ from: x.d.from, to: x.d.to, kind: x.d.kind, summary: x.d.summary, verdict: obj.items[i].verdict, missing: obj.items[i].missing, events: x.events }));
  const nb = obj.items.filter((x) => x.verdict !== "ok").length;
  bad += nb; total += items.length;
  console.log(`${sc.id}: ${items.length - nb}/${items.length} 处合格${nb ? "，不合格：" : ""}`);
  for (const [i, x] of obj.items.entries()) if (x.verdict !== "ok") console.log(`   ${x.verdict === "wrong" ? "✗" : "△"} ${items[i].d.from}${items[i].d.to !== items[i].d.from ? "~" + items[i].d.to : ""} ${items[i].d.summary} → ${x.missing}`);
}
writeFileSync(`${root}/narration/demo-judge.json`, JSON.stringify(results, null, 2));
console.log(`\n合计 ${total} 处，评审合格 ${total - bad} 处（${total ? (((total - bad) / total) * 100).toFixed(0) : 0}%）→ ${root}/narration/demo-judge.json`);
