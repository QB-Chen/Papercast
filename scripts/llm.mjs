// 通过本机 bifrost 调用大语言模型(OpenAI 兼容的 /v1/chat/completions)。
//   import { chat, chatJson } from "./llm.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const BIFROST = process.env.BIFROST_URL ?? "http://localhost:8080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 调用一次模型,返回 { text, usage, seconds }。每次调用的请求与回复都存到 llm-test/log 便于复盘 */
// 本地网关里只允许用 sensenova/ 下的模型，以及 nvidia-nim 的 glm-5.3-flash（用户要求；设环境变量 ALLOW_ANY_MODEL=1 可临时放开）
const ALLOWED_MODEL = /^(sensenova\/|nvidia-nim\/z-ai\/glm-5\.3-flash$)/;
export async function chat(model, messages, { maxTokens = 8000, temperature = 0.7, tag = "call", timeoutMs = 300_000, extra = {} } = {}) {
  if (!ALLOWED_MODEL.test(model) && !process.env.ALLOW_ANY_MODEL) throw new Error(`模型 ${model} 不在允许范围内（只能用 sensenova/* 和 nvidia-nim/z-ai/glm-5.3-flash）`);
  let lastErr;
  let rateRetries = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BIFROST}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, ...extra }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      if (!res.ok || typeof text !== "string") throw new Error(`HTTP ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
      const out = { text, usage: json.usage, seconds: (Date.now() - t0) / 1000 };
      try {
        const dir = join("llm-test", "log");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${Date.now()}-${tag}.json`), JSON.stringify({ model, messages, reply: text, usage: json.usage }, null, 2));
      } catch {}
      return out;
    } catch (e) {
      lastErr = e;
      // 429 限流（每分钟 token 或请求数超额）：等一分钟左右再试，不算普通失败；最多等 6 次
      if (/429|RateLimit|tpm\/rpm/i.test(String(e.message))) {
        const wait = Math.min(75_000, 25_000 + attempt * 10_000);
        console.log(`  [${model}] 被限流，${(wait / 1000).toFixed(0)}s 后重试（第 ${rateRetries + 1}/6 次）`);
        if (++rateRetries > 6) break;
        attempt--; // 限流不占用普通重试次数
        await sleep(wait);
        continue;
      }
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

/**
 * 流式调用：边收边拼，返回和 chat() 一样的 { text, usage, seconds }，另外带 stats（首包时间、最长数据间隔、块数）。
 * 好处：长任务不会因为"一直没有字节返回"被网关或代理当作空闲连接切断。
 * 注意：网关如果有"整个请求不得超过 N 秒"的硬上限，流式一样会被切断，这一点需要实测。
 */
async function chatStreamOnce(model, messages, { maxTokens = 8000, temperature = 0.7, tag = "stream", timeoutMs = 1_800_000, extra = {}, onProgress } = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BIFROST}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: true, stream_options: { include_usage: true }, ...extra }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let reasoning = 0;
  let usage;
  let chunks = 0;
  let firstByte = null;
  let last = Date.now();
  let maxGap = 0;
  let sseError = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const now = Date.now();
    firstByte ??= (now - t0) / 1000;
    maxGap = Math.max(maxGap, now - last);
    last = now;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const ev = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of ev.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (d === "[DONE]") continue;
        let j;
        try {
          j = JSON.parse(d);
        } catch {
          continue;
        }
        if (j.error) sseError = j.error;
        chunks++;
        const delta = j.choices?.[0]?.delta ?? {};
        if (delta.content) text += delta.content;
        if (delta.reasoning) reasoning += delta.reasoning.length;
        if (j.usage) usage = j.usage;
      }
    }
    onProgress?.({ seconds: (now - t0) / 1000, textChars: text.length, reasoningChars: reasoning });
  }
  if (sseError) throw new Error(`流中出现错误：${JSON.stringify(sseError).slice(0, 300)}`);
  const seconds = (Date.now() - t0) / 1000;
  return { text, usage, seconds, stats: { firstByte, maxGapSec: maxGap / 1000, chunks, reasoningChars: reasoning } };
}
/** 带 429 限流退避的流式调用：被 tpm/rpm 限流时等一会儿再试，最多 6 次 */
export async function chatStream(model, messages, opts = {}) {
  let rate = 0;
  for (;;) {
    try {
      return await chatStreamOnce(model, messages, opts);
    } catch (e) {
      if (/429|RateLimit|tpm\/rpm/i.test(String(e.message)) && rate < 6) {
        const wait = 30_000 + rate * 10_000;
        rate++;
        console.log(`  [${model}] 被限流，${(wait / 1000).toFixed(0)}s 后重试（第 ${rate}/6 次）`);
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }
      throw e;
    }
  }
}
/** 从模型回复里取出 JSON(容忍 ```json 围栏和前后废话) */
export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[\[{]/);
  if (start < 0) throw new Error("回复里没有 JSON");
  const open = body[start];
  const close = open === "[" ? "]" : "}";
  const end = body.lastIndexOf(close);
  if (end <= start) throw new Error("JSON 不完整");
  const raw = body.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 模型常把 LaTeX 里的反斜杠写成单个（\\mu），在 JSON 里是非法转义。把不合法的反斜杠补成两个再试一次
    const fixed = raw.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    return JSON.parse(fixed);
  }
}

