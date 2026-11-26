// 对 LLM 生成的分镜做人工纠错(agent 对照论文和旁白逐镜头核对后发现的事实性或语义错误)。
//   node scripts/patch-storyboards.mjs
// 每条补丁：{ scene, at, kind, set:{…} | insert:{…}, reason }。
//   set    把字段覆盖到匹配的镜头上
//   insert 如果该场景里还没有 at/slot/kind 相同的镜头，就插入这个镜头
// 并在分镜的 manualEdits 数组里记录改了什么、为什么，保证"哪些画面不是模型设计的"可追溯。可重复运行。
import { readFileSync, writeFileSync } from "node:fs";

const PATCHES = [
  {
    scene: "exp", at: "e1", kind: "rows", slot: "C",
    insert: {
      at: "e1", slot: "C", kind: "rows",
      list: [
        { at: "e1", label: "Qwen3-4B-Base", sub: "稠密模型 · 40 亿参数", sticker: "robot" },
        { at: "e1", label: "Qwen3-30B-A3B-Base", sub: "混合专家 · 300 亿参数", sticker: "robot" },
        { at: "e1", label: "Qwen3.5-35B-A3B-Base", sub: "混合专家 · 350 亿参数", sticker: "robot" },
        { at: "e1", label: "R1-Distill-Qwen-1.5B", sub: "DeepSeek 蒸馏 · 15 亿参数", sticker: "robot" },
      ],
    },
    reason: "模型在 e1 那句（「一共测了四个模型，参数从十五亿到三百五十亿」）没有安排任何画面；补上论文里的四个模型",
  },
  {
    scene: "exp", at: "e11", kind: "bars", slot: "C",
    set: {
      items: [
        { label: "掉之前", value: 0.25, display: "0.25", tone: "teal" },
        { label: "掉之后", value: 0.17, display: "0.17", tone: "pink" },
      ],
    },
    reason: "原标签「原来准确率 / 去掉信任区域」会让人以为 0.25 是有信任区域的结果；论文是不加信任区域时准确率从 0.25 掉到 0.17",
  },
  {
    scene: "abl", at: "a3", kind: "eq", slot: "C",
    set: { eqs: [{ at: "a3", ref: "drpo_loss", note: "惩罚项乘了优势绝对值" }] },
    reason: "原备注「高亮：乘优势绝对值」，但公式库里高亮的是 μ，不是 |Â|，备注会把观众带偏",
  },
  {
    scene: "abl", at: "a4", kind: "leash", slot: "C",
    set: {
      moves: [
        { at: "a4", dog: "edge", line: "taut", label: "边界稳定，不随优势变" },
        { at: "a5", dog: "far", line: "taut", label: "拆掉它：下降又不稳" },
        { at: "a7", dog: "inside", line: "slack", label: "变体：圈内照旧" },
        { at: "a8", dog: "outside", line: "spring", label: "越界才纠正：差不多" },
      ],
    },
    reason: "原来「拆掉优势绝对值」用的是 cut（剪刀），但 cut 只表示 PPO/DPPO 的硬剪切，和拆零件无关",
  },
  {
    scene: "out", at: "o6", kind: "leash", slot: "C",
    set: {
      moves: [
        { at: "o6", dog: "far", line: "cut", label: "DPPO：撒手不管" },
        { at: "o7", dog: "outside", line: "spring", label: "DRPO：弹簧拽回" },
        { at: "o9", dog: "inside", line: "slack", label: "越界还能拉回来" },
      ],
    },
    reason: "原来 DRPO（o7）用 taut 绷直；弹簧才是 DRPO 的象征，绷直表示被拉住",
  },
];

const touched = new Set();
for (const p of PATCHES) {
  const file = `storyboards/gen/${p.scene}.json`;
  const board = JSON.parse(readFileSync(file, "utf8"));
  const i = board.beats.findIndex((b) => b.at === p.at && b.kind === p.kind && (!p.slot || b.slot === p.slot));
  const note = (before) => {
    board.manualEdits = (board.manualEdits ?? []).filter((e) => !(e.at === p.at && e.kind === p.kind));
    board.manualEdits.push({ at: p.at, kind: p.kind, reason: p.reason, before });
  };
  if (p.insert) {
    if (i < 0) {
      board.beats.push({ ...p.insert });
      note(null);
    }
  } else {
    if (i < 0) throw new Error(`补丁找不到镜头：${p.scene}/${p.at}/${p.kind}`);
    const prev = (board.manualEdits ?? []).find((e) => e.at === p.at && e.kind === p.kind);
    const before = prev ? prev.before : JSON.parse(JSON.stringify(board.beats[i]));
    board.beats[i] = { ...board.beats[i], ...p.set };
    note(before);
  }
  writeFileSync(file, JSON.stringify(board, null, 2));
  touched.add(p.scene);
  console.log(`✓ ${p.scene}/${p.at}  ${p.reason}`);
}
console.log(`\n共 ${PATCHES.length} 处，涉及场景：${[...touched].join(", ")}`);
