// 配音脚本共用的函数:MiMo TTS 合成、WAV 时长解析、XingChen ASR 回听、相似度打分
import { readFileSync } from "node:fs";

export const BIFROST = process.env.BIFROST_URL ?? "http://localhost:8080";
export const ASR_MODEL = process.env.ASR_MODEL ?? "siliconflow/XingChenAGI/XingChenASR-V3.2";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** MiMo-V2.5-TTS 走 /v1/chat/completions:目标文本放 assistant,风格指令放 user */
export async function synth(narr, text) {
  const body = {
    model: narr.model,
    messages: [
      { role: "user", content: narr.style },
      { role: "assistant", content: text },
    ],
    audio: { format: "wav", voice: narr.voice },
  };
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${BIFROST}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      const json = await res.json();
      const b64 = json?.choices?.[0]?.message?.audio?.data;
      if (!res.ok || !b64) throw new Error(`HTTP ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      return Buffer.from(b64, "base64");
    } catch (e) {
      lastErr = e;
      await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

/** 解析 WAV 头拿时长,兼容 data 块大小为 0 或 0xFFFFFFFF 的流式输出 */
export function wavSeconds(buf) {
  let pos = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bits = 16;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(pos + 10);
      sampleRate = buf.readUInt32LE(pos + 12);
      bits = buf.readUInt16LE(pos + 22);
    } else if (id === "data") {
      const bytes = size === 0 || size === 0xffffffff || pos + 8 + size > buf.length ? buf.length - (pos + 8) : size;
      return bytes / (sampleRate * channels * (bits / 8));
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error("WAV 里没找到 data 块");
}

/** 把一段 WAV 送去 XingChen ASR,返回转写文字 */
export async function asrBuffer(buf) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const form = new FormData();
      form.append("model", ASR_MODEL);
      form.append("file", new Blob([buf], { type: "audio/wav" }), "a.wav");
      const res = await fetch(`${BIFROST}/v1/audio/transcriptions`, { method: "POST", body: form, signal: AbortSignal.timeout(90_000) });
      const j = await res.json();
      if (typeof j.text === "string") return j.text;
      throw new Error(JSON.stringify(j).slice(0, 150));
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1200 * attempt);
    }
  }
}

export const asrFile = (path) => asrBuffer(readFileSync(path));

// 只保留汉字、字母、数字;统一小写。把常见的阿拉伯数字读法也折成汉字,减少 ASR 数字写法带来的误差
const DIGITS = "零一二三四五六七八九";
export function norm(s) {
  const t = s
    .toLowerCase()
    .replace(/(\d+(?:\.\d+)?)%/g, (_, n) => `百分之${n}`)
    .replace(/\d/g, (d) => DIGITS[+d]);
  return (t.match(/[\u4e00-\u9fa5a-z]/g) ?? []).join("");
}

/** 最长公共子序列占比,容忍少量插入或替换 */
export function lcsRatio(a, b) {
  if (!a.length || !b.length) return 0;
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length] / Math.max(a.length, b.length);
}

const EN_NUMWORDS = new Set("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion percent point and".split(" "));
export function normEn(s) {
  return s
    .toLowerCase()
    .replace(/%/g, " percent ")
    .split(/[^a-z0-9']+/)
    .filter((w) => w && !/^\d/.test(w) && !EN_NUMWORDS.has(w))
    .map((w) => w.replace(/'/g, ""))
    .join("");
}
export const score = (want, heard, lang = "zh") => (lang === "en" ? +lcsRatio(normEn(want), normEn(heard)).toFixed(2) : +lcsRatio(norm(want), norm(heard)).toFixed(2));

// 全大写缩写按字母逐个读(PPO → P P O,FP8 → F P 八),避免 TTS 把它当单词乱读。
// 想用别的读法,在旁白稿里给该句写 speak 字段覆盖。
export function speakify(text, lang = "zh") {
  return text.replace(/\b([A-Z]{2,})(\d*)\b/g, (_, letters, digits) => {
    const spelled = letters.split("").join(" ");
    const num = digits ? (lang === "en" ? ` ${digits}` : ` ${[...digits].map((d) => DIGITS[+d]).join("")}`) : "";
    return `${spelled}${num}`;
  });
}