/**
 * 调用模型并解析 JSON;validate(obj) 返回错误字符串数组,非空则把错误回喂给模型让它修改,最多 maxRounds 轮。
 * 返回 { obj, rounds, errors }。
 */
export async function chatJson(model, messages, validate, { maxRounds = 3, ...opts } = {}) {
  const convo = [...messages];
  let errors = [];
  let best = null; // 问题最少的一版，bestEffort 时在轮数用完后返回它
  for (let round = 1; round <= maxRounds; round++) {
    const useStream = !!opts.stream;
    const call = useStream ? chatStream : chat;
    const { text, seconds, usage, stats } = await call(model, convo, {
      ...opts,
      tag: `${opts.tag ?? "json"}-r${round}`,
      ...(useStream ? { onProgress: (p) => { if (Math.floor(p.seconds / 20) > (chatJson._lastTick ?? -1)) { chatJson._lastTick = Math.floor(p.seconds / 20); console.log(`    … ${p.seconds.toFixed(0)}s 已收到 正文 ${p.textChars} 字，推理 ${p.reasoningChars} 字`); } } } : {}),
    });
    if (stats) console.log(`  流式统计：首包 ${stats.firstByte?.toFixed(1)}s，最长数据间隔 ${stats.maxGapSec.toFixed(1)}s，共 ${stats.chunks} 块，推理 ${stats.reasoningChars} 字`);
    chatJson._lastTick = -1;
    let obj;
    try {
      obj = extractJson(text);
      errors = validate(obj);
    } catch (e) {
      errors = [`你的回复不是合法 JSON:${e.message}`];
    }
    console.log(`  [${model}] 第 ${round} 轮 ${seconds.toFixed(1)}s,tokens=${usage?.total_tokens ?? "?"},问题 ${errors.length} 个`);
    if (!errors.length) return { obj, rounds: round, errors: [] };
    const errScore = opts.errScore ?? ((e) => e.length); // bestEffort 选"最好的一版"的打分，默认按错误条数；调用方可以给硬错误更高的权重
    if (obj && (!best || errScore(errors) < errScore(best.errors))) best = { obj, errors: [...errors], rounds: round };
    convo.push({ role: "assistant", content: text });
    convo.push({
      role: "user",
      content: `上一版有以下问题,请逐条修正后,重新输出完整的 JSON(不要只输出修改的部分,也不要解释):\n- ${errors.slice(0, 25).join("\n- ")}`,
    });
  }
  if (opts.bestEffort && best) return { obj: best.obj, rounds: maxRounds, errors: best.errors, partial: true };
  return { obj: null, rounds: maxRounds, errors };
}
