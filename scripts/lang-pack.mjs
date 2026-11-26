// 各语言要用到的"不随论文变"的设定：配音音色与风格、语速提示、ASR 语言码、文字长度换算。
// 旁白怎么写、怎么审，在各自脚本里按 lang 分支（gen-narration / review-style / revise-narration）。
import { langOf } from "./lang.mjs";

export const PACK = {
  zh: {
    name: "中文",
    voice: "冰糖",
    ttsStyle: "中文科技知识区UP主，年轻女声，音调中等偏亮，语速自然，语气轻松幽默，像和朋友聊天，吐字清晰，句与句之间自然停顿。",
    tempo: 1.1,
    paceStyle: {
      slow: " 这一句是难点：明显放慢语速，一字一顿，吐字清楚，关键词稍微加重，像在耐心带着听众一步一步想。",
      light: " 这一句语气轻快，语速稍快，像随口带过。",
    },
    asrLang: "zh",
    capMax: 30, // 一行字幕最多多少字符
    textScale: 1, // 画面文字上限的换算系数（中文一个字很宽，英文窄，英文放宽）
  },
  en: {
    name: "English",
    voice: "Mia",
    ttsStyle: "A friendly English-speaking science explainer for a YouTube channel, young female voice, medium-bright pitch, natural pace, relaxed and a little humorous, like chatting with a friend, very clear pronunciation, natural pauses between sentences.",
    tempo: 1.08,
    paceStyle: {
      slow: " This sentence is a hard point: slow down clearly, enunciate every word, lightly stress the key terms, like patiently walking the listener through it step by step.",
      light: " This sentence is light and breezy, slightly faster, like a casual aside.",
    },
    asrLang: "en",
    capMax: 52,
    textScale: 2,
  },
};

export const packOf = (lang) => PACK[lang] ?? PACK.zh;
export const packFor = (project) => packOf(langOf(project));
