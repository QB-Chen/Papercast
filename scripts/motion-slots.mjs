// 判断一个演示能不能用 OpenMotion 式动画替换掉现有分镜里的镜头，以及怎么换。
//   能换的条件：
//   1) 演示起始句 from 上的 C 位置镜头不是公式类（eqx / eq / figure / table 等不能丢）；
//      from 上没有镜头时，说明它被前面的画布罩着，新动画从 from 开始接管，也算能换。
//   2) 动画会一直演到下一个 C 位置镜头出现为止；如果下一个镜头比演示结束（to）晚了一句以上，
//      尾巴会定格，不换（旁白讲得比动画长太多）。
//   3) from..to 里面的其他 C 位置镜头会被这个动画取代（它们本来就在讲同一件事）。
import { readFileSync } from "node:fs";

const KEEP_KINDS = new Set(["eqx", "eq", "figure", "table", "paperfig", "image"]);

export function loadScene(root, sceneId) {
  const board = JSON.parse(readFileSync(`${root}/storyboards/${sceneId}.json`, "utf8"));
  const tl = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8")).scenes.find((s) => s.id === sceneId);
  return { board, ids: tl.sentences.map((s) => s.id) };
}

/** 这个演示是不是落在某个 eqx（公式逐项讲解）占用的句子里？是的话返回 { beat, eqIdx, last }，动画要放进它的 insets（公式下方的演示区） */
export function eqxHost(board, ids, demo) {
  const a = ids.indexOf(demo.from), z = ids.indexOf(demo.to);
  const cs = board.beats.filter((x) => x.slot === "C").map((x) => ({ x, i: ids.indexOf(x.at) })).sort((p, q) => p.i - q.i);
  for (let k = 0; k < cs.length; k++) {
    if (cs[k].x.kind !== "eqx") continue;
    const last = (cs[k + 1]?.i ?? ids.length) - 1;
    if (cs[k].i <= a && z <= last) return { beat: cs[k].x, eqIdx: cs[k].i, last };
  }
  return null;
}

export function installPlan(board, ids, demo) {
  const a = ids.indexOf(demo.from), z = ids.indexOf(demo.to);
  if (a < 0 || z < a) return { ok: false, reason: "句子 id 对不上" };
  // 公式场景：动画放进 eqx 的 insets（公式缩到上方，下面演示）。限制：最多 4 句、不能和别的 inset 重叠、最多 5 段
  const host = eqxHost(board, ids, demo);
  if (host) {
    if (z - a > 3) return { ok: false, reason: `公式下方的演示最多 4 句，这个演示有 ${z - a + 1} 句` };
    const others = (host.beat.insets ?? []).filter((n) => !(ids.indexOf(n.from) === a && ids.indexOf(n.to) === z));
    const clash = others.find((n) => ids.indexOf(n.from) <= z && ids.indexOf(n.to) >= a);
    if (clash) return { ok: false, reason: `和公式下方已有的演示 ${clash.from}~${clash.to} 的句子范围重叠` };
    if (others.length >= 5) return { ok: false, reason: "这条公式下方已经有 5 段演示（上限）" };
    const same = (host.beat.insets ?? []).filter((n) => ids.indexOf(n.from) === a && ids.indexOf(n.to) === z).map((n) => `inset ${n.from}~${n.to}`);
    return { ok: true, inset: true, host: host.beat.at, replaced: same, tail: 0 };
  }
  const idx = (b) => ids.indexOf(b.at);
  const cBeats = board.beats.filter((b) => b.slot === "C");
  const atFrom = cBeats.filter((b) => idx(b) === a);
  const inside = cBeats.filter((b) => idx(b) > a && idx(b) <= z);
  const keep = [...atFrom, ...inside].find((b) => KEEP_KINDS.has(b.kind) || b.eqx);
  if (keep) return { ok: false, reason: `演示范围里有公式/论文图镜头（${keep.at}:${keep.kind}），不能换掉` };
  const after = cBeats.filter((b) => idx(b) > z).map(idx).sort((p, q) => p - q);
  const next = after.length ? after[0] : ids.length; // 下一个 C 镜头的句序号；没有就演到场景结束
  const tail = next - (z + 1);
  if (tail > 1) return { ok: false, reason: `动画演完（${demo.to}）后下一个镜头在 ${ids[next] ?? "场景结束"}，会定格 ${tail} 句` };
  // 被新动画取代的镜头：from..to 里的 C 位置镜头（含 from 上的那个）
  const replaced = [...atFrom, ...inside];
  // from 上没有镜头时，要看前面是不是有 eqx 之类的镜头罩着（换了会把它截断）
  if (!atFrom.length) {
    const prev = cBeats.filter((b) => idx(b) < a).sort((p, q) => idx(q) - idx(p))[0];
    if (prev && (KEEP_KINDS.has(prev.kind) || prev.eqx)) return { ok: false, reason: `前面的公式镜头（${prev.at}:${prev.kind}）还在罩着这里，换了会把它截断` };
  }
  return { ok: true, replaced: replaced.map((b) => `${b.at}:${b.kind}${b.form ? "." + b.form : ""}`), tail };
}

/** 公式场景：把动画写进 eqx 的 insets（有同范围的旧 inset 就替换）。返回新分镜，不改原对象 */
export function installInset(board, ids, demo, motion) {
  const a = ids.indexOf(demo.from), z = ids.indexOf(demo.to);
  const host = eqxHost(board, ids, demo);
  const beats = board.beats.map((x) => {
    if (x !== host.beat) return x;
    const insets = (x.insets ?? []).filter((n) => !(ids.indexOf(n.from) === a && ids.indexOf(n.to) === z));
    insets.push({ from: demo.from, to: demo.to, motion: { ...motion, w: 1600, h: 300 } });
    insets.sort((p, q) => ids.indexOf(p.from) - ids.indexOf(q.from));
    return { ...x, insets };
  });
  return { ...board, beats };
}

export function applyInstall(board, ids, demo, motion) {
  if (eqxHost(board, ids, demo)) return installInset(board, ids, demo, motion);
  const a = ids.indexOf(demo.from), z = ids.indexOf(demo.to);
  const idx = (b) => ids.indexOf(b.at);
  const beats = board.beats.filter((b) => !(b.slot === "C" && idx(b) >= a && idx(b) <= z));
  beats.push({ at: demo.from, slot: "C", kind: "canvas", form: "motion", clear: true, motion });
  beats.sort((p, q) => idx(p) - idx(q));
  return { ...board, beats };
}
