// 字幕对齐：用 whisper 的逐字时间戳，算出每一段字幕在配音里真正开始说的时间。
//   node scripts/align-captions.mjs --project <arXiv 编号> [--model groq/whisper-large-v3] [--redo]
// 为什么要做：一句旁白很长，字幕要拆成几段，原先按字数比例分配时间，但配音在逗号处停顿、各字读速不同，
//   实测换段点和真实停顿相差中位 0.14 秒、最大 1 秒以上，肉眼能看出"字幕比声音快/慢半拍"。
// 做法：
//   1. 对每句最终配音（已经过停顿压缩和变速）取 whisper 逐字时间戳（结果缓存在 audio/fast/<id>.words.json）；
//   2. 把识别出的字和字幕原文逐字做最长公共子序列对齐，没对上的字在前后对上的字之间线性插值；
//   3. 每段字幕在它第一个字开口之前一点点切换；
//   4. 结果写进 timeline.json 每句的 caps: [{ at(帧，相对本句开头), text }]，字幕组件优先使用 caps。
// 对不齐的句子（对上的字不到 60%）不写 caps，字幕仍按字数比例。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { BIFROST, norm } from "./lib.mjs";
import { splitCaptionLang } from "../src/story/i18n.ts"; // 和渲染器共用同一套字幕切分（中文按字符、英文按词）

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const project = flag("--project");
if (!project) throw new Error("用法：node scripts/align-captions.mjs --project <arXiv 编号>");
const MODEL = flag("--model") ?? "groq/whisper-large-v3";
const REDO = args.includes("--redo");
const tlFile = `projects/${project}/timeline.json`;
const tl = JSON.parse(readFileSync(tlFile, "utf8"));
const FPS = tl.fps;
const LANG = tl.lang ?? process.env.VIDEO_LANG ?? "zh"; // 英文版：whisper 按英文识别、字幕按词切分
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 和 StoryVideo.tsx 里的 splitCaption 保持一致 */
export const splitCaption = (text, max = 30) => {
  const parts = text.match(/[^，。？！；：、]+[，。？！；：、]?/g) ?? [text];
  const out = [];
  let cur = "";
  for (const p of parts) {
    if (!cur || [...cur + p].length <= max) cur += p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out.flatMap((seg) => {
    const chars = [...seg];
    if (chars.length <= max + 6) return [seg];
    const n = Math.ceil(chars.length / max);
    const size = Math.ceil(chars.length / n);
    return Array.from({ length: n }, (_, i) => chars.slice(i * size, (i + 1) * size).join(""));
  });
};

async function whisperWords(file) {
  const buf = readFileSync(file);
  const sha = createHash("sha1").update(buf).update(MODEL).digest("hex").slice(0, 12);
  const cache = file.replace(/\.wav$/, ".words.json");
  if (!REDO && existsSync(cache)) {
    const c = JSON.parse(readFileSync(cache, "utf8"));
    if (c.sha === sha) return c.words;
  }
  let last;
  for (let a = 1; a <= 4; a++) {
    try {
      const form = new FormData();
      form.append("file", new Blob([buf], { type: "audio/wav" }), "a.wav");
      form.append("model", MODEL);
      form.append("response_format", "verbose_json");
      form.append("language", LANG);
      form.append("timestamp_granularities[]", "word");
      const res = await fetch(`${BIFROST}/v1/audio/transcriptions`, { method: "POST", body: form, signal: AbortSignal.timeout(90_000) });
      const j = await res.json();
      if (!Array.isArray(j.words)) throw new Error(JSON.stringify(j).slice(0, 160));
      const words = j.words.map((w) => ({ word: w.word, start: +w.start, end: +w.end }));
      writeFileSync(cache, JSON.stringify({ sha, text: j.text, words }));
      return words;
    } catch (e) {
      last = e;
      await sleep(1500 * a);
    }
  }
  throw last;
}

/** 字幕原文里的"可对齐字"（汉字、字母），带原文下标 */
function textChars(text) {
  const out = [];
  [...text].forEach((ch, idx) => {
    for (const c of norm(ch)) out.push({ c, idx });
  });
  return out;
}
/** whisper 的字 → 逐字（一个 token 含多字时平分时间） */
function wordChars(words) {
  const out = [];
  for (const w of words) {
    const cs = [...norm(w.word)];
    cs.forEach((c, k) => {
      const d = (w.end - w.start) / cs.length;
      out.push({ c, start: w.start + d * k, end: w.start + d * (k + 1) });
    });
  }
  return out;
}

/** 最长公共子序列对齐，返回 text 每个字对应的 whisper 字下标（没对上为 -1） */
function lcsAlign(A, B) {
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) dp[i][j] = A[i - 1].c === B[j - 1].c ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const map = new Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (A[i - 1].c === B[j - 1].c) {
      map[i - 1] = j - 1;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return map;
}

const jobs = [];
for (const sc of tl.scenes) for (const s of sc.sentences) jobs.push(s);
let ok = 0, weak = 0, single = 0;
const shifts = [];
let idx = 0;
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (idx < jobs.length) {
      const s = jobs[idx++];
      const segs = splitCaptionLang(s.text, LANG);
      delete s.caps;
      delete s.onset;
      let words;
      try {
        words = await whisperWords(`public/${s.audio}`);
      } catch (e) {
        console.log(`  ${s.id} 取时间戳失败：${String(e.message).slice(0, 100)}`);
        weak++;
        continue;
      }
      // 第一个字真正开口的时刻（配音文件开头有约 0.16 秒静音），字幕淡入跟着它，而不是跟着句子起点。
      // 不能用 whisper 的第一个字时间：它总把第一个字标成 0 秒，不反映开头的静音；这里用 ffmpeg 静音检测直接量
      {
        const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", `public/${s.audio}`, "-af", "silencedetect=n=-35dB:d=0.02", "-t", "1.5", "-f", "null", "-"], { encoding: "utf8" });
        const log = r.stderr ?? "";
        const m = log.match(/silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/);
        s.onset = m && Math.abs(+m[1]) < 0.05 ? Math.round(+m[2] * FPS) : 0;
      }
      if (segs.length < 2) {
        single++;
        continue;
      }
      const A = textChars(s.text);
      const B = wordChars(words);
      const map = lcsAlign(A, B);
      const matched = map.filter((x) => x >= 0).length;
      if (matched / A.length < 0.6) {
        console.log(`  ${s.id} 对上的字只有 ${matched}/${A.length}，保持按字数分配`);
        weak++;
        continue;
      }
      // 每个字的开口时间 / 收声时间：没对上的在前后对上的字之间插值
      const st = new Array(A.length).fill(null);
      const en = new Array(A.length).fill(null);
      map.forEach((j, i) => {
        if (j >= 0) {
          st[i] = B[j].start;
          en[i] = B[j].end;
        }
      });
      const fill = (arr, defFirst, defLast) => {
        let prev = -1;
        for (let i = 0; i <= A.length; i++) {
          if (i < A.length && arr[i] === null) continue;
          const a = prev < 0 ? defFirst : arr[prev];
          const b = i >= A.length ? defLast : arr[i];
          for (let k = prev + 1; k < i; k++) arr[k] = a + ((b - a) * (k - prev)) / (i - prev);
          prev = i;
        }
      };
      const total = s.dur / FPS;
      fill(st, 0, total);
      fill(en, 0, total);
      // 每段字幕在整句原文里的起止下标（按字符，顺序查找，容忍连续标点被切分函数丢掉）
      const chars = [...s.text];
      let off = 0;
      const ranges = segs.map((seg) => {
        const sc = [...seg];
        let at = off;
        while (at < chars.length && chars[at] !== sc[0]) at++;
        if (at >= chars.length) at = off;
        off = at + sc.length;
        return [at, off];
      });
      const caps = [{ at: 0, text: segs[0] }];
      for (let k = 1; k < segs.length; k++) {
        const fi = A.findIndex((a) => a.idx >= ranges[k][0]);
        const li = fi - 1;
        if (fi < 0 || li < 0) continue;
        const startNext = st[fi];
        const endPrev = en[li];
        const gap = Math.max(0, startNext - endPrev);
        // 在下一段开口前一点点切换：有停顿就切在停顿里，没有停顿就提前 0.06 秒
        const t = gap > 0.04 ? startNext - Math.min(0.12, gap / 2) : startNext - 0.06;
        // 和原先按字数比例的换段点比较，统计偏移
        const old = (ranges[k][0] / Math.max(1, chars.length)) * total;
        shifts.push(Math.abs(t - old));
        caps.push({ at: Math.max(caps[caps.length - 1].at + 3, Math.round(t * FPS)), text: segs[k] });
      }
      // 保证每段文字都在（把原文按 caps 里记下的段落重排，防止漏字）
      if (caps.length === segs.length) {
        s.caps = caps;
        ok++;
      } else weak++;
    }
  }),
);
writeFileSync(tlFile, JSON.stringify(tl, null, 2));
shifts.sort((a, b) => a - b);
const q = (p) => (shifts.length ? shifts[Math.min(shifts.length - 1, Math.floor(shifts.length * p))].toFixed(2) : "-");
console.log(`字幕对齐完成：${ok} 句已按真实时间分段，${single} 句只有一段，${weak} 句保持按字数分配 → ${tlFile}`);
console.log(`和原先按字数比例的换段点相比，偏移：中位 ${q(0.5)}s，p80 ${q(0.8)}s，p95 ${q(0.95)}s，最大 ${q(1)}s`);
