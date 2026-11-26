// 在 LottieFiles 公开动画里，按"概念"搜候选，并用程序筛掉不适合放进 Remotion 的：
//   - 文件大（> 90KB）、有文字层、有内嵌图片、有表达式（渲染可能闪烁）、画布太扁、背景是整块纯色
// 通过的候选写到 llm-test/lottie-cands.json，并生成一张预览页（每个概念一排）。授权页另外用 lottie-license.mjs 核对。
import { writeFileSync } from "node:fs";
const URL_ = "https://graphql.lottiefiles.com/";
const CONCEPTS = JSON.parse(process.argv[2] ?? JSON.stringify({
  idea: ["light bulb idea", "idea lamp", "lightbulb"],
  thumbsup: ["thumbs up", "like"],
  question: ["question mark", "thinking question"],
  check: ["success check", "checkmark", "tick"],
  confetti: ["confetti", "party popper"],
  warning: ["warning alert", "attention"],
  magnifier: ["search magnifier", "magnifying glass"],
  growth: ["growing chart", "growth arrow", "bar chart growth"],
  star: ["sparkle star", "stars"],
  cross: ["error cross", "wrong"],
  heart: ["heart like", "love"],
  rocket: ["rocket launch"],
}));
const QUERY = `query($q:String!,$n:Int){ searchPublicAnimations(query:$q, first:$n){ edges{ node{ id name url gifUrl jsonUrl lottieFileSize downloads createdBy{ username } } } } }`;
async function gql(q, n = 12) {
  const r = await fetch(URL_, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify({ query: QUERY, variables: { q, n } }), signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  return (j.data?.searchPublicAnimations?.edges ?? []).map((e) => e.node);
}
/** 检查 Lottie JSON：返回问题列表（空 = 合格） */
function inspect(j) {
  const bad = [];
  const w = j.w, h = j.h;
  if (!w || !h) return ["没有画布尺寸"];
  if (w / h > 1.6 || h / w > 1.6) bad.push(`画布比例 ${w}x${h}`);
  if ((j.assets ?? []).some((a) => a.p && !a.layers)) bad.push("含内嵌图片");
  const layers = [...(j.layers ?? []), ...(j.assets ?? []).flatMap((a) => a.layers ?? [])];
  if (layers.some((l) => l.ty === 5)) bad.push("含文字层");
  if (layers.some((l) => l.ty === 1 && l.sw >= w * 0.9 && l.sh >= h * 0.9 && !l.hd)) bad.push("有整块纯色背景层");
  if (JSON.stringify(j).includes('"x":"')) bad.push("含表达式");
  const dur = (j.op - j.ip) / (j.fr || 30);
  if (dur > 8) bad.push(`时长 ${dur.toFixed(1)}s 太长`);
  return bad;
}
const out = {};
const rows = [];
for (const [concept, queries] of Object.entries(CONCEPTS)) {
  const seen = new Set();
  const ok = [];
  for (const q of queries) {
    for (const n of await gql(q)) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (!n.jsonUrl || (n.lottieFileSize ?? 0) > 90 * 1024 || !n.lottieFileSize) continue;
      try {
        const j = await (await fetch(n.jsonUrl, { signal: AbortSignal.timeout(30000) })).json();
        const bad = inspect(j);
        if (!bad.length) ok.push({ id: n.id, name: n.name, url: n.url, json: n.jsonUrl, gif: n.gifUrl, kb: Math.round(n.lottieFileSize / 1024), by: n.createdBy?.username, w: j.w, h: j.h, fr: j.fr, sec: +((j.op - j.ip) / j.fr).toFixed(1) });
      } catch {}
      if (ok.length >= 8) break;
    }
    if (ok.length >= 8) break;
  }
  out[concept] = ok;
  console.log(concept.padEnd(10), `${ok.length} 个合格`, ok.slice(0, 4).map((x) => `${x.name}(${x.kb}KB)`).join(" | "));
  rows.push(`<div style="margin:4px 0"><b style="font:13px sans-serif;color:#c33;display:inline-block;width:80px">${concept}</b>${ok.map((x, i) => `<span style="display:inline-block;width:130px;text-align:center;font:9px sans-serif"><img src="${x.gif}" width="120" height="120" style="object-fit:contain;background:#fff"/><div>#${i} ${(x.name ?? "").slice(0, 16)} ${x.kb}K</div></span>`).join("")}</div>`);
}
writeFileSync("llm-test/lottie-cands.json", JSON.stringify(out, null, 2));
writeFileSync("llm-test/lottie-cands.html", `<html><body style="background:#EAF2F1;margin:8px;width:1250px">${rows.join("")}</body></html>`);
