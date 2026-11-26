// 看画面的评审：把动画在每个导演动作发生的时刻截成静帧，拼成一张图，交给能看图的本地网关模型。
// 对应 OpenMotion 审片规则：必须看实际画面；结论只用 成立/需修改/未验证 加证据，不给综合分数。
//   import { visionReview } from "./motion-vision.mjs"
// 注意：静帧只能证明"这一刻画面上有什么"，证明不了动作是否顺滑、声音是否同步；这两项永远标"未验证"。
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { shotMotion } from "./motion-check.mjs";
import { chat } from "./llm.mjs";

const FFMPEG = existsSync("E:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe") ? "E:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe" : "ffmpeg";

const SYSTEM = `你是视频审片员。你看到的是一张由多帧截图拼成的图（从左到右、从上到下按时间顺序），每帧是一段"讲解动画"在某个时刻的画面（舞台里放着小人、道具、表情、少量中文字）。
导演给了每个动作应该呈现什么，每个动作有一个【关键变化】：**只看这个关键变化有没有出现在对应的帧里**；"细节参考"缺了不算问题，除非关键变化因此没有出现。请只根据图里你真正看得到的内容判断，看不清就说看不清，不要猜。
对每个动作给出 verdict：
- "成立"：这一拍对应的两帧里，能看到导演要的主体和变化（谁在哪、拿着什么、表情/道具是什么）。
- "需修改"：看得到问题，必须写出具体问题（例如"客人头顶没有表情""盘子小到看不清""厨师被书挡住""两个人重叠"）。
- "未验证"：静帧里无法判断（比如要判断动作是否顺滑、先后次序），写明为什么。
另外检查整体：人物是否太小、舞台上半部是否空着、有没有东西叠在一起看不清、有没有乱码或怪字、是不是像"同一个人变成了另一个人"。
只输出 JSON：{"beats":[{"n":1,"verdict":"成立|需修改|未验证","evidence":"图里看到的具体内容"}],"overall":{"problems":["具体问题（指明第几帧、什么元素）"]}}，beats 个数和导演动作一致。`;

/** 给每个动作选两个时刻：动作刚发生后 0.3s 和 1.2s；再加最后一帧。返回按时间排序的 [{t, beat}] */
export function pickTimes(beatSecs, dur, maxFrames = 12) {
  const out = [];
  beatSecs.forEach((b, i) => {
    const t0 = Math.max(0, Math.min(dur - 0.2, b.sec + 0.3));
    const t1 = Math.max(t0 + 0.2, Math.min(dur - 0.1, b.sec + 1.2));
    out.push({ t: +t0.toFixed(2), beat: i + 1 }, { t: +t1.toFixed(2), beat: i + 1 });
  });
  out.push({ t: +(dur - 0.05).toFixed(2), beat: 0 });
  out.sort((a, b) => a.t - b.t);
  const uniq = out.filter((x, i) => i === 0 || x.t - out[i - 1].t >= 0.15);
  return uniq.slice(0, maxFrames);
}

export async function visionReview({ model = "sensenova/kimi-k3", motion, cues, plan, beatSecs, dur, W = 1600, H = 520, tag = "v" }) {
  const dir = `llm-test/mc/vision-${tag}`;
  mkdirSync(dir, { recursive: true });
  const picks = pickTimes(beatSecs, dur);
  const files = [];
  for (let i = 0; i < picks.length; i++) {
    const out = `${dir}/f${String(i).padStart(2, "0")}.png`;
    const ok = shotMotion({ html: motion.html, css: motion.css ?? "", script: motion.script, W, H, dur, cues, t: picks[i].t, out });
    if (ok) files.push({ file: out, ...picks[i] });
  }
  if (files.length < 3) return { error: "截图失败（少于 3 帧）", files: [] };
  // 拼图：3 列，每帧缩到宽 640
  const cols = 3;
  const sheet = `${dir}/sheet.jpg`;
  const args = ["-y", "-loglevel", "error"];
  files.forEach((f) => args.push("-i", f.file));
  const rows = Math.ceil(files.length / cols);
  const fh = Math.round((H * 640) / W);
  const layout = files.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * fh}`).join("|");
  const scaled = files.map((_, i) => `[${i}]scale=640:${fh}[s${i}]`).join(";");
  args.push("-filter_complex", `${scaled};${files.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=white`, "-q:v", "3", sheet);
  const r = spawnSync(FFMPEG, args, { encoding: "utf8" });
  if (r.status !== 0 || !existsSync(sheet)) return { error: "拼图失败：" + (r.stderr ?? "").slice(-200), files };
  const b64 = readFileSync(sheet).toString("base64");
  const frameDesc = files.map((f, i) => `第 ${i + 1} 帧（${f.t}s）${f.beat ? `：动作 ${f.beat} 之后` : "：最后一帧"}`).join("；");
  const user = [
    { type: "text", text: `拼图共 ${files.length} 帧，${cols} 列 ${rows} 行：${frameDesc}。\n\n导演的动作脚本：\n意图：${plan.intent}\n${plan.beats.map((b, i) => `${i + 1}. ${b.at}：【关键变化】${b.key ?? b.change}（细节参考：${b.change}）`).join("\n")}\n\n请逐个动作判断。` },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
  ];
  let text;
  try {
    text = await chat(model, [{ role: "system", content: SYSTEM }, { role: "user", content: user }], { maxTokens: 40000, temperature: 0.2, tag: "mvision", timeoutMs: 300_000 });
  } catch (e) { return { error: "模型调用失败：" + String(e).slice(0, 160), files, sheet }; }
  const raw = typeof text === "string" ? text : text?.text ?? text?.content ?? "";
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { error: "模型没有返回 JSON", files, sheet, raw: raw.slice(0, 200) };
  let obj;
  try { obj = JSON.parse(m[0]); } catch { return { error: "JSON 解析失败", files, sheet, raw: raw.slice(0, 200) }; }
  if (!Array.isArray(obj.beats) || obj.beats.length !== plan.beats.length) return { error: `beats 个数应为 ${plan.beats.length}`, files, sheet };
  return { ...obj, files, sheet, model };
}
