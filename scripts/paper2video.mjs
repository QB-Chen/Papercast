// 论文 → 讲解视频 一键流水线。
//   node scripts/paper2video.mjs <arXiv 编号> [--minutes 10] [--auto]
//   node scripts/paper2video.mjs <arXiv 编号> --approve 1        # 确认检查点 1 后继续往下跑
//   node scripts/paper2video.mjs <arXiv 编号> --from boards      # 从某个阶段重来
//   node scripts/paper2video.mjs <arXiv 编号> --only voice
//
// 阶段：fetch(抓论文) → plan(规划场景+简报) ┃检查点1┃ → narration(写旁白+审查+修订+数字审计) ┃检查点2┃ → voice(配音)
//        → boards(设计分镜+静帧拼图) ┃检查点3┃ → render(渲染+成片核对)
// 检查点：到这里会停下，写出 projects/<id>/CHECKPOINT-n.md，请人看过、必要时改过，再用 --approve n 继续；--auto 跳过所有检查点。
// 所有产物都在 projects/<id>/ 下，每个阶段可以单独重跑，已完成的阶段默认跳过。
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream, copyFileSync } from "node:fs";
import { join } from "node:path";
import { speakify } from "./lib.mjs";
import { SUPPORTED } from "./lang.mjs";
import { packOf } from "./lang-pack.mjs";

const args = process.argv.slice(2);
let id = args.find((a) => !a.startsWith("--") && !/^\d$/.test(a) && !["plan", "fetch", "narration", "voice", "boards", "render"].includes(a)) ?? args[0];
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
// 视频语言：--lang zh|en。英文版用独立的项目目录 <编号>-en（论文素材、旁白、配音、分镜都各自一份，不影响中文版）
const lang = flag("--lang", /-en$/.test(id ?? "") ? "en" : "zh");
if (!SUPPORTED.includes(lang)) throw new Error(`--lang 只支持 ${SUPPORTED.join("、")}`);
if (id && lang === "en" && !/-en$/.test(id)) id = `${id}-en`;
process.env.VIDEO_LANG = lang; // 所有子进程都读这个
const force = args.includes("--force"); // 论文来源不在白名单里也继续
if (!id || id.startsWith("--")) throw new Error("用法：node scripts/paper2video.mjs <arXiv 编号> [--minutes 10] [--auto] [--approve n] [--from 阶段] [--only 阶段]");
const minutes = +flag("--minutes", 10);
const auto = args.includes("--auto");
const root = join("projects", id);
mkdirSync(join(root, "logs"), { recursive: true });
mkdirSync(join(root, "out"), { recursive: true });
process.env.PATH += ";E:\\Program Files\\ffmpeg\\bin";

const MODELS = {
  plan: flag("--plan-model", "sensenova/kimi-k3"),
  write: flag("--write-model", "sensenova/kimi-k3"),
  review: flag("--review-model", "sensenova/glm-5.3"),
  board: flag("--board-model", "sensenova/kimi-k3"),
  boardFallback: "sensenova/sensenova-6.8-flash",
  boardFallback2: "sensenova/deepseek-flash",
  demos: flag("--demos-model", "sensenova/kimi-k3"), // 找出旁白里要演出来的地方
  motion: flag("--motion-model", "sensenova/deepseek-flash"), // 写动画代码
  motionJudge: flag("--motion-judge-model", "sensenova/glm-5.3"), // 读时间线的文字评审（和写代码的不同家）
  motionVision: flag("--motion-vision-model", "sensenova/kimi-k3"), // 看画面截图的评审（需要能看图的模型）
  qa: flag("--qa-model", "sensenova/kimi-k3"), // 渲染后画面质检（需要能看图的模型）
};
const STAGES = [
  { name: "fetch" },
  { name: "plan", cp: 1 },
  { name: "narration", cp: 2 },
  { name: "voice" },
  { name: "boards" },
  { name: "motion" },
  { name: "qa", cp: 3 },
  { name: "render" },
];

// ---------- 状态 ----------
const stateFile = join(root, "state.json");
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8").replace(/^\uFEFF/, "")) : { done: {}, approved: {} }; // 手改过的文件可能带 BOM
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const approve = flag("--approve");
const from = flag("--from");
if (from) {
  const i = STAGES.findIndex((s) => s.name === from);
  if (i < 0) throw new Error(`没有阶段 ${from}`);
  STAGES.slice(i).forEach((s) => {
    delete state.done[s.name];
    if (s.cp) delete state.approved[s.cp];
  });
  save();
}
if (approve) {
  state.approved[approve] = true;
  save();
  console.log(`已确认检查点 ${approve}`);
}
const only = flag("--only");

