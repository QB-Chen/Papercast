// 抓取 arXiv 论文的 HTML 版，整理成流水线能直接用的结构化数据。
//   node scripts/fetch-paper.mjs 2606.09821
// 输出到 projects/<id>/paper/：
//   meta.json       标题、作者、摘要
//   paper.txt       带章节标题的纯文本；行内公式写成 $...$；公式、图、表用 [[EQ eq3]] [[FIG F2]] [[TABLE T1]] 标出
//   equations.json  所有行间公式的原始 LaTeX（来自论文源码，不是模型写的）
//   figures.json    图的编号、说明、文件
//   tables.json     表格内容（二维数组）
// 图片下载到 public/projects/<id>/figs/。
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import * as cheerio from "cheerio";
import { checkOrgs } from "./org-check.mjs";
import { arxivIdOf } from "./lang.mjs";

const id = process.argv[2]; // 项目名；英文版是 <编号>-en，抓取时用去掉后缀的 arXiv 编号
if (!id) throw new Error("用法：node scripts/fetch-paper.mjs <arXiv 编号，如 2606.09821> [--force]");
const arxivId = arxivIdOf(id);
const root = join("projects", id, "paper");
const figDir = join("public", "projects", id, "figs");
mkdirSync(root, { recursive: true });
mkdirSync(figDir, { recursive: true });

const res = await fetch(`https://arxiv.org/html/${arxivId}`, { headers: { "User-Agent": "Mozilla/5.0 paper2video" } });
if (!res.ok) throw new Error(`arXiv HTML 版不可用（HTTP ${res.status}）。这篇论文可能没有 HTML 版，目前只支持有 HTML 版的论文`);
const html = await res.text();
const $ = cheerio.load(html);
const clean = (s) => s.replace(/\s+/g, " ").trim();

/** 把一个节点里的 <math> 替换成 $alttext$ 后取纯文本 */
const textOf = (el) => {
  const c = $(el).clone();
  c.find("math").each((_, m) => {
    const alt = $(m).attr("alttext") ?? "";
    $(m).replaceWith(` $${alt.trim()}$ `);
  });
  c.find("sup.ltx_note_mark, .ltx_note_outer").remove();
  return clean(c.text());
};

// 不同论文的 HTML 结构不一样：标题可能是 h1，也可能只是正文最前面的一段
const topKids = $("article.ltx_document").first().children().toArray();
const firstSection = topKids.findIndex((e) => e.tagName === "section");
const head = topKids.slice(0, firstSection < 0 ? 6 : firstSection);
const headParas = head.filter((e) => /ltx_para|ltx_logical-block|ltx_authors/.test($(e).attr("class") ?? "")).map((e) => textOf(e));
const title = clean($("h1.ltx_title_document").first().text()) || headParas.find((t) => t && t.length < 200 && !/^abstract/i.test(t)) || clean($("title").text());
const authors = clean($(".ltx_authors").first().text()) || headParas.filter((t) => t !== title && !/^abstract/i.test(t)).join(" ");
const abstract = ($(".ltx_abstract").length ? textOf($(".ltx_abstract").first()) : headParas.find((t) => /^abstract/i.test(t))) ?? "";
// 来源白名单：只做大厂的论文（名单在 config/allowed-orgs.json，可编辑）。作者栏、邮箱、摘要里的链接都对不上就停下，--force 可以放行
const emails = [...new Set([...(authors + " " + abstract).matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0]))];
const links = [...new Set([...abstract.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]))];
const orgHits = checkOrgs({ authorsText: authors, emails, links, abstract });
const meta = { id, title, authors, emails, links, orgs: orgHits, abstract, url: `https://arxiv.org/abs/${arxivId}`, arxivId };
writeFileSync(join(root, "meta.json"), JSON.stringify(meta, null, 2));
if (orgHits.length) console.log(`来源：${orgHits.map((h) => `${h.org}（${h.by}：${h.hit}）`).join("、")}`);
else if (process.argv.includes("--force")) console.log("⚠ 来源不在白名单里，已用 --force 放行");
else {
  console.log(`来源不在白名单里（作者栏：${authors.slice(0, 120)}）。名单见 config/allowed-orgs.json；确实要做就加 --force`);
  process.exit(5);
}

const lines = [];
const equations = [];
const figures = [];
const tables = [];
const base = "https://arxiv.org/html/";
let section = "";
let lastPara = ""; // 公式前一段正文
const waiting = []; // 还在等"后一段正文"的公式

const getFigureFile = async (fig, fid) => {
  // 一张图常由左右两个子图组成（多个 <img> 或 <object>），按出现顺序全部下载
  const nodes = fig.find("img, object").toArray();
  const parts = [];
  for (let k = 0; k < nodes.length; k++) {
    const n = $(nodes[k]);
    const src = n.attr("src") ?? n.attr("data");
    if (!src) continue;
    const url = src.startsWith("http") ? src : base + src.replace(/^\//, "");
    const ext = extname(src.split("?")[0]) || ".png";
    const file = nodes.length > 1 ? `${fid}_${k + 1}${ext}` : `${fid}${ext}`;
    const dest = join(figDir, file);
    if (!existsSync(dest)) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        console.log(`  图片下载失败 ${url}：${e.message}`);
        continue;
      }
    }
    parts.push({ file: `projects/${id}/figs/${file}`, w: +(n.attr("width") ?? 0), h: +(n.attr("height") ?? 0) });
  }
  if (!parts.length) return null;
  return { ...parts[0], parts };
};

