// 用当前的校验规则检查一个项目的所有分镜（含论文素材的核对）。
//   node scripts/validate-project.mjs <arXiv 编号> [--fix-focus] [--scene hook,out]
// 退出码：有任何问题 → 1；全部通过 → 0。（以前永远是 0，导致 qa-fix / install-motion 里的"分镜校验"从不拦截）
// --fix-focus：把"图说明里没提分区、却被放大到某一块"的 fig 镜头自动改成 all（记入 manualEdits）
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { validateStoryboard } from "./storyboard-schema.mjs";
import { isSoft } from "./error-classes.mjs";

const id = process.argv[2];
const fix = process.argv.includes("--fix-focus");
const sceneArg = process.argv.indexOf("--scene");
const onlyScenes = sceneArg >= 0 ? String(process.argv[sceneArg + 1] ?? "").split(",").filter(Boolean) : null;
const root = `projects/${id}`;
const plan = JSON.parse(readFileSync(`${root}/plan.json`, "utf8"));
const pj = (n) => JSON.parse(readFileSync(`${root}/paper/${n}.json`, "utf8"));
const paper = { text: readFileSync(`${root}/paper/paper.txt`, "utf8"), equations: pj("equations"), figures: pj("figures"), tables: pj("tables") };
const ctx = { paper, lang: plan.lang ?? "zh", rules: { objectStickers: [], metaphorLeash: false, springSemantics: false } };
let total = 0;
let softTotal = 0;
for (const s of plan.scenes) {
  if (onlyScenes && !onlyScenes.includes(s.id)) continue;
  const file = `${root}/storyboards/${s.id}.json`;
  if (!existsSync(file)) continue;
  const board = JSON.parse(readFileSync(file, "utf8"));
  if (fix) {
    for (const b of board.beats.filter((x) => x.kind === "fig")) {
      const cap = paper.figures.find((f) => f.id === b.ref)?.caption ?? "";
      if (/left|right|top|bottom|upper|lower|\(a\)|\(b\)|\(c\)|panel/i.test(cap)) continue;
      const changed = (b.focusSteps ?? []).filter((st) => st.focus !== "all");
      if (!changed.length) continue;
      b.manualEdits = undefined;
      board.manualEdits = [...(board.manualEdits ?? []), { at: b.at, kind: "fig", reason: "图说明里没提分区，看不到图的模型不应放大某一块：focus 全部改为 all", before: JSON.parse(JSON.stringify(b.focusSteps)) }];
      b.focusSteps.forEach((st) => (st.focus = "all"));
    }
    writeFileSync(file, JSON.stringify(board, null, 2));
  }
  if (fix) {
    // 同一个 eq 镜头里重复放了同一条公式：合并成一行（出现时间取第一次，高亮取并集，说明取最后一次）
    let changed = false;
    for (const b of board.beats.filter((x) => x.kind === "eq")) {
      const out = [];
      for (const e of b.eqs ?? []) {
        const prev = e.eq ? out.find((o) => o.eq === e.eq) : null;
        if (!prev) out.push({ ...e });
        else {
          prev.hl = [...new Set([...(prev.hl ?? []), ...(e.hl ?? [])])];
          if (e.note) prev.note = e.note;
          if (e.title) prev.title = e.title;
          changed = true;
        }
      }
      if (changed) {
        board.manualEdits = [...(board.manualEdits ?? []), { at: b.at, kind: "eq", reason: "同一镜头里重复放了同一条公式，合并成一行", before: JSON.parse(JSON.stringify(b.eqs)) }];
        b.eqs = out;
      }
    }
    if (changed) writeFileSync(file, JSON.stringify(board, null, 2));
  }
  const sents = JSON.parse(readFileSync(`${root}/narration/${s.id}.final.json`, "utf8")).sentences;
  const errs = validateStoryboard(board, sents.map((x) => x.id), Object.fromEntries(sents.map((x) => [x.id, x.text])), { ...ctx, formulas: s.formulas ?? [] });
  // 只有结构类问题算失败；质量类（画面够不够动、演示演没演全、重叠……）列出来但不拦截，它们由 motion / qa 阶段去改善
  const hard = errs.filter((e) => !isSoft(e));
  total += hard.length;
  softTotal += errs.length - hard.length;
  console.log(`${s.id}: ${hard.length} 个问题${errs.length > hard.length ? `（另有 ${errs.length - hard.length} 条质量警告）` : ""}`);
  errs.forEach((e) => console.log((isSoft(e) ? "   ⚠ " : "   - ") + e.slice(0, 200)));
}
console.log(`合计 ${total} 个问题，${softTotal} 条质量警告`);
process.exitCode = total > 0 ? 1 : 0;
