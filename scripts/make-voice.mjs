// 逐句合成配音并生成时间线。
//   node scripts/make-voice.mjs [narration/drpo.json] [--redo id1,id2] [--tries 3]
// 1. 每句调用 bifrost 上的 MiMo-V2.5-TTS;
// 2. 合成后立刻用 XingChen ASR 回听打分,低于阈值就重试,最多 --tries 次,留下得分最高的一版;
// 3. 音频存到 public/audio/<名>/<句id>.wav,文本、音色、风格没变就复用;--redo 可强制重做指定句;
// 4. 按真实音频时长生成 src/<名>/timeline.json,画面、字幕全部跟着它走。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { asrBuffer, score, speakify, synth, wavSeconds } from "./lib.mjs";
import { packOf } from "./lang-pack.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const project = flag("--project"); // 新流水线：--project <arXiv 编号>，旁白和时间线都放在 projects/<id>/ 下
const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--"))) ?? (project ? `projects/${project}/narration.json` : "narration/drpo.json");
const redo = new Set((flag("--redo") ?? "").split(",").filter(Boolean));
const MAX_TRIES = +(flag("--tries") ?? 3);
const GOOD_ENOUGH = 0.93; // 回听得分达到这个值就不再重试

const name = project ? "audio" : basename(file, ".json");
const audioRel = project ? `projects/${project}/audio` : `audio/${name}`; // 写进时间线的相对路径(相对 public/)
const narr = JSON.parse(readFileSync(file, "utf8"));
const LANG = narr.lang ?? process.env.VIDEO_LANG ?? "zh"; // 英文版：回听打分、缩写读法、语速提示都按英文

const FPS = 30;
const SENTENCE_GAP = 0.26; // 句间停顿(秒),语速加快后相应收紧
const SCENE_PAD_START = 0.5; // 场景开头留白
const SCENE_PAD_END = 0.9; // 场景结尾留白

const audioDir = project ? join("public", "projects", project, "audio") : join("public", "audio", name);
mkdirSync(audioDir, { recursive: true });
mkdirSync(project ? join("projects", project) : join("src", name), { recursive: true });

const sentences = narr.scenes.flatMap((sc) => sc.sentences.map((s) => ({ ...s, scene: sc.id })));
// 实际送去朗读的文本:优先用 speak,否则把全大写缩写拆成字母
const spoken = (s) => s.speak ?? speakify(s.text, LANG);
// 按句调整语速：pace.json 由 plan-pace.mjs 生成（slow 难点放慢、light 过渡略快、其余 normal）
const paceFile = project ? join("projects", project, "narration", "pace.json") : null;
const PACE = paceFile && existsSync(paceFile) ? JSON.parse(readFileSync(paceFile, "utf8")) : {};
const PACE_STYLE = packOf(LANG).paceStyle;
const styleOf = (s) => narr.style + (PACE_STYLE[PACE[s.id]] ?? "");
// 每句配音后期再做的变速（保持音高）。slow 的主要放慢来自风格指令，这里不再加速，反而略放慢；light 比正常略快
const tempoOf = (s) => (PACE[s.id] === "slow" ? SLOW_TEMPO : PACE[s.id] === "light" ? TEMPO * 1.05 : TEMPO);
// 句间停顿：难点句前后多留一点，给高亮切换和观众消化留时间
const gapBetween = (a, b) => SENTENCE_GAP + (PACE[b?.id] === "slow" ? 0.2 : 0) + (PACE[a?.id] === "slow" ? 0.1 : 0);
const fingerprint = (s) =>
  createHash("sha1")
    .update(JSON.stringify([narr.model, narr.voice, styleOf(s), spoken(s)]))
    .digest("hex")
    .slice(0, 12);

const durations = {};
const queue = [];
for (const s of sentences) {
  const wav = join(audioDir, `${s.id}.wav`);
  const meta = join(audioDir, `${s.id}.json`);
  const fp = fingerprint(s);
  const cached = existsSync(wav) && existsSync(meta) && JSON.parse(readFileSync(meta, "utf8")).fp === fp && !redo.has(s.id);
  if (cached) durations[s.id] = JSON.parse(readFileSync(meta, "utf8")).seconds;
  else queue.push({ s, wav, meta, fp });
}
const todo = queue.length;
let done = 0;
console.log(`共 ${sentences.length} 句,需要合成 ${todo} 句(每句最多 ${MAX_TRIES} 次,回听达 ${GOOD_ENOUGH} 即停)`);

