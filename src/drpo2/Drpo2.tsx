import { makeStoryVideo } from "../story/StoryVideo";
import type { Storyboard } from "../story/types";
import type { Timeline } from "../drpo/types";
import timelineJson from "./timeline.json";
import hook from "../../storyboards/gen/hook.json";
import why from "../../storyboards/gen/why.json";
import ratio from "../../storyboards/gen/ratio.json";
import dppo from "../../storyboards/gen/dppo.json";
import drpo from "../../storyboards/gen/drpo.json";
import spo from "../../storyboards/gen/spo.json";
import derive from "../../storyboards/gen/derive.json";
import exp from "../../storyboards/gen/exp.json";
import abl from "../../storyboards/gen/abl.json";
import out from "../../storyboards/gen/out.json";

// 全片：旁白由 deepseek-flash 起草、glm-5.2 审查、agent 对照论文复核；分镜由 kimi-k3 / sensenova-6.8-flash 设计。
export const drpo2Timeline = timelineJson as Timeline;

const as = (x: unknown) => x as unknown as Storyboard;
export const BOARDS: Record<string, Storyboard> = {
  hook: as(hook),
  why: as(why),
  ratio: as(ratio),
  dppo: as(dppo),
  drpo: as(drpo),
  spo: as(spo),
  derive: as(derive),
  exp: as(exp),
  abl: as(abl),
  out: as(out),
};

export const Drpo2 = makeStoryVideo(drpo2Timeline, BOARDS);