const doc = $("article.ltx_document").first();
const queue = [];
const walk = (el) => {
  const $el = $(el);
  const tag = el.tagName?.toLowerCase();
  if (!tag) return;
  const cls = $el.attr("class") ?? "";
  if (/ltx_bibliography|ltx_page_footer|ltx_pagination|ltx_TOC/.test(cls)) return;
  if (/^h[1-6]$/.test(tag) && /ltx_title/.test(cls)) {
    const level = Math.min(+tag[1], 4);
    const t = textOf(el);
    if (t) {
      if (level <= 3) section = t;
      lines.push("", `${"#".repeat(Math.max(level - 1, 1))} ${t}`);
    }
    return;
  }
  if (tag === "figure") {
    queue.push(el);
    lines.push(`@@FIG${queue.length - 1}@@`);
    return;
  }
  if (tag === "table" && /ltx_equation|ltx_eqn_table|ltx_equationgroup/.test(cls)) {
    $el.find("tr.ltx_eqn_row, tr.ltx_equation").each((_, tr) => {
      const maths = $(tr).find("math");
      if (!maths.length) return;
      const tex = maths
        .map((__, m) => ($(m).attr("alttext") ?? "").trim())
        .get()
        .join(" ")
        .trim();
      if (!tex) return;
      const num = clean($(tr).find(".ltx_tag_equation").first().text());
      const eid = `eq${equations.length + 1}`;
      const rec = { id: eid, num: num || null, tex, section, before: lastPara.slice(-700), after: "" };
      equations.push(rec);
      waiting.push(rec);
      lines.push(`[[EQ ${eid}${num ? " " + num : ""}]] $$${tex}$$`);
    });
    return;
  }
  if ((tag === "p" && /ltx_p/.test(cls)) || (tag === "div" && /ltx_para/.test(cls) && !$el.find("p.ltx_p").length)) {
    const t = textOf(el);
    if (t) {
      lines.push(t);
      lastPara = t;
      for (const e of waiting.splice(0)) e.after = t.slice(0, 700); // 公式后面那段通常会解释符号
    }
    return;
  }
  $el.children().each((_, c) => walk(c));
};
doc.children().each((_, c) => walk(c));

// 图和表：按出现顺序编号
let nFig = 0;
let nTab = 0;
const blocks = {};
for (let i = 0; i < queue.length; i++) {
  const fig = $(queue[i]);
  const isTable = /ltx_table/.test(fig.attr("class") ?? "") || fig.find("table.ltx_tabular").length > 0;
  const cap = textOf(fig.find("figcaption").first()).replace(/^(Figure|Table)\s*\d+\s*:\s*/i, "");
  if (isTable) {
    nTab++;
    const tid = `T${nTab}`;
    const rows = [];
    fig.find("table.ltx_tabular").first().find("tr").each((_, tr) => {
      const cells = [];
      $(tr).children("td, th").each((__, td) => {
        const t = textOf(td);
        const span = +($(td).attr("colspan") ?? 1);
        cells.push(t);
        for (let k = 1; k < span; k++) cells.push("");
      });
      if (cells.some(Boolean)) rows.push(cells);
    });
    tables.push({ id: tid, caption: cap, rows });
    blocks[i] = `[[TABLE ${tid}]] ${cap}\n${rows.map((r) => r.join(" | ")).join("\n")}`;
  } else {
    nFig++;
    const fid = `F${nFig}`;
    const f = await getFigureFile(fig, fid);
    figures.push({ id: fid, caption: cap, ...(f ?? { file: null }) });
    blocks[i] = `[[FIG ${fid}]] ${cap}${f ? "" : "（图片不可用）"}`;
  }
}
const text = lines.map((l) => l.replace(/^@@FIG(\d+)@@$/, (_, n) => blocks[n])).join("\n").replace(/\n{3,}/g, "\n\n").trim();

writeFileSync(join(root, "paper.txt"), `# ${title}\n\n## Abstract\n${abstract}\n\n${text}\n`);
writeFileSync(join(root, "equations.json"), JSON.stringify(equations, null, 2));
writeFileSync(join(root, "figures.json"), JSON.stringify(figures, null, 2));
writeFileSync(join(root, "tables.json"), JSON.stringify(tables, null, 2));
console.log(`《${title}》`);
console.log(`正文 ${text.length} 字符，公式 ${equations.length} 条，图 ${figures.length} 张（可用 ${figures.filter((f) => f.file).length}），表 ${tables.length} 张`);
console.log(`→ ${root}`);
