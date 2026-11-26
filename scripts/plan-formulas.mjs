// 为每个场景里要讲的重点公式，规划"逐项讲解"：把公式拆成几个部分，写清每一部分叫什么、起什么作用、为什么。
//   node scripts/plan-formulas.mjs <arXiv 编号> [--model sensenova/kimi-k3]
// 输入：plan.json（每个场景的 refs.eq）、paper/equations.json（含公式前后各一段正文）
// 输出：plan.json 里每个场景多一个 formulas 字段；简报末尾追加"必须逐项讲解的公式"一节（旁白写手据此逐项讲）。
// 防编造：part.tex 必须是公式 LaTeX 里的原文片段（逐字相同、括号配对、KaTeX 能渲染）；每个 part 必须附一段论文原文 quote。
import { readFileSync, writeFileSync } from "node:fs";
import katex from "katex";
import { chatJson } from "./llm.mjs";
import { langOf } from "./lang.mjs";

const args = process.argv.slice(2);
const id = args[0];
if (!id) throw new Error("用法：node scripts/plan-formulas.mjs <arXiv 编号>");
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "sensenova/kimi-k3";
const root = `projects/${id}`;
const EN = langOf(id) === "en"; // 英文版：name/say/role/why/overview 都写英文，字数上限换成字符数
const K = EN ? 2.6 : 1;
const plan = JSON.parse(readFileSync(`${root}/plan.json`, "utf8"));
const equations = JSON.parse(readFileSync(`${root}/paper/equations.json`, "utf8"));
const paperText = readFileSync(`${root}/paper/paper.txt`, "utf8");
const norm = (s) => s.toLowerCase().replace(/\$/g, "").replace(/\s+/g, "");
const normPaper = norm(paperText);

export const sanitizeTex = (tex) =>
  tex.replace(/\\begin\{split\}/g, "\\begin{aligned}").replace(/\\end\{split\}/g, "\\end{aligned}").replace(/\\color\[[^\]]*\]\{[^}]*\}/g, "").replace(/\\displaystyle/g, "").replace(/\\operatorname\*/g, "\\operatorname").replace(/\\nonumber|\\notag/g, "");

const SYSTEM_ZH = `你是一位数学科普老师，擅长把一条公式拆开，一项一项讲给初中生听。
我会给你一个视频场景要用到的几条论文公式（LaTeX 原文，以及公式前后的论文正文），请你挑出其中最值得讲的至多 2 条，为每条设计"逐项讲解"：

1. overview：一句话说这条公式整体在做什么（不超过 36 字，中文，不念符号）。
2. parts：把公式拆成 3 到 6 个部分，按它们在公式 LaTeX 里出现的先后顺序排列。每个部分：
   - tex：这一部分的 LaTeX，必须是公式 LaTeX 里的原文片段，逐字复制（包括反斜杠、花括号、下标上标），片段内的 { } 要成对，不要以 _ 或 ^ 开头，各部分之间不能重叠。片段要有意义，比如"一个带下标的符号""一个分式""一个函数调用""一个完整的项"，不要切成单个字符。
   - name：这一部分叫什么（中文，不超过 10 字，如"贝塔""参考模型的概率""两者的差"）。符号要给出读法。
   - say：旁白里会用来指这一部分的 1 到 3 个中文词（2~6 个字），如 ["贝塔","偏离程度"]。旁白写手会被要求讲到这一项时说出其中一个词。
   - role：这一部分在公式里起什么作用（中文，不超过 24 字）。
   - why：为什么它会有这个作用、为什么要这样设计（中文，不超过 40 字，用初中生能懂的话，可以用一个类比）。
   - quote：论文原文里解释这一部分含义的一小段连续英文摘录（10~200 字符，原样复制，不要改动）。论文没有明确解释时，选最相关的一句。如果 why 是你根据公式结构推出来的，而不是论文明说的，why 要以"从公式看，"开头。
3. 先挑公式：优先选核心方法、核心推导里的公式；单纯的定义或太长太杂的公式不要选。

只输出 JSON：{"formulas":[{"eq":"eq4","overview":"…","parts":[{"tex":"…","name":"…","say":["…"],"role":"…","why":"…","quote":"…"}]}]}。没有值得讲的公式时输出 {"formulas":[]}。`;

const LANG_EN = `

【语言：英文版（最高优先级，覆盖上面所有"中文"和字数的要求）】
overview、name、say、role、why 全部用英文写，口吻是口语化的英文，不要写希腊字母和符号，符号要用读法（"beta"、"the reference model's probability"）。
- overview 不超过 ${Math.round(36 * K)} 个字符。
- name 不超过 ${Math.round(10 * K)} 个字符。
- say：1 到 3 个旁白里会用来指这一部分的英文词或短语（1~3 个单词，每个 3~24 个字符，小写即可，如 ["beta","the penalty"]）；旁白写手会被要求说出其中之一，所以要选自然会说出口的词。
- role 不超过 ${Math.round(24 * K)} 个字符；why 不超过 ${Math.round(40 * K)} 个字符（"从公式看，"改成 "From the formula, "）。
- tex 和 quote 的要求不变。`;
const SYSTEM = SYSTEM_ZH + (EN ? LANG_EN : "");

