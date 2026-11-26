// 审计：把 demos.json（旁白里所有需要演示的地方）和某份分镜对照，逐处判断有没有被演出来。
//   node scripts/audit-demos.mjs <arXiv 编号> [--board-dir projects/<id>/storyboards] [--json 输出文件]
// 判断规则（结构性，不靠模型猜）：一处演示 = 一个句子范围 + 若干"画面事件"（beats）。要算"演出来了"，必须同时满足：
//   1) 这个范围内，中央有一个动画镜头：canvas（任何版式）或 stage（角色小剧场）
//   2) 这个镜头在这个范围内至少有 N 个"事件"（出现、关键帧、移动、弹跳、台词动作），N = max(3, beats 数的一半)
//   3) 如果清单里有角色（actors），镜头里必须有角色（free 的 char，或 stage 的 cast）
// 不满足的分三类报：没动画（画面是别的元素）、动画太少（有镜头但事件不够）、没演人物（缺角色）。
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { estimateSec, eventTimes } from "./canvas-compile.mjs";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const root = `projects/${id}`;
const boardDir = flag("--board-dir", `${root}/storyboards`);
const demos = JSON.parse(readFileSync(`${root}/narration/demos.json`, "utf8"));
const tl = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8"));

/** 一个镜头在 [fromIdx,toIdx] 句内的事件数 */
function eventsIn(beat, ids, texts, a, b) {
  const base = estimateSec(ids[a], ids, texts), end = estimateSec(ids[b], ids, texts) + [...(texts[ids[b]] ?? "")].length / 5;
  const inRange = (ref) => { const s = estimateSec(ref, ids, texts); return s !== null && s >= base - 0.05 && s < end; };
  let n = 0;
  if (beat.kind === "canvas" && beat.form === "free") {
    for (const o of beat.objs ?? []) {
      if (inRange(o.at)) n++;
      for (const k of o.keys ?? []) if (inRange(k.at)) n++;
      for (const p of o.pulse ?? []) if (inRange(p)) n++;
    }
  } else if (beat.kind === "canvas") {
    for (const it of beat.cv ?? []) {
      if (inRange(it.at)) n++;
      for (const m of it.moves ?? []) if (inRange(m.at)) n++;
      for (const p of it.pulse ?? []) if (inRange(p)) n++;
    }
  } else if (beat.kind === "stage") {
    // stage 的 acts 用句子 id；每个 act（出场、动作、台词、表情、道具）算一个事件
    for (const act of beat.acts ?? []) { const k = ids.indexOf(act.at); if (k >= a && k <= b) n += 1 + (act.say ? 1 : 0) + (act.mood ? 1 : 0); }
  }
  return n;
}

const hasActors = (beat) => (beat.kind === "stage" ? (beat.cast?.length ?? 0) >= 1 : beat.kind === "canvas" && beat.form === "free" ? (beat.objs ?? []).some((o) => o.type === "char") : false);

const report = [];
let syncTotal = 0, syncOk = 0;
let total = 0, ok = 0;
for (const sc of tl.scenes) {
  const list = demos[sc.id];
  if (!list) continue;
  const f = `${boardDir}/${sc.id}.json`;
  if (!existsSync(f)) continue;
  const board = JSON.parse(readFileSync(f, "utf8"));
  const ids = sc.sentences.map((s) => s.id);
  const texts = Object.fromEntries(sc.sentences.map((s) => [s.id, s.text]));
  const centers = board.beats.filter((b) => b.slot === "C" || b.clear).map((b) => ({ b, i: ids.indexOf(b.at) })).filter((x) => x.i >= 0).sort((x, y) => x.i - y.i);
  const covering = (a, bIdx) => {
    // 在 [a,bIdx] 内生效过的中央镜头：从它的 at 到下一个中央镜头之前
    const out = [];
    centers.forEach((c, k) => {
      const next = centers.slice(k + 1).find((x) => x.i > c.i);
      const endI = (next ? next.i : ids.length) - 1;
      if (c.i <= bIdx && endI >= a) out.push(c.b);
    });
    return out;
  };
  for (const d of list) {
    total++;
    const a = ids.indexOf(d.from), b = ids.indexOf(d.to);
    const bs = covering(a, b);
    const anim = bs.filter((x) => x.kind === "canvas" || x.kind === "stage");
    for (const x of bs.filter((y) => y.kind === "eqx")) {
      for (const n of x.insets ?? []) {
        const ia = ids.indexOf(n.from), iz = ids.indexOf(n.to);
        if (ia <= b && iz >= a) anim.push({ kind: "canvas", form: "free", objs: n.objs, at: n.from });
      }
    }
    const need = Math.max(3, Math.floor((d.beats?.length ?? 0) / 2));
    let verdict = "ok", why = "";
    if (!anim.length && bs.some((x) => ["fig", "table", "chart", "stream"].includes(x.kind))) { verdict = "ok"; why = "论文图表本身就是演示"; }
    else if (!anim.length) { verdict = "none"; why = `这几句的画面是 ${bs.map((x) => x.kind).join("、") || "（空）"}，没有动画演示`; }
    else {
      const best = Math.max(...anim.map((x) => eventsIn(x, ids, texts, a, b)));
      if (best < need) { verdict = "thin"; why = `有 ${anim.map((x) => x.kind + (x.form ? "/" + x.form : "")).join("、")}，但这几句里只有 ${best} 个动画事件，至少需要 ${need} 个`; }
      else if ((d.actors?.length ?? 0) > 0 && !anim.some(hasActors)) { verdict = "nochar"; why = `要演的人物（${d.actors.map((x) => x.as).join("、")}）没有出场`; }
    }
    // 逐个动作对时间：清单里每条画面事件前后 2 秒内有没有动画事件
    let synced = 0, nb = 0;
    if (anim.length) {
      const times = anim.flatMap((x) => eventTimes(x, ids, texts));
      for (const bt of d.beats ?? []) { nb++; const s = estimateSec(bt.at, ids, texts); if (s !== null && times.some((t) => Math.abs(t - s) <= 2.0)) synced++; }
    }
    syncTotal += nb; syncOk += synced;
    if (verdict === "ok" && nb && synced < nb - Math.floor(nb / 4)) { verdict = "unsync"; why = `动作和画面没对上时间：${nb} 个动作里只有 ${synced} 个前后 2 秒有画面事件`; }
    if (verdict === "ok") ok++;
    report.push({ scene: sc.id, from: d.from, to: d.to, kind: d.kind, summary: d.summary, verdict, why, actors: d.actors, beats: d.beats });
  }
}
const by = (v) => report.filter((r) => r.verdict === v);
console.log(`共 ${total} 处需要演示；演出来了 ${ok} 处（${((ok / total) * 100).toFixed(0)}%）`);
console.log(`动作对时：清单里 ${syncTotal} 个动作，前后 2 秒内有画面事件的 ${syncOk} 个（${((syncOk / Math.max(1, syncTotal)) * 100).toFixed(0)}%）`);
console.log(`  对时不合格 ${by("unsync").length}，没有动画 ${by("none").length}，动画太少 ${by("thin").length}，没演人物 ${by("nochar").length}`);
for (const r of report.filter((x) => x.verdict !== "ok")) console.log(`  ✗ ${r.scene}/${r.from}${r.to !== r.from ? "-" + r.to : ""}（${r.kind}）${r.summary} → ${r.why}`);
const outF = flag("--json");
if (outF) writeFileSync(outF, JSON.stringify(report, null, 2));
