// 画布编译器：把模型写的"画布说明"（只有东西、抽象位置、时间点，没有坐标）算成 canvas 元素用的 cv 原件列表。
// 模型不碰几何：坐标、标签放上面还是下面、括号高度，都由这里算。能在这里确定的冲突，直接返回错误让模型重写。
//
// 说明格式（beat.kind = "canvas"，写 things/marks，cv 由本模块生成）：
//   form: "line"  一把尺子，东西是尺子上的点，可以移动（pos 0~100 是尺子上的抽象位置，不显示）
//          "row"   一排方块，依次长出来，相邻的用箭头连起来（像流水线、层层叠加）；可选 token：一个小数据包沿方块移动
//          "bars"  一排柱子，高度 pos 0~100，moves 让柱子随旁白涨落
//          "tree"  第一个东西是根，其余是它的分支；flow:"out" 一生多（默认），"in" 多合一
//   things: [{id,label,tone,at,until?,sticker?, pos(line 必填), moves?:[{at,pos,arrow?}]}]
//   marks : [{type:"brace",from,to,text,at,until?,tone?} | {type:"ring",who,at,until?,tone?}
//            | {type:"arrow",from,to,text?,at,until?,tone?} | {type:"note",text,at,until?,tone?} | {type:"caption",text,at}]
// 时间锚点同 canvas.tsx：d11 / d11+30 / d11#1 / d11@短语。
// 估算某个时间锚点大约在第几秒（只用旁白字数：约 5 字/秒，句间停顿 0.4 秒；字幕分段 #n 按标点切分估算）
export const CPS = 5;
// 英文没有汉字：按字符数估时用约 15 字符/秒（含空格），字幕每段约 52 个字符。只用来估算，真实时间以配音时间线为准
const isCJK = (t) => /[\u3400-\u9fff]/.test(t ?? "");
const cpsOf = (t) => (isCJK(t) ? CPS : 15);
const segOf = (t) => (isCJK(t) ? 28 : 52);
export function estimateSec(ref, sentenceIds, texts) {
  const m = String(ref ?? "").match(/^([^+#@]+)(?:([+#@])(.*))?$/);
  const i = m ? sentenceIds.indexOf(m[1]) : -1;
  if (i < 0) return null;
  let sec = 0;
  for (let j = 0; j < i; j++) sec += [...(texts[sentenceIds[j]] ?? "")].length / cpsOf(texts[sentenceIds[j]]) + 0.4;
  const text = texts[m[1]] ?? "";
  const n = Math.max(1, [...text].length);
  if (m[2] === "+") sec += Number(m[3]) / 30;
  else if (m[2] === "#") {
    // 字幕每段大约 28 个字（真实分段由配音时间决定，这里只是估算）
    sec += Math.min(n, Number(m[3]) * segOf(text)) / cpsOf(text);
  } else if (m[2] === "@") {
    const ph = m[3].replace(/\+\d+$/, "");
    const k = text.indexOf(ph);
    sec += (k < 0 ? 0 : [...text.slice(0, k)].length) / cpsOf(text) + (m[3].match(/\+(\d+)$/) ? Number(m[3].match(/\+(\d+)$/)[1]) / 30 : 0);
  }
  return sec;
}
export const CANVAS_LAYOUTS = ["line", "row", "bars", "tree"];
const len = (s) => [...(s ?? "")].length;
const TONE_OK = ["teal", "orange", "pink", "navy", "gray", "green"];

let KC = 1; // 英文版画面文字上限放宽（英文一个字符比汉字窄）
export function compileCanvas(b, sentenceIds, texts = {}, lang = "zh") {
  KC = lang === "en" ? 2.4 : 1;
  const errs = [];
  const cv = [];
  const layout = b.form;
  if (!CANVAS_LAYOUTS.includes(layout)) return { cv: [], errs: [`canvas.form 必须是 ${CANVAS_LAYOUTS.join(" 或 ")}`] };
  const rawThings = b.things ?? [];
  // 时间锚点往后推 n 帧：d11 → d11+n；d11+30 → d11+(30+n)；d11@短语 → d11@短语+n；带 # 的不动
  const plus = (ref, n) => {
    if (!n || typeof ref !== "string" || ref.includes("#")) return ref;
    const m = ref.match(/^(.*?)(?:\+(\d+))?$/);
    return `${m[1]}+${(m[2] ? +m[2] : 0) + n}`;
  };
  // 默认规则 2：同一个 at 的多个东西错开出现（每个晚 10 帧），让它们一个个长出来
  const seenAt = new Map();
  const stagger = new Map(); // id -> 错开了第几个
  const things = rawThings.map((t) => {
    const n = seenAt.get(t.at) ?? 0;
    seenAt.set(t.at, n + 1);
    stagger.set(t.id, n);
    return n ? { ...t, at: plus(t.at, 10 * n) } : t;
  });
  const rawAt = new Map(rawThings.map((t) => [t.id, t.at]));
  // 默认规则 1：圈、括号、箭头没写 until 时，只留到下一句开始（要留更久就明确写 until）
  const nextSentence = (ref) => {
    const sid = String(ref ?? "").match(/^[^+#@]+/)?.[0];
    const i = sentenceIds.indexOf(sid);
    return i >= 0 && i + 1 < sentenceIds.length ? sentenceIds[i + 1] : undefined;
  };
  // 默认规则 3：标记和它标的东西写在同一个 at 时，等被标的东西（错开后）出现了再出现
  const marks = (b.marks ?? []).map((m) => {
    let at = m.at;
    const refs = [m.from, m.to, m.who].filter(Boolean);
    const shift = Math.max(0, ...refs.filter((r) => rawAt.get(r) === m.at).map((r) => stagger.get(r) ?? 0));
    if (shift) at = plus(m.at, 10 * shift + 14);
    const until = ["ring", "brace", "arrow"].includes(m.type) && !m.until && m.at ? nextSentence(m.at) : m.until;
    return { ...m, at, ...(until ? { until } : {}) };
  });

  // 时间先后：句子序号 + 句内位置（用于判断"这个动作发生在那个括号之前还是之后"，不需要真实帧）
  const keyOf = (ref) => {
    const m = String(ref ?? "").match(/^([^+#@]+)(?:([+#@])(.*))?$/);
    const i = m ? sentenceIds.indexOf(m[1]) : -1;
    if (i < 0) return null;
    let f = 0;
    if (m[2] === "+") f = Number(m[3]) / 1000;
    else if (m[2] === "#") f = Number(m[3]) * 0.3;
    else if (m[2] === "@") {
      const ph = m[3].replace(/\+\d+$/, "");
      const t = texts[m[1]] ?? "";
      const k = t.indexOf(ph);
      f = (k < 0 ? 0 : k / Math.max(1, t.length)) * 0.98;
      const ex = m[3].match(/\+(\d+)$/);
      if (ex) f += Number(ex[1]) / 10000;
    }
    return i + Math.min(0.99, Math.max(0, f));
  };
  const K = (ref, where) => {
    const k = keyOf(ref);
    if (k === null) errs.push(`${where} 的时间锚点「${ref}」不对（写成 句子id、id+帧数、id#段号 或 id@句中的短语）`);
    return k ?? 0;
  };

  // ---------- 检查 things ----------
  const nMax = layout === "tree" ? 5 : 6;
  const nMin = layout === "bars" ? 2 : 3;
  if (things.length < nMin || things.length > nMax) errs.push(`canvas.things 需要 ${nMin} 到 ${nMax} 个（现在 ${things.length}）${things.length < nMin ? "，东西太少画布会很空；如果只有两样，请改用 compare 或在旁边补上相关的东西" : ""}`);
  if (layout === "bars" && !things.some((x) => (x.moves ?? []).length)) errs.push("bars 里至少要有一根柱子随旁白涨落（写 moves），否则只是几根不动的柱子，没有演示作用。没有数量变化的内容请改用 row（流程）或 tree（分叉、汇合）");
  const byId = new Map();
  for (const [i, t] of things.entries()) {
    const w = `things[${i}]（${t.id}）`;
    if (!t.id || byId.has(t.id)) errs.push(`${w} 的 id 缺失或重复`);
    byId.set(t.id, t);
    if (!t.label || len(t.label) > Math.round(8 * KC)) errs.push(`${w}.label 必填且不超过 ${Math.round(8 * KC)} 个字符`);
    if (t.tone && !TONE_OK.includes(t.tone)) errs.push(`${w}.tone 不合法：${t.tone}`);
    if (!t.at) errs.push(`${w} 缺少 at`);
    if (layout === "line" || layout === "bars") {
      if (typeof t.pos !== "number" || t.pos < 0 || t.pos > 100) errs.push(`${w}.pos 必须是 0 到 100 的数（${layout === "bars" ? "柱子的高度，越大越高" : "尺子上的位置，越大越靠右"}）`);
      for (const [j, m] of (t.moves ?? []).entries()) {
        if (typeof m.pos !== "number" || m.pos < 0 || m.pos > 100) errs.push(`${w}.moves[${j}].pos 必须是 0 到 100 的数`);
        if (!m.at) errs.push(`${w}.moves[${j}] 缺少 at`);
        else if (K(m.at, `${w}.moves[${j}].at`) < K(t.at, `${w}.at`)) errs.push(`${w}.moves[${j}] 早于它出现的时间`);
      }
      if (layout === "bars") {
        let prev = t.pos;
        for (const [j, m] of (t.moves ?? []).entries()) {
          if (typeof m.pos === "number" && Math.abs(m.pos - prev) < 12) errs.push(`${w}.moves[${j}] 柱子只变了 ${Math.abs(m.pos - prev)}，肉眼看不出来；涨落至少差 12，否则就不要写这一步`);
          if (typeof m.pos === "number") prev = m.pos;
        }
      }
    } else if (t.moves?.length) errs.push(`${w}：${layout} 版式里东西不会移动，不要写 moves`);
  }
  if (errs.length) return { cv: [], errs };
  const kAt = new Map(things.map((t) => [t.id, K(t.at, `${t.id}.at`)]));
  // 画布一开始就占着中央，第一个东西必须很快出现，否则观众会看到一整屏空白
  {
    const kb = K(b.at, "canvas.at");
    const first = Math.min(...things.map((t) => kAt.get(t.id)));
    if (first - kb > 0.06) {
      const firstThing = things.find((t) => kAt.get(t.id) === first);
      errs.push(`画布从 ${b.at} 开始占用屏幕，但第一个东西「${firstThing.id}」要到 ${firstThing.at} 才出现，中间是一整屏空白。请把镜头的 at 改成 ${String(firstThing.at).split(/[+#@]/)[0]}（并让第一个东西在该句句首附近出现），或把第一个东西的 at 提前到镜头开始的位置`);
    }
  }
  const kUntil = new Map(things.map((t) => [t.id, t.until ? K(t.until, `${t.id}.until`) : Infinity]));
  const alive = (t, k) => kAt.get(t.id) <= k && k < kUntil.get(t.id);
  for (const t of things) if (kUntil.get(t.id) <= kAt.get(t.id)) errs.push(`things「${t.id}」的 until 早于 at`);

  // 某个东西在某一时刻的位置（line）：已经发生的 moves 依次生效
  const posAt = (t, k) => {
    let p = t.pos;
    for (const m of [...(t.moves ?? [])].sort((a, b) => keyOf(a.at) - keyOf(b.at))) if (keyOf(m.at) <= k) p = m.pos;
    return p;
  };
  const moveKeysIn = (t, k0, k1) => (t.moves ?? []).some((m) => keyOf(m.at) > k0 && keyOf(m.at) < k1);

  // ---------- 检查 marks ----------
  for (const [i, m] of marks.entries()) {
    const w = `marks[${i}]（${m.type}）`;
    if (!["brace", "ring", "arrow", "note", "caption", "point"].includes(m.type)) { errs.push(`${w}.type 必须是 brace/ring/arrow/note/caption/point`); continue; }
    if (!m.at) { errs.push(`${w} 缺少 at`); continue; }
    if (m.type === "arrow" && layout !== "line") { errs.push(`${w}：${layout} 版式里不要写 arrow（${layout === "row" || layout === "tree" ? "箭头已经自动画好了" : "柱子之间不画箭头"}），想强调就用 ring、brace 或 note`); continue; }
    if (layout === "tree" && m.type === "brace" && (m.from === things[0].id || m.to === things[0].id)) { errs.push(`${w}：tree 的括号只能括分支，不能括根「${things[0].id}」`); continue; }
    if (layout === "tree" && m.type === "brace" && len(m.text) > Math.round(6 * KC)) { errs.push(`${w}.text 在 tree 里不超过 ${Math.round(6 * KC)} 个字符`); continue; }
    if (m.tone && !TONE_OK.includes(m.tone)) errs.push(`${w}.tone 不合法：${m.tone}`);
    if (["brace", "note", "caption"].includes(m.type) && (!m.text || len(m.text) > Math.round(8 * KC))) errs.push(`${w}.text 必填且不超过 ${Math.round(8 * KC)} 个字符`);
    if (m.type === "arrow" && m.text && len(m.text) > Math.round(6 * KC)) errs.push(`${w}.text 不超过 ${Math.round(6 * KC)} 个字符`);
    const refs = m.type === "brace" || m.type === "arrow" ? [m.from, m.to] : m.type === "ring" || m.type === "point" ? [m.who] : [];
    for (const r of refs) if (!byId.has(r)) errs.push(`${w} 引用了不存在的东西「${r}」`);
    if (refs.some((r) => !byId.has(r))) continue;
    const k = K(m.at, `${w}.at`);
    const ku = m.until ? K(m.until, `${w}.until`) : Infinity;
    if (ku <= k) errs.push(`${w}.until 早于 at`);
    for (const r of refs) {
      const t = byId.get(r);
      if (!alive(t, k)) errs.push(`${w}：「${r}」在这一刻还没出现（或已消失），括号/圈/箭头只能标已经在画面上的东西`);
      if (layout === "line" && m.type !== "point" && moveKeysIn(t, k, ku)) errs.push(`${w}：「${r}」在它存在期间会移动，会和被标的东西对不上。请给它加 until，设在「${r}」移动之前（或把它放到移动之后）`);
    }
  }
  // token（只用于 row）：一个小数据包依次移到几个方块上，像数据在流水线里走
  const token = b.token;
  if (token && layout !== "row") errs.push("token 只能用在 row 版式");
  if (token && layout === "row") {
    const st = token.steps ?? [];
    if (st.length < 2 || st.length > 6) errs.push(`token.steps 需要 2 到 6 步（现在 ${st.length}）`);
    let prevK = -1;
    st.forEach((s, j) => {
      const th = byId.get(s.to);
      if (!th) { errs.push(`token.steps[${j}].to 引用了不存在的东西「${s.to}」`); return; }
      const kk = K(s.at, `token.steps[${j}].at`);
      if (kk < prevK) errs.push(`token.steps[${j}].at 必须按时间先后排列`);
      prevK = kk;
      if (!alive(th, kk)) errs.push(`token.steps[${j}]：「${s.to}」在这一刻还没出现，数据包不能移到它上面`);
    });
    if (token.tone && !TONE_OK.includes(token.tone)) errs.push(`token.tone 不合法：${token.tone}`);
  }
  if (errs.length) return { cv: [], errs };

  // ---------- 几何 ----------
  const tid = (s) => `t_${s}`;
  const mkEnd = (m) => (m.until ? { until: m.until } : {});
  const sampleKeys = [
    ...things.flatMap((t) => [kAt.get(t.id), ...(t.moves ?? []).map((m) => keyOf(m.at))]),
    ...marks.map((m) => keyOf(m.at)),
  ].filter((x) => x !== null);

  if (layout === "line") {
    const Y = 290, LAB = 190;
    const X = (p) => Math.round(120 + p * 13.6);
    const firstThing = [...things].sort((p, q) => kAt.get(p.id) - kAt.get(q.id))[0]; // 尺子和第一个东西同时出现，不让空尺子先晾着
    cv.push({ id: "ax", type: "axis", at: firstThing.at, x: 60, y: Y, x2: 1540, y2: Y, tone: "gray", dur: 22 });

    // 同一时刻太近的两个东西放不下：直接让模型拉开
    for (const k of sampleKeys) {
      const live = things.filter((t) => alive(t, k + 1e-6));
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const d = Math.abs(posAt(live[i], k + 1e-6) - posAt(live[j], k + 1e-6));
        if (d < 8) errs.push(`「${live[i].id}」和「${live[j].id}」同时在场时 pos 只差 ${d.toFixed(1)}，太近会叠在一起（至少差 8）`);
      }
    }
    // 标签放上面还是下面：默认上面，和已经放好的上面标签会撞就放下面
    const side = new Map();
    for (const t of things) {
      let s = "above";
      for (const o of things) {
        if (o === t || !side.has(o.id) || side.get(o.id) !== s) continue;
        for (const k of sampleKeys) {
          if (!alive(t, k + 1e-6) || !alive(o, k + 1e-6)) continue;
          const gap = Math.abs(X(posAt(t, k + 1e-6)) - X(posAt(o, k + 1e-6)));
          if (gap < (len(t.label) + len(o.label)) * 24 + 24) s = "below";
        }
      }
      for (const o of things) {
        if (o === t || side.get(o.id) !== "below" || s !== "below") continue;
        for (const k of sampleKeys) {
          if (!alive(t, k + 1e-6) || !alive(o, k + 1e-6)) continue;
          const gap = Math.abs(X(posAt(t, k + 1e-6)) - X(posAt(o, k + 1e-6)));
          if (gap < (len(t.label) + len(o.label)) * 22 + 24) errs.push(`「${t.id}」和「${o.id}」的标签在尺子上下都放不开，请把它们的 pos 拉得更远`);
        }
      }
      side.set(t.id, s);
    }
    const anyBelow = [...side.values()].includes("below");
    const BR = anyBelow ? 420 : 352;
    const R = 34;

    for (const t of things) {
      const mv = [...(t.moves ?? [])].sort((a, c) => keyOf(a.at) - keyOf(c.at));
      const moves = mv.map((m) => ({ at: m.at, x: X(m.pos), dur: 34, ease: "spring" }));
      cv.push({ id: tid(t.id), type: "dot", at: t.at, ...(t.until ? { until: t.until } : {}), x: X(t.pos), y: Y, r: t.sticker ? 38 : R, tone: t.tone ?? "navy", ...(t.sticker ? { sticker: t.sticker } : {}), ...(side.get(t.id) === "below" ? { text: t.label, size: 44 } : {}), ...(moves.length ? { moves } : {}) });
      if (side.get(t.id) === "above") cv.push({ id: `${tid(t.id)}_l`, type: "text", at: t.at, ...(t.until ? { until: t.until } : {}), x: X(t.pos), y: LAB, size: 48, tone: t.tone ?? "navy", text: t.label, ...(moves.length ? { moves } : {}) });
      // 移动时自动画一支"推"的箭头：从旧位置指向新位置，到下一句开始时收掉
      for (const m of mv) {
        if (!m.arrow) continue;
        const k = keyOf(m.at);
        const from = X(posAt(t, k - 1e-6)), to = X(m.pos);
        const dir = Math.sign(to - from) || 1;
        const sentI = sentenceIds.indexOf(String(m.at).match(/^[^+#@]+/)[0]);
        const nextId = sentenceIds[sentI + 1];
        if (Math.abs(to - from) < 140) continue; // 移动太短，箭头画不下，只让点自己滑过去
        cv.push({ id: `${tid(t.id)}_push${cv.length}`, type: "arrow", at: m.at, ...(nextId ? { until: nextId } : {}), x: from + dir * 48, y: Y - 50, x2: to - dir * 48, y2: Y - 50, bend: 0, tone: t.tone ?? "navy", dur: 18, flow: true });
      }
    }
    if (token) {
      const st = token.steps;
      const idxOf = (id) => things.findIndex((x) => x.id === id);
      cv.push({ id: "token", type: "dot", at: st[0].at, ...(token.until ? { until: token.until } : {}), x: cx(idxOf(st[0].to)), y: 120, r: 18, tone: token.tone ?? "orange", moves: st.slice(1).map((s) => ({ at: s.at, x: cx(idxOf(s.to)), dur: 30, ease: "soft" })) });
    }
    const notes = marks.filter((m) => m.type === "note").sort((a, c) => keyOf(a.at) - keyOf(c.at)); // 结论小块：后一个替换前一个
    const captions = marks.filter((m) => m.type === "caption").sort((a, c) => keyOf(a.at) - keyOf(c.at));
    marks.forEach((m, i) => {
      const k = keyOf(m.at);
      const id = `m${i}`;
      const tone = m.tone ?? (m.type === "brace" ? "orange" : m.type === "note" ? "pink" : "teal");
      if (m.type === "brace") {
        let x1 = X(posAt(byId.get(m.from), k)), x2 = X(posAt(byId.get(m.to), k));
        if (x1 > x2) [x1, x2] = [x2, x1];
        cv.push({ id, type: "brace", at: m.at, ...mkEnd(m), x: x1, y: BR, x2, y2: BR, dir: "down", tone, text: m.text, size: 44 });
      } else if (m.type === "ring") {
        const t = byId.get(m.who);
        const below = side.get(t.id) === "below";
        // 圈要把点和它的标签一起圈住：标签在上面就把圈往上扩，在下面就往下扩
        const w = Math.max(190, len(t.label) * 48 + 50);
        // 圈的左右边界不能把别的东西（点或它的标签）切开：别的东西要么完全在圈里，要么完全在圈外
        {
          const cx0 = X(posAt(t, k)), r0 = cx0 - w / 2 - 6, r1 = cx0 + w / 2 + 6;
          const ku2 = m.until ? keyOf(m.until) : Infinity;
          for (const o of things) {
            if (o === t) continue;
            for (const kk of [k, ...sampleKeys.filter((s) => s > k && s < ku2)]) {
              if (!alive(o, kk + 1e-6)) continue;
              const ox = X(posAt(o, kk + 1e-6)), half = Math.max(R + 4, len(o.label) * 24 + 6);
              const cut = ox + half > r0 && ox - half < r1 && !(ox - half >= r0 && ox + half <= r1);
              if (cut) { errs.push(`marks[${i}]（ring）：圈住「${t.id}」时会把「${o.id}」切开（它们在尺子上离得太近）。请把「${o.id}」和「${t.id}」的 pos 至少拉开 ${Math.ceil((w / 2 + half + 12) / 13.6)}，或换成别的标记`); break; }
            }
          }
        }
        cv.push({ id, type: "ring", at: m.at, ...mkEnd(m), x: X(posAt(t, k)), y: Y + (below ? 24 : -50), w, h: 210, tone: m.tone ?? "gray", seed: 3 + i, width: 7 });
      } else if (m.type === "arrow") {
        const x1 = X(posAt(byId.get(m.from), k)), x2 = X(posAt(byId.get(m.to), k));
        const dir = Math.sign(x2 - x1) || 1;
        if (Math.abs(x2 - x1) < 200) errs.push(`marks[${i}]（arrow）：「${m.from}」到「${m.to}」太近，画不出箭头`);
        cv.push({ id, type: "arrow", at: m.at, ...mkEnd(m), x: x1 + dir * 48, y: Y - 60, x2: x2 - dir * 48, y2: Y - 60, bend: 0, tone, ...(m.text ? { text: m.text, size: 40 } : {}), dur: 24, flow: true });
      } else if (m.type === "note") {
        const slot = { x: 1250, y: 462 };
        const nextNote = notes[notes.indexOf(m) + 1];
        cv.push({ id, type: "box", at: m.at, ...(nextNote ? { until: nextNote.at } : mkEnd(m)), x: slot.x, y: slot.y, w: 360, h: 88, tone, fill: true, text: m.text, size: 44 });
      } else if (m.type === "caption") {
        const next = captions[captions.indexOf(m) + 1];
        cv.push({ id, type: "text", at: m.at, ...(next ? { until: next.at } : mkEnd(m)), x: 800, y: 70, size: 46, tone: "navy", text: m.text });
      }
    });
  } else if (layout === "row") {
    // row：一排方块，按 things 顺序从左到右；总数决定宽度，先出现的也站在自己最终的位置，不会后来被挤开
    const n = things.length;
    const GAP = 90;
    const bw = Math.min(300, Math.floor((1480 - (n - 1) * GAP) / n));
    const total = n * bw + (n - 1) * GAP;
    const x0 = Math.round((1600 - total) / 2 + bw / 2);
    const Y = 235, H = 120;
    const cx = (i) => x0 + i * (bw + GAP);
    things.forEach((t, i) => {
      cv.push({ id: tid(t.id), type: "box", at: t.at, ...(t.until ? { until: t.until } : {}), x: cx(i), y: Y, w: bw, h: H, tone: t.tone ?? "navy", ...(t.sticker ? { sticker: t.sticker } : {}), fill: false, text: t.label, size: 44, enter: "pop" });
      if (i > 0 && alive(t, kAt.get(t.id))) {
        const prev = things[i - 1];
        cv.push({ id: `link${i}`, type: "arrow", at: t.at, ...(t.until ? { until: t.until } : {}), x: cx(i - 1) + bw / 2 + 12, y: Y, x2: cx(i) - bw / 2 - 12, y2: Y, bend: 0, tone: "gray", dur: 14, width: 6, flow: true });
        if (kAt.get(prev.id) > kAt.get(t.id)) errs.push(`row 里「${t.id}」排在「${prev.id}」后面，却比它先出现：请按从左到右的出现顺序写 things`);
      }
    });
    const notes = marks.filter((m) => m.type === "note").sort((a, c) => keyOf(a.at) - keyOf(c.at)); // 结论小块：后一个替换前一个
    const captions = marks.filter((m) => m.type === "caption").sort((a, c) => keyOf(a.at) - keyOf(c.at));
    marks.forEach((m, i) => {
      const id = `m${i}`;
      const tone = m.tone ?? (m.type === "brace" ? "orange" : m.type === "note" ? "pink" : "teal");
      const idx = (r) => things.findIndex((t) => t.id === r);
      if (m.type === "brace") {
        let a = idx(m.from), c = idx(m.to);
        if (a > c) [a, c] = [c, a];
        cv.push({ id, type: "brace", at: m.at, ...mkEnd(m), x: cx(a) - bw / 2, y: Y + H / 2 + 36, x2: cx(c) + bw / 2, y2: Y + H / 2 + 36, dir: "down", tone, text: m.text, size: 44 });
      } else if (m.type === "ring") {
        cv.push({ id, type: "ring", at: m.at, ...mkEnd(m), x: cx(idx(m.who)), y: Y, w: bw + 50, h: H + 40, tone: m.tone ?? "teal", seed: 3 + i, width: 7 });
      } else if (m.type === "arrow") {
        errs.push(`marks[${i}]：row 版式里相邻方块已经自动用箭头连好了，不要再写 arrow`);
      } else if (m.type === "note") {
        const slot = { x: 1250, y: 462 };
        const nextNote = notes[notes.indexOf(m) + 1];
        cv.push({ id, type: "box", at: m.at, ...(nextNote ? { until: nextNote.at } : mkEnd(m)), x: slot.x, y: slot.y, w: 360, h: 88, tone, fill: true, text: m.text, size: 44 });
      } else if (m.type === "caption") {
        const next = captions[captions.indexOf(m) + 1];
        cv.push({ id, type: "text", at: m.at, ...(next ? { until: next.at } : mkEnd(m)), x: 800, y: 70, size: 46, tone: "navy", text: m.text });
      }
    });
  } else if (layout === "bars") {
    // bars：一排柱子，从左到右按 things 的顺序；柱子高度 = pos，moves 让它涨落；标签在柱子下面
    const n = things.length;
    const slotW = Math.min(240, Math.floor(1400 / n));
    const bw = Math.min(150, Math.floor(slotW * 0.62));
    const x0 = 800 - (n * slotW) / 2 + slotW / 2;
    const base = 360, SC = 2.0;
    const bx = (i) => Math.round(x0 + i * slotW);
    const idx = (r) => things.findIndex((x) => x.id === r);
    const firstThing = [...things].sort((p, q) => kAt.get(p.id) - kAt.get(q.id))[0];
    cv.push({ id: "ax", type: "axis", at: firstThing.at, x: 100, y: base + 4, x2: 1500, y2: base + 4, tone: "gray", arrow: false, dur: 20 });
    things.forEach((th, i) => {
      const fs = Math.max(26, Math.min(44, Math.floor((slotW - 16) / Math.max(1, len(th.label)))));
      const moves = (th.moves ?? []).map((m) => ({ at: m.at, x: bx(i), h: Math.round(m.pos * SC), dur: 36, ease: "spring" }));
      cv.push({ id: tid(th.id), type: "bar", at: th.at, ...(th.until ? { until: th.until } : {}), x: bx(i), y: base, w: bw, h: Math.round(th.pos * SC), tone: th.tone ?? "navy", enter: "out", dur: 22, ...(moves.length ? { moves } : {}) });
      cv.push({ id: tid(th.id) + "_l", type: "text", at: th.at, ...(th.until ? { until: th.until } : {}), x: bx(i), y: base + 44, size: fs, tone: th.tone ?? "navy", text: th.label });
    });
    const notes = marks.filter((m) => m.type === "note").sort((a, c) => keyOf(a.at) - keyOf(c.at));
    const captions = marks.filter((m) => m.type === "caption").sort((a, c) => keyOf(a.at) - keyOf(c.at));
    marks.forEach((m, i) => {
      const id = "m" + i;
      const tone = m.tone ?? (m.type === "brace" ? "orange" : m.type === "note" ? "pink" : "teal");
      if (m.type === "brace") {
        let a = idx(m.from), c = idx(m.to);
        if (a > c) [a, c] = [c, a];
        cv.push({ id, type: "brace", at: m.at, ...mkEnd(m), x: bx(a) - slotW / 2 + 14, y: 440, x2: bx(c) + slotW / 2 - 14, y2: 440, dir: "down", tone, text: m.text, size: 40 });
      } else if (m.type === "ring") {
        cv.push({ id, type: "ring", at: m.at, ...mkEnd(m), x: bx(idx(m.who)), y: 285, w: slotW - 34, h: 290, tone: m.tone ?? "teal", seed: 3 + i, width: 7 });
      } else if (m.type === "note") {
        const nextNote = notes[notes.indexOf(m) + 1];
        cv.push({ id, type: "box", at: m.at, ...(nextNote ? { until: nextNote.at } : mkEnd(m)), x: 1330, y: 62, w: 340, h: 80, tone, fill: true, text: m.text, size: 42 });
      } else if (m.type === "caption") {
        const next = captions[captions.indexOf(m) + 1];
        cv.push({ id, type: "text", at: m.at, ...(next ? { until: next.at } : mkEnd(m)), x: 800, y: 56, size: 46, tone: "navy", text: m.text });
      }
    });
  } else {
    // tree：第一个东西是根，其余是分支。flow "out"：根在左，分支在右，箭头从根发散；"in"：分支在左汇入右边的根
    const out = (b.flow ?? "out") !== "in";
    const root = things[0];
    const kids = things.slice(1);
    const nk = kids.length;
    if (nk < 1 || nk > 4) errs.push("tree 需要 1 到 4 个分支（加上根一共 2 到 5 个东西）");
    for (const kd of kids) if (kAt.get(kd.id) < kAt.get(root.id)) errs.push("tree 里根「" + root.id + "」必须最先出现，分支「" + kd.id + "」不能比它早");
    const RX = out ? 330 : 1270, RW = 340, RH = 110, RY = 260;
    const KX = out ? 1060 : 540, KW = 340, KH = 80, STEP = 104;
    const ky = (i) => Math.round(RY + (i - (nk - 1) / 2) * STEP);
    cv.push({ id: tid(root.id), type: "box", at: root.at, ...(root.until ? { until: root.until } : {}), x: RX, y: RY, w: RW, h: RH, tone: root.tone ?? "navy", ...(root.sticker ? { sticker: root.sticker } : {}), fill: false, text: root.label, size: 46, enter: "pop" });
    kids.forEach((kd, i) => {
      cv.push({ id: tid(kd.id), type: "box", at: kd.at, ...(kd.until ? { until: kd.until } : {}), x: KX, y: ky(i), w: KW, h: KH, tone: kd.tone ?? "teal", ...(kd.sticker ? { sticker: kd.sticker } : {}), fill: false, text: kd.label, size: 42, enter: "pop" });
      const a = out ? { x: RX + RW / 2 + 12, y: RY, x2: KX - KW / 2 - 12, y2: ky(i) } : { x: KX + KW / 2 + 12, y: ky(i), x2: RX - RW / 2 - 12, y2: RY };
      cv.push({ id: "link" + i, type: "arrow", at: kd.at, ...(kd.until ? { until: kd.until } : {}), ...a, bend: 0, tone: "gray", dur: 16, width: 6, flow: true });
    });
    const notes = marks.filter((m) => m.type === "note").sort((a, c) => keyOf(a.at) - keyOf(c.at));
    const captions = marks.filter((m) => m.type === "caption").sort((a, c) => keyOf(a.at) - keyOf(c.at));
    const kIdx = (r) => kids.findIndex((x) => x.id === r);
    marks.forEach((m, i) => {
      const id = "m" + i;
      const tone = m.tone ?? (m.type === "brace" ? "orange" : m.type === "note" ? "pink" : "teal");
      if (m.type === "brace") {
        let a = kIdx(m.from), c = kIdx(m.to);
        if (a < 0 || c < 0) { errs.push("marks[" + i + "]（brace）：tree 的括号两端必须是分支"); return; }
        if (a > c) [a, c] = [c, a];
        const bxx = out ? KX + KW / 2 + 20 : KX - KW / 2 - 20;
        cv.push({ id, type: "brace", at: m.at, ...mkEnd(m), x: bxx, y: ky(a) - KH / 2, x2: bxx, y2: ky(c) + KH / 2, dir: out ? "down" : "up", tone, text: m.text, size: 40 });
      } else if (m.type === "ring") {
        const ri = kIdx(m.who);
        cv.push(ri < 0
          ? { id, type: "ring", at: m.at, ...mkEnd(m), x: RX, y: RY, w: RW + 50, h: RH + 50, tone: m.tone ?? "teal", seed: 3 + i, width: 7 }
          : { id, type: "ring", at: m.at, ...mkEnd(m), x: KX, y: ky(ri), w: KW + 40, h: KH + 8, tone: m.tone ?? "teal", seed: 3 + i, width: 7 });
      } else if (m.type === "note") {
        const nextNote = notes[notes.indexOf(m) + 1];
        cv.push({ id, type: "box", at: m.at, ...(nextNote ? { until: nextNote.at } : mkEnd(m)), x: RX, y: 462, w: 360, h: 80, tone, fill: true, text: m.text, size: 42 });
      } else if (m.type === "caption") {
        const next = captions[captions.indexOf(m) + 1];
        cv.push({ id, type: "text", at: m.at, ...(next ? { until: next.at } : mkEnd(m)), x: 800, y: 488, size: 44, tone: "navy", text: m.text });
      }
    });
  }
  // 提到就弹一下：旁白里每次说到某个东西的名字（label，或 label 去掉末尾的字、至少 3 字），它就放大再回落。
  // 范围：从画布开始的那句往后 8 句；每句只算第一次出现。
  {
    const i0 = sentenceIds.indexOf(b.at);
    const span = i0 >= 0 ? sentenceIds.slice(i0, i0 + 8) : [];
    for (const th of things) {
      const forms = [th.label];
      for (let n = len(th.label) - 1; n >= 3; n--) forms.push([...th.label].slice(0, n).join(""));
      const anchors = [];
      for (const sid of span) {
        const text = texts[sid] ?? "";
        const hit = forms.find((x) => x && text.includes(x));
        if (hit) anchors.push(`${sid}@${hit}`);
      }
      // point 标记：模型明确"指一下"的时刻
      for (const m of marks) if (m.type === "point" && m.who === th.id) anchors.push(m.at);
      if (!anchors.length) continue;
      for (const it of cv) if (it.id === tid(th.id) || it.id === tid(th.id) + "_l") it.pulse = [...new Set(anchors)].slice(0, 12);
    }
  }
  return { cv, errs };
}

// 动作对时：收集一个镜头里所有"画面事件"的估算时间（秒）
export function eventTimes(beat, ids, texts) {
  const out = [];
  const add = (ref) => { const s = estimateSec(ref, ids, texts); if (s !== null) out.push(s); };
  if (beat.kind === "canvas" && beat.form === "motion") {
    // OpenMotion 式动画：时间锚点写在脚本的 cue("句子id@原话") 里
    for (const m of String(beat.motion?.script ?? "").matchAll(/cue\(\s*(["'`])([^"'`]*?)\1\s*\)/g)) add(m[2]);
  } else if (beat.kind === "canvas" && beat.form === "free") {
    for (const o of beat.objs ?? []) { add(o.at); for (const k of o.keys ?? []) add(k.at); for (const p of o.pulse ?? []) add(p); }
  } else if (beat.kind === "canvas") {
    for (const it of beat.cv ?? []) { add(it.at); for (const m of it.moves ?? []) add(m.at); for (const p of it.pulse ?? []) add(p); }
  } else if (beat.kind === "stage") {
    for (const a of beat.acts ?? []) add(a.at);
  }
  return out;
}
