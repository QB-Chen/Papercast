// 动画评审（OpenMotion 的"看实际输出、按时间点记录问题"）：
// 把浏览器量到的实际画面（哪些元素在什么时间出现、在哪、多大、什么表情/姿势）翻译成按时间的文字，
// 连同导演的动作脚本和旁白一起交给评审模型（和生成不同家族），逐条判断：导演要的每个动作，画面上真的演出来了吗？
//   import { judgeMotion } from "./motion-judge.mjs"
import { chatJson } from "./llm.mjs";

/** 把检查报告翻译成时间线文字：每 0.5 秒一行，只写和上一行相比有变化的元素 */
export function timelineText(report, W = 1600, H = 520) {
  const names = report.names;
  const out = [];
  let prev = new Map();
  const where = (e) => {
    const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2;
    const h = cx < W / 3 ? "左" : cx > (2 * W) / 3 ? "右" : "中", v = cy < H / 3 ? "上" : cy > (2 * H) / 3 ? "下" : "中";
    return `${h}${v}`;
  };
  for (const smp of report.samples) {
    if (Math.abs(smp.t * 2 - Math.round(smp.t * 2)) > 1e-6) continue; // 每 0.5 秒
    const cur = new Map();
    const lines = [];
    for (const e of smp.els) {
      const vis = e.o > 0.25 && e.x1 > e.x0;
      const key = vis ? `${where(e)}|${Math.round((e.x1 - e.x0) / 20)}|${Math.round(e.o * 4)}` : "off";
      cur.set(e.i, key);
      const was = prev.get(e.i) ?? "off";
      if (key === was) continue;
      if (!vis) lines.push(`${names[e.i]} 消失`);
      else if (was === "off") lines.push(`${names[e.i]} 出现在${where(e)}（${e.x1 - e.x0}px）`);
      else lines.push(`${names[e.i]} 移到${where(e)}`);
    }
    prev = cur;
    if (lines.length) out.push(`${smp.t.toFixed(1)}s：${lines.join("；")}`);
  }
  return out.join("\n");
}

const SYSTEM = `你是严格的动效评审。你看不到画面，但会拿到：旁白原文、导演写的动作脚本、以及浏览器实际测出的画面时间线（每个元素在什么时间出现、移到哪里、消失）。
请逐条判断导演脚本里的每个动作：每个动作有一个【关键变化】，**只看这个关键变化有没有在对应时刻发生**；"细节参考"是导演的补充，缺了细节不算问题，除非关键变化因此没有发生。再看时间对不对，并给出整体评价。
verdict：
- "ok"：这个动作在对应时刻有清楚的可见事件（出现、移动、替换姿势、表情），顺序和因果对得上旁白。
- "weak"：有事件但太弱（只是冒出来，没有"做"这个动作），或时间明显偏离旁白。
- "missing"：画面时间线里找不到对应的事件。
另外 overall.problems 列出最影响观感的 1~3 个问题（具体到时间点和元素，例如"5.0s 盘子飞到客人面前后没有举叉/吃的动作"），overall.score 是 0~100 的整体分（动作完整、因果清楚、时间对得上才给高分）。
只输出 JSON：{"beats":[{"n":1,"verdict":"ok|weak|missing","note":"…"}],"overall":{"score":80,"problems":["…"]}}，beats 个数和导演脚本里的一致。`;

export async function judgeMotion({ model = "sensenova/glm-5.3", plan, report, sentences, W, H }) {
  const user = `旁白：\n${sentences.map((s) => `${s.id} | ${s.text}`).join("\n")}\n\n导演的动作脚本：\n意图：${plan.intent}\n${plan.beats.map((b, i) => `${i + 1}. ${b.at}：【关键变化】${b.key ?? b.change}（细节参考：${b.change}）`).join("\n")}\n\n实际画面时间线（浏览器测量）：\n${timelineText(report, W, H)}\n\n画面上出现过的文字：${report.texts.join(" / ") || "（无）"}`;
  const { obj, errors } = await chatJson(model, [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    (o) => (!Array.isArray(o?.beats) || o.beats.length !== plan.beats.length ? [`beats 个数必须是 ${plan.beats.length}`] : !o.overall ? ["缺 overall"] : []),
    { maxRounds: 3, temperature: 0.2, maxTokens: 40000, tag: "mjudge", timeoutMs: 400_000 });
  if (errors?.length) return null;
  return obj;
}