// 中文旁白里念得出来的词：有汉字，没有英文字母、数字、括号、下划线（旁白校验不允许这些，写进 say 就永远讲不到）
const sayOk = (x) => /[\u4e00-\u9fff]/.test(x) && !/[A-Za-z0-9()（）_\\^{}]/.test(x);
/** 修复已有计划里不合格的 say：去掉念不出来的词；一个都不剩就取名字里的汉字部分 */
export function fixSay(plan) {
  let n = 0;
  for (const sc of plan.scenes) for (const f of sc.formulas ?? []) for (const p of f.parts) {
    const good = (p.say ?? []).filter(sayOk);
    if (good.length === (p.say ?? []).length && good.length) continue;
    n++;
    if (good.length) p.say = good;
    else {
      const han = (p.name ?? "").replace(/[^\u4e00-\u9fff]/g, "").slice(0, 6);
      p.say = han.length >= 2 ? [han] : [(p.role ?? "").replace(/[^\u4e00-\u9fff]/g, "").slice(0, 4) || "这一项"];
    }
  }
  return n;
}

function checkParts(eq, f, errs, w) {
  const src = sanitizeTex(eq.tex);
  let from = 0;
  (f.parts ?? []).forEach((p, i) => {
    const pw = `${w} 第 ${i + 1} 项`;
    const tex = sanitizeTex(p.tex ?? "");
    const at = tex ? src.indexOf(tex, from) : -1;
    if (!tex) errs.push(`${pw} 缺少 tex`);
    else if (at < 0) errs.push(`${pw} 的 tex「${p.tex}」不是公式 ${f.eq} 里的原文片段（或者没有按先后顺序排列、与上一项重叠）。必须从公式的 LaTeX 里逐字复制：${eq.tex.slice(0, 200)}`);
    else {
      from = at + tex.length;
      if (/^\s*[_^]/.test(tex)) errs.push(`${pw} 的 tex 不能以 _ 或 ^ 开头，请把它前面的符号一起包含进来`);
      if ((tex.match(/\{/g) ?? []).length !== (tex.match(/\}/g) ?? []).length) errs.push(`${pw} 的 tex 里 { } 不成对`);
      else {
        // 试渲染：把这一项包起来能不能通过
        try {
          katex.renderToString(`${src.slice(0, at)}\\htmlClass{hlpart}{${tex}}${src.slice(at + tex.length)}`, { throwOnError: true, strict: "ignore", trust: (c) => c.command === "\\htmlClass" });
        } catch (e) {
          errs.push(`${pw} 的 tex 包起来后公式无法渲染（${String(e.message).slice(0, 80)}），请换一个括号完整、切分位置合理的片段`);
        }
      }
    }
    for (const [k, max0] of [["name", 10], ["role", 24], ["why", 40]]) {
      const max = Math.round(max0 * K);
      if (!p[k] || [...p[k]].length > max) errs.push(`${pw} 的 ${k} 为空或超过 ${max} 个字符：「${p[k] ?? ""}」`);
    }
    if (!Array.isArray(p.say) || p.say.length < 1 || p.say.length > 3 || p.say.some((x) => typeof x !== "string" || [...x].length < 2 || [...x].length > (EN ? 28 : 8) || (EN && (/[\u4e00-\u9fff]/.test(x) || x.trim().split(/\s+/).length > 3)) || (!EN && !sayOk(x)))) errs.push(EN ? `${pw} 的 say 需要 1 到 3 个英文词或短语（每个 1~3 个单词、不超过 28 个字符、不含中文）` : `${pw} 的 say 需要 1 到 3 个 2~6 字的中文词`);
    if (!p.quote || norm(p.quote).length < 10) errs.push(`${pw} 缺少 quote（论文原文摘录）`);
    else if (!normPaper.includes(norm(p.quote))) errs.push(`${pw} 的 quote 在论文里找不到：「${p.quote.slice(0, 70)}」，必须从论文正文原样复制`);
  });
}