// ---------- 子进程 ----------
function run(cmd, cmdArgs, logName) {
  return new Promise((resolve) => {
    const log = createWriteStream(join(root, "logs", `${logName}.log`), { flags: "a" });
    log.write(`\n$ ${cmd} ${cmdArgs.join(" ")}\n`);
    const p = spawn(cmd, cmdArgs, { shell: false, windowsHide: true });
    p.stdout.on("data", (d) => log.write(d));
    p.stderr.on("data", (d) => log.write(d));
    p.on("close", (code) => {
      log.end();
      resolve(code ?? 1);
    });
  });
}
const node = (script, a, logName) => run("node", [`scripts/${script}`, ...a], logName);
async function pool(items, n, fn) {
  const q = [...items];
  const results = [];
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (q.length) {
        const it = q.shift();
        results.push(await fn(it));
      }
    }),
  );
  return results;
}
const readPlan = () => JSON.parse(readFileSync(join(root, "plan.json"), "utf8"));
const say = (m) => console.log(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${m}`);

/** 每个场景取 9 帧静帧，拼成联系图（给检查点 3 看） */
async function stillSheets() {
  // 每个场景取 9 帧静帧，拼成联系图，给检查点 3 看
  const tl = join(root, "timeline.json");
  const frames = [];
  const list = await new Promise((resolve) => {
    let o = "";
    const p = spawn("node", ["scripts/sample-frames.mjs", tl, "9"]);
    p.stdout.on("data", (d) => (o += d));
    p.on("close", () => resolve(o));
  });
  for (const line of list.trim().split("\n")) frames.push(...line.split(":")[1].split(","));
  const c = await node("stills.mjs", ["--comp", "Paper", "--input-props", join(root, "props.json"), "--frames", frames.join(","), "--prefix", "st", "--out", join(root, "out")], "stills");
  if (c) throw new Error("静帧渲染失败，见 logs/stills.log");
  await node("sample-frames.mjs", ["--sheets", tl, "9", join(root, "out", "st")], "stills");
}
// ---------- 各阶段 ----------
const impl = {
  async fetch() {
    const c = await node("fetch-paper.mjs", [id, ...(force ? ["--force"] : [])], "fetch");
    if (c === 5) throw new Error("论文来源不在白名单里（config/allowed-orgs.json），确实要做就加 --force，见 logs/fetch.log");
    if (c) throw new Error("抓取论文失败，见 logs/fetch.log");
  },

  async plan() {
    const c = await node("plan-scenes.mjs", [id, "--minutes", String(minutes), "--model", MODELS.plan], "plan");
    if (c) throw new Error("场景规划失败，见 logs/plan.log");
    // 把要讲的公式拆成"逐项讲解"的小项（同时更新 plan.json 和各场景简报）
    const f = await node("plan-formulas.mjs", [id, "--model", MODELS.plan], "plan-formulas");
    if (f) throw new Error("公式逐项规划失败，见 logs/plan-formulas.log");
    // 给公式的每一项配一个角色（把"为什么"演出来）
    const a = await node("plan-actors.mjs", [id, "--model", MODELS.plan], "plan-actors");
    if (a) throw new Error("公式角色规划失败，见 logs/plan-actors.log");
  },

  async narration() {
    const plan = readPlan();
    const dir = join(root, "narration");
    mkdirSync(dir, { recursive: true });
    // 某个场景失败不要立刻退出（别的场景的子进程还在跑，会变成孤儿）：全部跑完再统一报错，已完成的场景下次直接跳过
    const narrFailed = [];
    await pool(plan.scenes, +flag("--narr-parallel", 5), async (s) => {
     try {
      const base = join(dir, s.id);
      const brief = join(root, "briefs", `${s.id}.md`);
      if (!existsSync(`${base}.draft.json`)) {
        say(`写稿 ${s.id}`);
        const c = await node("gen-narration.mjs", ["--brief", brief, "--prefix", s.prefix, "--model", MODELS.write, "--out", `${base}.draft.json`], `narration-${s.id}`);
        if (c) throw new Error(`场景 ${s.id} 写稿失败，见 logs/narration-${s.id}.log`);
      }
      if (!existsSync(`${base}.review.json`) || !existsSync(`${base}.style.json`)) {
        say(`审查 ${s.id}（事实 + 风格）`);
        const jobs = [];
        if (!existsSync(`${base}.review.json`))
          jobs.push(node("review-narration.mjs", ["--brief", brief, "--in", `${base}.draft.json`, "--model", MODELS.review, "--excerpt", "full", "--paper", join(root, "paper", "paper.txt"), "--out", `${base}.review.json`], `narration-${s.id}`));
        if (!existsSync(`${base}.style.json`))
          jobs.push(node("review-style.mjs", ["--in", `${base}.draft.json`, "--brief", brief, "--model", MODELS.review, "--out", `${base}.style.json`], `narration-${s.id}-style`));
        const codes = await Promise.all(jobs);
        if (codes.some((c) => c) || !existsSync(`${base}.review.json`) || !existsSync(`${base}.style.json`)) throw new Error(`场景 ${s.id} 审查失败，见 logs/narration-${s.id}*.log`);
      }
      if (!existsSync(`${base}.revised.json`)) {
        say(`修订 ${s.id}`);
        const c = await node("revise-narration.mjs", ["--in", `${base}.draft.json`, "--review", `${base}.review.json,${base}.style.json`, "--out", `${base}.revised.json`, "--model", MODELS.write], `narration-${s.id}`);
        if (c) throw new Error(`场景 ${s.id} 修订失败，见 logs/narration-${s.id}.log`);
      }
     } catch (e) {
      narrFailed.push(e.message);
      say(`✗ ${e.message}`);
     }
    });
    if (narrFailed.length) throw new Error(`${narrFailed.length} 个场景没写成：${narrFailed.join("；")}`);
    assembleNarration(plan);
    await node("audit-numbers.mjs", [id], "audit");
  },

  async voice() {
    // 1. 给每句定语速（难点放慢、过渡略快）；已有 pace.json 就沿用，想重新定就删掉它
    if (!existsSync(join(root, "narration", "pace.json"))) {
      const p = await node("plan-pace.mjs", [id, "--model", MODELS.review], "voice");
      if (p) throw new Error("语速规划失败，见 logs/voice.log");
    }
    // 2. 逐句配音（按语速调风格和变速，句间停顿也跟着变）
    const c = await node("make-voice.mjs", ["--project", id], "voice");
    if (c) throw new Error("配音失败，见 logs/voice.log");
    // 3. 字幕对齐：用 whisper 逐字时间戳算出每段字幕在配音里真正开始说的时间
    const a = await node("align-captions.mjs", ["--project", id], "voice");
    if (a) throw new Error("字幕对齐失败，见 logs/voice.log");
  },

  async boards() {
    const plan = readPlan();
    if (!existsSync(join(root, "narration", "demos.json"))) {
      say("找出旁白里需要演示的片段（例子、比喻、动作）");
      const d = await node("plan-demos.mjs", [id, "--model", MODELS.demos], "plan-demos");
      if (d || !existsSync(join(root, "narration", "demos.json"))) throw new Error("演示清单生成失败，见 logs/plan-demos.log");
    }
    const dir = join(root, "storyboards");
    mkdirSync(dir, { recursive: true });
    const failed = [];
    await pool(plan.scenes, 2, async (s) => {
      const out = join(dir, `${s.id}.json`);
      if (existsSync(out)) return;
      for (const m of [MODELS.board, MODELS.boardFallback, MODELS.boardFallback2]) {
        say(`分镜 ${s.id}（${m.split("/")[1]}）`);
        const c = await node("gen-storyboard.mjs", ["--project", id, "--in", join(root, "narration", `${s.id}.final.json`), "--scene", s.id, "--tag", s.tag, "--model", m, "--out", out], `boards-${s.id}`);
        if (!c && existsSync(out)) return;
      }
      failed.push(s.id);
    });
    if (failed.length) throw new Error(`这些场景的分镜没生成成功：${failed.join("、")}，见 logs/boards-*.log`);
    let c = await node("build-props.mjs", [id], "boards");
    if (c) throw new Error("build-props 失败（分镜引用了不存在的素材），见 logs/boards.log");
    // 画布的重叠/出界预警（不阻断，只提示；几何用平滑缓动近似，最终以静帧为准）
    const cc = await node("check-canvas.mjs", [id], "canvas-check");
    if (cc) say("⚠ 画布几何有预警（重叠或出界），见 logs/canvas-check.log；可以删掉该场景的分镜用 --from boards 重做");
    await stillSheets();
  },
  async motion() {
    // 全部由本地网关模型完成：导演写动作脚本 → 动画师写代码 → 真浏览器检查 → 文字评审 + 看图评审 → 改写 → 装进分镜。不需要人盯。
    const mdir = join(root, "narration", "motion");
    mkdirSync(mdir, { recursive: true });
    say("每个演示生成多个候选，评审后挑最好的（只做现有分镜里能直接换掉的演示；没做成的保留原画面）");
    const g = await node("gen-motion-best.mjs", [id, "--candidates", flag("--motion-candidates", "1"), "--concurrency", flag("--motion-parallel", "2"), "--target", flag("--motion-target", "0.6"), "--model", MODELS.motion, "--judge-models", MODELS.motionJudge, "--vision-model", MODELS.motionVision], "motion-gen");
    if (g) say("⚠ 批量生成有失败，见 logs/motion-gen.log；失败的演示保留原画面");
    const c = await node("install-motion.mjs", [id], "motion-install");
    if (c) throw new Error("安装动画后锚点检查或 props 构建失败，见 logs/motion-install.log（分镜已备份在 storyboards-before-motion-*）");
    const tc = await run("cmd", ["/c", "npx", "tsc", "--noEmit"], "motion-tsc");
    if (tc) say("⚠ tsc 有报错，见 logs/motion-tsc.log");
    say(`审片报告：${join(root, "motion-report.md")}`);
    await stillSheets();
  },
  async qa() {
    // 自动改进：不需要人盯，任何论文都走同一套。
    // ① 演示级检测 + 修复循环（auto-improve）：对 demos.json 里每个演示，看渲染出来的帧判断有没有演出来；
    //    "需修改"的按毛病类型重做这一个演示（整块画布或公式下方的演示区都行），复测更好才保留，否则恢复。
    // ② 整体质检（qa-render）：每句抽一帧，找文字倒置、公式被裁、标签被挡等，写 qa-report.md。
    // 渲染器本身的 bug（比如公式被裁）不能靠重新生成动画解决，会留在报告里并让这一步以"需要人看"收尾，不会静默放行。
    const ai = await node("auto-improve.mjs", [id, "--rounds", flag("--qa-fix-rounds", "2"), "--model", MODELS.motion, "--qa-model", MODELS.qa], "qa-auto-improve");
    if (ai === 4) say("⚠ 演示级检测有调用没跑成，结果不完整，见 logs/qa-auto-improve.log");
    else if (ai === 3) say("⚠ 自动改进后仍有演示需要修改，见 auto-improve-report.md（检查点 3 要人看）");
    else if (ai !== 0) throw new Error("自动改进出错，见 logs/qa-auto-improve.log");
    const c = await node("qa-render.mjs", [id, "--model", MODELS.qa], "qa");
    if (c === 4) say("⚠ 整体质检有调用没跑成，结果不完整，见 logs/qa.log");
    else if (c !== 0 && c !== 3) throw new Error("画面质检没跑成，见 logs/qa.log");
    say(c === 3 || ai === 3 ? "⚠ 仍有问题，见 qa-report.md 和 auto-improve-report.md，需要人看一眼" : "画面质检通过（没有 high 级毛病，演示都成立）");
    await stillSheets();
  },
  async render() {
    // 渲染前安全检查：全片所有时间锚点必须能解析，否则渲染会在中途崩溃（可能已经跑了一个多小时）
    const ca = await node("check-anchors.mjs", [id], "check-anchors");
    if (ca) throw new Error("有时间锚点解析不了，渲染会在中途崩溃，见 logs/check-anchors.log。请删掉有问题的场景分镜，用 --from boards 重做");
    const out = join(root, "out", "video.mp4");
    const ps = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "render-retry.ps1", "-Comp", "Paper", "-Out", out, "-Scale", "0.75", "-Concurrency", "2", "-PerTryMinutes", "150", "-MaxTries", "2", "-Props", join(root, "props.json")];
    const c = await run("powershell", ps, "render");
    if (c || !existsSync(out)) throw new Error("渲染失败，见 logs/render.log");
    await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,duration,nb_frames", "-of", "compact", out], "verify");
    await node("check-video-audio.mjs", [out, join(root, "timeline.json"), join(root, "narration.json")], "verify");
    say(`完成：${out}`);
  },
};

/** 把各场景修订后的旁白(叠加人工修改)合成 narration.json，并为每个场景写 .final.json */
function assembleNarration(plan) {
  const base = JSON.parse(readFileSync("narration/drpo.json", "utf8")); // 借用配音设置（模型、音色、风格、语速）
  if (lang === "en") Object.assign(base, { voice: packOf("en").voice, style: packOf("en").ttsStyle, tempo: packOf("en").tempo });
  const meta = JSON.parse(readFileSync(join(root, "paper", "meta.json"), "utf8"));
  const fixFile = join(root, "narration", "manual-fixes.json");
  const fixes = existsSync(fixFile) ? JSON.parse(readFileSync(fixFile, "utf8")) : {};
  // 读音词表：字幕保留原文，配音按词表里的读法念。按"词"替换，不绑定句子 id，重写旁白后也不会错位
  const lexFile = join(root, "narration", "lexicon.json");
  const lexicon = existsSync(lexFile) ? JSON.parse(readFileSync(lexFile, "utf8")) : {};
  const lexKeys = Object.keys(lexicon).sort((a, b) => b.length - a.length);
  const stale = [];
  const scenes = plan.scenes.map((s) => {
    const sentences = JSON.parse(readFileSync(join(root, "narration", `${s.id}.revised.json`), "utf8")).sentences.map((x) => ({ ...x }));
    for (const [sid, fx] of Object.entries(fixes[s.id] ?? {})) {
      const t = sentences.find((x) => x.id === sid);
      if (!t) {
        stale.push(`${s.id}/${sid}（句子已不存在）`);
        continue;
      }
      // 人工修改是按句子 id 记的，旁白重写后同一个 id 可能是完全不同的句子。必须带 orig（当时被修改的那句原文），对不上就丢弃，绝不套用
      if (fx.orig !== t.text) {
        stale.push(`${s.id}/${sid}（${fx.orig ? "原句已变" : "没有记录原句 orig"}）`);
        continue;
      }
      t.llmText = t.text;
      if (fx.text) t.text = fx.text;
      if (fx.speak) t.speak = fx.speak; // 只改读法、不改字幕
    }
    for (const t of sentences) {
      if (t.speak || !lexKeys.some((k) => t.text.includes(k))) continue;
      t.speak = speakify(lexKeys.reduce((acc, k) => acc.split(k).join(` ${lexicon[k]} `), t.text), lang);
    }
    writeFileSync(join(root, "narration", `${s.id}.final.json`), JSON.stringify({ sentences: sentences.map(({ id: i, text, visual }) => ({ id: i, text, visual })) }, null, 2));
    return { id: s.id, sentences };
  });
  writeFileSync(join(root, "narration.json"), JSON.stringify({ ...base, lang, paper: { title: meta.title, arxiv: meta.arxivId ?? id }, scenes }, null, 2));
  if (stale.length) say(`⚠ 这些人工修改已过期，没有套用：${stale.join("、")}`);
}

// ---------- 检查点报告 ----------
function writeCheckpoint(n) {
  const plan = readPlan();
  let md = "";
  if (n === 1) {
    md = `# 检查点 1：场景规划与论文事实\n\n论文：《${plan.title}》\n贯穿比喻：${plan.metaphor ? `${plan.metaphor.name}（${plan.metaphor.mapping}）` : "无"}\n\n`;
    md += `**请重点看：** ① 场景拆分合不合理；② 每条「论文事实」的中文复述有没有和原文意思对不上（原文摘录都已自动核对过确实在论文里）；③ 局限有没有写进最后一个场景。\n\n改法：直接改 \`projects/${id}/plan.json\` 和 \`projects/${id}/briefs/*.md\`（简报是旁白写手读的），改完运行：\n\n    node scripts/paper2video.mjs ${id} --approve 1\n\n`;
    for (const s of plan.scenes) {
      md += `## ${s.prefix} ${s.id}：${s.title}（${s.sentences} 句）\n目标：${s.goal}\n\n`;
      s.facts.forEach((f, i) => (md += `${i + 1}. ${f.zh}\n   - 原文：“${f.quote}”\n`));
      md += `\n素材：${JSON.stringify(s.refs ?? {})}\n\n`;
    }
  } else if (n === 2) {
    md = `# 检查点 2：旁白\n\n**请重点看：** ① 数字审计里标出的句子（下面第一部分）；② 审查模型挑出的问题（第二部分）；③ 通读一遍旁白是否通顺、是否有悬空引用（"它叫什么名字"却没说名字）。\n\n改法：在 \`projects/${id}/narration/manual-fixes.json\` 里按 {"场景id":{"句子id":{"text":"新句子","reason":"原因"}}} 写，然后：\n\n    node scripts/paper2video.mjs ${id} --from narration --approve 2\n\n（--from narration 会重新合并，已写好的草稿、审查结果不会重做。）\n\n`;
    md += `## 一、数字审计\n${readFileSync(join(root, "audit-numbers.md"), "utf8").replace(/^# .*\n/, "")}\n`;
    md += `## 二、审查模型发现的问题\n`;
    for (const s of plan.scenes) {
      const rf = join(root, "narration", `${s.id}.review.json`);
      if (!existsSync(rf)) continue;
      const bad = JSON.parse(readFileSync(rf, "utf8")).reviews.filter((r) => r.verdict !== "ok" && r.verdict !== "比喻");
      if (!bad.length) continue;
      const sents = JSON.parse(readFileSync(join(root, "narration", `${s.id}.draft.json`), "utf8")).sentences;
      md += `### ${s.id}\n` + bad.map((r) => `- **${r.id}**（${r.verdict}）「${sents.find((x) => x.id === r.id)?.text ?? ""}」\n  - 问题：${r.issue}\n  - 依据：${r.evidence}`).join("\n") + "\n";
    }
    md += `\n## 三、旁白全文\n`;
    for (const s of plan.scenes) {
      md += `### ${s.id}：${s.title}\n` + JSON.parse(readFileSync(join(root, "narration", `${s.id}.final.json`), "utf8")).sentences.map((x) => `${x.id}：${x.text}`).join("\n") + "\n\n";
    }
  } else if (n === 3) {
    md = `# 检查点 3：分镜与动画\n\n画面质检报告（渲染后抽帧，由看图模型找文字倒置、贴图没退场等毛病）：projects/${id}/qa-report.md\n\n动画审片报告（哪些演示用了模型生成的动画、哪些没做成、还有什么问题）：projects/${id}/motion-report.md\n\n每个场景一张联系图（9 帧）：\n\n` + plan.scenes.map((s) => `- ${s.id}：projects/${id}/out/st_sheet_${s.id}.jpg`).join("\n");
    md += `\n\n**请重点看：** ① 画面里的数字、公式、图是否和旁白对得上；② 有没有大片空白、文字重叠；③ 同一种元素是否用得太多。\n\n改法：直接改 \`projects/${id}/storyboards/<场景>.json\`（或删掉它再用 \`--from boards\` 让模型重做），改完：\n\n    node scripts/build-props.mjs ${id}\n    node scripts/paper2video.mjs ${id} --approve 3\n`;
  }
  const f = join(root, `CHECKPOINT-${n}.md`);
  writeFileSync(f, md);
  return f;
}

