// 渲染后画面质检：把真实渲染出来的静帧（带当前旁白字幕）交给能看图的本地网关模型，找"观众一眼看得出来的毛病"。
//   import { qaFrames } from "./frame-qa.mjs"
// 只报"看得见的、通用的毛病"，不评价创意。类型固定，方便统计和自动修：
//   text_flipped  文字倒置/镜像/歪得读不了      leftover  和当前这句旁白无关、前面留下来的贴图/图标
//   overlap       元素互相盖住看不清            too_small 关键元素小到看不清
//   clutter       同一画面东西太多太乱          empty     大片空白而旁白在讲具体东西
//   off_topic     画面内容和字幕在讲的不符       other     其他明显毛病
import { readFileSync } from "node:fs";
import { chat } from "./llm.mjs";

export const DEFECT_TYPES = ["text_flipped", "leftover", "overlap", "too_small", "clutter", "empty", "off_topic", "other"];

const SYSTEM = `你是视频质检员。给你若干张视频截图（每张带有当时的字幕，字幕是旁白正在讲的话）。请只找"观众一眼就能看出来的、通用的毛病"，不要评价创意和风格，没有毛病就不要硬找。
毛病类型（type 只能取这些值）：
- text_flipped：画面上的文字上下颠倒、左右镜像、或者歪得读不出来（注意：公式、小字号的说明可能本来就小，不算）
- leftover：画面里有和**当前字幕**无关的贴图/图标（比如前面讲别的东西时用的笔、对勾、叉、文件，现在还留着，让人搞不清它们是干什么的）
- overlap：两个元素互相盖住，其中一个被挡住大半，或文字被图形盖住
- too_small：字幕正在讲的关键东西小得看不清
- clutter：画面里东西太多、太乱，观众不知道该看哪里
- empty：画面大片空白，但旁白正在讲具体的东西
- off_topic：画面上的东西和字幕在讲的内容明显不符
- other：其他一眼可见的毛病
输出 JSON：{"defects":[{"frame":第几张(从1数),"type":"类型","what":"具体指出是哪个元素、哪里不对（例如：橙色标签'最小化'是倒着的）","severity":"high|low"}],"ok":true或false}。high = 观众会看错或看不懂；low = 不好看但不影响理解。没有毛病就输出 {"defects":[],"ok":true}。`;

/** images: [{path, caption}]，caption 是该帧的字幕。返回 { defects, ok, error? } */
export async function qaFrames({ model = "sensenova/kimi-k3", images, hint = "" }) {
  const content = [{ type: "text", text: `共 ${images.length} 张截图，按顺序编号 1..${images.length}。${hint}\n${images.map((im, i) => `第 ${i + 1} 张的字幕：${im.caption ?? "（无）"}`).join("\n")}` }];
  for (const im of images) content.push({ type: "image_url", image_url: { url: `data:image/${im.path.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(im.path).toString("base64")}` } });
  let text;
  try {
    const r = await chat(model, [{ role: "system", content: SYSTEM }, { role: "user", content }], { maxTokens: 30000, temperature: 0.1, tag: "frameqa", timeoutMs: 300_000 });
    text = r.text;
  } catch (e) { return { defects: [], ok: null, error: String(e).slice(0, 160) }; }
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return { defects: [], ok: null, error: "模型没有返回 JSON" };
  try {
    const o = JSON.parse(m[0]);
    const defects = (o.defects ?? []).filter((d) => DEFECT_TYPES.includes(d.type) && d.frame >= 1 && d.frame <= images.length);
    return { defects, ok: defects.length === 0 };
  } catch { return { defects: [], ok: null, error: "JSON 解析失败" }; }
}
