// 把分镜里对论文素材的引用（公式 id、图 id、表 id）展开成渲染器能直接用的数据，写成 Remotion 的 props 文件。
//   node scripts/build-props.mjs <arXiv 编号>
// 读：projects/<id>/timeline.json、projects/<id>/storyboards/*.json、projects/<id>/paper/*.json
// 写：projects/<id>/props.json = { timeline, boards }
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";

const id = process.argv[2];
if (!id) throw new Error("用法：node scripts/build-props.mjs <arXiv 编号>");
const root = `projects/${id}`;
const timeline = JSON.parse(readFileSync(`${root}/timeline.json`, "utf8"));
const pj = (n) => JSON.parse(readFileSync(`${root}/paper/${n}.json`, "utf8"));
const equations = pj("equations");
const figures = pj("figures");
const tables = pj("tables");

const boards = {};
const problems = [];
for (const sc of timeline.scenes) {
  const file = `${root}/storyboards/${sc.id}.json`;
  if (!existsSync(file)) {
    problems.push(`缺少场景 ${sc.id} 的分镜`);
    continue;
  }
  const board = JSON.parse(readFileSync(file, "utf8"));
  for (const b of board.beats) {
    if (b.kind === "eq") {
      for (const e of b.eqs ?? []) {
        if (!e.eq) continue;
        const q = equations.find((x) => x.id === e.eq);
        if (q) e.tex = q.tex;
        else problems.push(`${sc.id}：找不到公式 ${e.eq}`);
      }
    }
    if (b.kind === "paperbar") {
      // 论文条的数据不让模型写（拼错人名风险）：读项目里人工核对过的 paper/paperbar.json
      const pf = `${root}/paper/paperbar.json`;
      if (existsSync(pf)) {
        const { title, authors, venue, shot } = JSON.parse(readFileSync(pf, "utf8"));
        b.paperInfo = { title, authors, venue, shot };
      } else problems.push(`${sc.id}：论文条需要 ${pf}（作者名要对照论文首页人工核对）`);
    }
    if (b.kind === "eqx") {
      const q = equations.find((x) => x.id === b.eq);
      if (q) b.tex = q.tex;
      else problems.push(`${sc.id}：找不到公式 ${b.eq}`);
    }
    if (b.kind === "fig") {
      const f = figures.find((x) => x.id === b.ref);
      if (f?.file) b.figInfo = { file: f.file, w: f.w, h: f.h, caption: f.caption, parts: f.parts };
      else problems.push(`${sc.id}：图 ${b.ref} 不可用`);
    }
    if (b.kind === "table") {
      const t = tables.find((x) => x.id === b.ref);
      if (t) b.tableInfo = { rows: t.rows, caption: t.caption };
      else problems.push(`${sc.id}：找不到表 ${b.ref}`);
    }
  }
  // 项目级动画风格开关：projects/<id>/motion-style.txt 写 classic 就用原来的统一淡入叠化（对比或回退用），不写就用默认的新风格
  if (existsSync(`${root}/motion-style.txt`) && readFileSync(`${root}/motion-style.txt`, "utf8").trim() === "classic") board.motionStyle = "classic";
  boards[sc.id] = board;
}
// 贴图包：项目 state/配置里指定（projects/<id>/sticker-pack.txt，一行包名）；没有就用默认贴图
const packFile = `${root}/sticker-pack.txt`;
const stickerPack = existsSync(packFile) ? readFileSync(packFile, "utf8").trim() : "";
const stickerNames = stickerPack && existsSync(`public/stickers-${stickerPack}`) ? readdirSync(`public/stickers-${stickerPack}`).filter((f) => f.endsWith(".svg")).map((f) => f.replace(/\.svg$/, "")) : undefined;
// 视频语言（plan.json 的 lang，没有就是中文）：渲染器据此切换字幕切分、"示意图"之类的固定文字
const lang = existsSync(`${root}/plan.json`) ? (JSON.parse(readFileSync(`${root}/plan.json`, "utf8").replace(/^\uFEFF/, "")).lang ?? "zh") : "zh";
writeFileSync(`${root}/props.json`, JSON.stringify({ timeline, boards, lang, ...(stickerNames ? { stickerPack, stickerNames } : {}) }));
if (stickerNames) console.log(`贴图包 ${stickerPack}：${stickerNames.length} 个，其余用默认贴图`);
console.log(`props 已生成：${timeline.scenes.length} 个场景，${timeline.totalFrames} 帧（${(timeline.totalFrames / timeline.fps / 60).toFixed(1)} 分钟）→ ${root}/props.json`);
if (problems.length) {
  console.log("问题：\n- " + problems.join("\n- "));
  process.exitCode = 1;
}
