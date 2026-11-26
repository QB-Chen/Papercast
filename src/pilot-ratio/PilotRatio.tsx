import { makeStoryVideo } from "../story/StoryVideo";
import type { Storyboard } from "../story/types";
import type { Timeline } from "../drpo/types";
import timelineJson from "./timeline.json";
import boardJson from "../../storyboards/ratio.pilot.json";

export const pilotTimeline = timelineJson as Timeline;
export const PilotRatio = makeStoryVideo(pilotTimeline, { ratio: boardJson as unknown as Storyboard });