// ---------- 主循环 ----------
const sequence = only ? STAGES.filter((s) => s.name === only) : STAGES;
for (let i = 0; i < sequence.length; i++) {
  const st = sequence[i];
  const idx = STAGES.indexOf(st);
  const prevCp = idx > 0 ? STAGES[idx - 1].cp : undefined;
  if (!only && prevCp && !state.approved[prevCp] && !auto) {
    console.log(`\n等待确认检查点 ${prevCp}：请看 ${join(root, `CHECKPOINT-${prevCp}.md`)}，确认后运行\n  node scripts/paper2video.mjs ${id} --approve ${prevCp}`);
    process.exit(10);
  }
  if (state.done[st.name] && !only) {
    say(`跳过 ${st.name}（已完成）`);
    continue;
  }
  say(`开始 ${st.name}`);
  const t0 = Date.now();
  try {
    await impl[st.name]();
  } catch (e) {
    console.log(`\n阶段 ${st.name} 失败：${e.message}`);
    process.exit(1);
  }
  state.done[st.name] = new Date().toISOString();
  save();
  say(`完成 ${st.name}（${((Date.now() - t0) / 60000).toFixed(1)} 分钟）`);
  if (st.cp && !auto && !only && !state.approved[st.cp]) {
    const f = writeCheckpoint(st.cp);
    console.log(`\n检查点 ${st.cp}：请看 ${f}，确认后运行\n  node scripts/paper2video.mjs ${id} --approve ${st.cp}`);
    process.exit(10);
  }
  if (st.cp && (auto || only)) writeCheckpoint(st.cp);
}
console.log("\n全部完成");