const WORKERS = 3;
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    while (queue.length) {
      const job = queue.shift();
      const want = spoken(job.s);
      let best = null;
      for (let t = 1; t <= MAX_TRIES; t++) {
        const buf = await synth({ ...narr, style: styleOf(job.s) }, want);
        let sc = -1;
        try {
          sc = score(want, await asrBuffer(buf), LANG);
        } catch {
          sc = -1; // ASR 暂时不可用就当没打分,保留这一版
        }
        if (!best || sc > best.sc) best = { buf, sc };
        if (sc >= GOOD_ENOUGH || sc < 0) break;
      }
      const seconds = wavSeconds(best.buf);
      writeFileSync(job.wav, best.buf);
      writeFileSync(job.meta, JSON.stringify({ fp: job.fp, seconds, score: best.sc }));
      durations[job.s.id] = seconds;
      done++;
      console.log(`[${done}/${todo}] ${job.s.id} ${seconds.toFixed(2)}s 回听=${best.sc}  ${job.s.text}`);
    }
  }),
);

// 变速:对每句做保持音高的 atempo 处理,不重新请求 TTS。tempo=1 表示不处理
const TEMPO = +(flag("--tempo") ?? narr.tempo ?? 1);
const SLOW_TEMPO = +(flag("--slow-tempo") ?? 0.95);
if (!(TEMPO >= 0.5 && TEMPO <= 2)) throw new Error(`tempo 必须在 0.5~2 之间,当前 ${TEMPO}`);
const fastDir = join(audioDir, "fast");
const finalSeconds = {};
const audioPath = {};
// 句中停顿压缩:MiMo 在逗号和词间常停 0.35~0.8 秒，听起来像念到一半停住。
// silenceremove 会保留 stop_duration + stop_silence 长度的静音，这里合计约 0.2 秒。用 --no-pause-trim 可关闭。
const TRIM = !args.includes("--no-pause-trim");
const trimFilter = "silenceremove=stop_periods=-1:stop_duration=0.12:stop_threshold=-35dB:stop_silence=0.08";
if (TEMPO === 1 && !TRIM) {
  for (const s of sentences) {
    finalSeconds[s.id] = durations[s.id];
    audioPath[s.id] = `${audioRel}/${s.id}.wav`;
  }
} else {
  mkdirSync(fastDir, { recursive: true });
  for (const s of sentences) {
    const out = join(fastDir, `${s.id}.wav`);
    execFileSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-i", join(audioDir, `${s.id}.wav`), "-filter:a", [TRIM ? trimFilter : null, tempoOf(s) !== 1 ? `atempo=${tempoOf(s).toFixed(3)}` : null].filter(Boolean).join(","), "-c:a", "pcm_s16le", out],
      { stdio: "inherit" },
    );
    finalSeconds[s.id] = wavSeconds(readFileSync(out));
    audioPath[s.id] = `${audioRel}/fast/${s.id}.wav`;
  }
  console.log(`已处理 ${sentences.length} 句(基础 tempo=${TEMPO}，难点句 ${SLOW_TEMPO}，句中停顿压缩=${TRIM}) → ${fastDir}`);
}

// 生成时间线
let cursor = 0;
const scenes = narr.scenes.map((sc) => {
  const start = cursor;
  let local = Math.round(SCENE_PAD_START * FPS);
  let lastGap = 0;
  const out = sc.sentences.map((s, k) => {
    const dur = Math.ceil(finalSeconds[s.id] * FPS);
    const item = { id: s.id, text: s.text, audio: audioPath[s.id], local, start: start + local, dur };
    if (PACE[s.id]) item.pace = PACE[s.id];
    lastGap = Math.round(gapBetween(s, sc.sentences[k + 1]) * FPS);
    local += dur + lastGap;
    return item;
  });
  const dur = local - lastGap + Math.round(SCENE_PAD_END * FPS);
  cursor += dur;
  return { id: sc.id, start, dur, sentences: out };
});

const tlFile = project ? join("projects", project, "timeline.json") : join("src", name, "timeline.json");
writeFileSync(tlFile, JSON.stringify({ fps: FPS, totalFrames: cursor, lang: LANG, scenes }, null, 2));
const talk = Object.values(finalSeconds).reduce((a, b) => a + b, 0);
console.log(`\n时间线已写入 ${tlFile}`);
console.log(`总时长 ${(cursor / FPS).toFixed(1)}s(${cursor} 帧),其中纯语音 ${talk.toFixed(1)}s`);