async function planScene(sc) {
  const eqs = (sc.refs?.eq ?? []).map((e) => equations.find((q) => q.id === e)).filter(Boolean);
  if (!eqs.length) return [];
  const user = `【场景】${sc.title}：${sc.goal}\n\n【这个场景可用的公式】\n${eqs.map((e) => `--- ${e.id}${e.num ? " " + e.num : ""}（${e.section}）\nLaTeX：${e.tex}\n公式前文：${e.before}\n公式后文：${e.after}`).join("\n\n")}\n\n请挑选并设计逐项讲解，只输出 JSON。`;
  const validate = (o) => {
    const errs = [];
    if (!Array.isArray(o?.formulas)) return ['顶层必须是 {"formulas":[…]}'];
    if (o.formulas.length > 2) errs.push("最多选 2 条公式");
    o.formulas.forEach((f, i) => {
      const w = `formulas[${i}]（${f.eq}）`;
      const eq = eqs.find((q) => q.id === f.eq);
      if (!eq) return errs.push(`${w}：eq 必须是上面列出的公式 id 之一`);
      if (!f.overview || [...f.overview].length > Math.round(36 * K)) errs.push(`${w} 的 overview 为空或超过 ${Math.round(36 * K)} 个字符`);
      if (!(f.parts?.length >= 3 && f.parts.length <= 6)) errs.push(`${w} 的 parts 需要 3 到 6 项`);
      else checkParts(eq, f, errs, w);
    });
    return errs;
  };
  const { obj, errors } = await chatJson(model, [{ role: "system", content: SYSTEM }, { role: "user", content: user }], validate, {
    maxRounds: 5,
    temperature: 0.3,
    maxTokens: 16000,
    tag: `formulas-${sc.id}`,
    stream: true,
    timeoutMs: 1_800_000,
  });
  if (!obj) throw new Error(`场景 ${sc.id} 的公式规划失败：${errors.slice(0, 4).join("；")}`);
  return obj.formulas;
}

const FIX_ONLY = args.includes("--fix-say");
const targets = FIX_ONLY ? [] : plan.scenes.filter((s) => s.refs?.eq?.length);
if (FIX_ONLY) console.log(EN ? "（英文版不需要修 say）" : `修复了 ${fixSay(plan)} 项不合格的 say 词，重写简报`);
else console.log(`为 ${targets.length} 个场景规划公式逐项讲解（模型 ${model}）`);
const queue = [...targets];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const sc = queue.shift();
      sc.formulas = await planScene(sc);
      console.log(`  ${sc.id}：${sc.formulas.map((f) => `${f.eq}（${f.parts.length} 项）`).join("、") || "没有选公式"}`);
    }
  }),
);

// ---- 回写 plan.json 和简报 ----
for (const sc of plan.scenes) {
  sc.formulas = sc.formulas ?? [];
  const f = `${root}/briefs/${sc.id}.md`;
  let md = readFileSync(f, "utf8").replace(/\n## 必须逐项讲解的公式[\s\S]*?(?=\n## |$)/, "");
  if (sc.formulas.length) {
    const sec = sc.formulas
      .map((fm) => {
        const lines = fm.parts.map((p, i) => `  ${i + 1}. 「${p.name}」——作用：${p.role}；为什么：${p.why}（讲到它时必须说出这些词之一：${p.say.join("、")}）`);
        return `- 公式 ${fm.eq}：${fm.overview}\n${lines.join("\n")}`;
      })
      .join("\n");
    const json = JSON.stringify(sc.formulas.map((fm) => ({ eq: fm.eq, overview: fm.overview, parts: fm.parts.map((p) => ({ name: p.name, say: p.say, role: p.role, why: p.why })) })));
    md = md.replace(
      "\n## 画面建议",
      `\n## 必须逐项讲解的公式\n**这个场景有公式，必须这样讲：**先用一句话说这条公式整体在做什么；然后严格按下面的顺序，一项一项讲，每一项单独用一到两句话，说清它叫什么（说出名字）、起什么作用、为什么会有这个作用，最好配一个小例子；讲到某一项时一定要说出它后面括号里给的词，让观众知道你指的是公式的哪一部分；最后用一句话把各项合起来。不要把整条公式念一遍就带过，旁白里也不要出现希腊字母和下标，用名字称呼。\n${sec}\n公式逐项JSON: ${json}\n\n## 画面建议`,
    );
    // 逐项讲解需要更多句子：每条公式 项数 + 2 句
    const need = sc.formulas.reduce((a, fm) => a + fm.parts.length + 2, 0);
    const m = String(sc.sentences).match(/^(\d+)\s*[-~]\s*(\d+)$/);
    if (m) {
      const lo = Math.max(+m[1], Math.ceil(need * 0.9));
      const hi = Math.max(+m[2], need + 4, lo + 2);
      sc.sentences = `${lo}-${hi}`;
      md = md.replace(/^句数:.*$/m, `句数: ${sc.sentences}`);
    }
  }
  writeFileSync(f, md);
}
writeFileSync(`${root}/plan.json`, JSON.stringify(plan, null, 2));
console.log(`→ 已写回 ${root}/plan.json 和各场景简报`);
