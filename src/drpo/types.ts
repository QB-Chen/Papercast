// make-voice.mjs 生成的时间线结构(单位:帧)
export type TSentence = {
  id: string;
  text: string; // 字幕文字
  audio: string; // public 下的相对路径
  local: number; // 在场景内的起始帧
  start: number; // 全片起始帧
  dur: number; // 语音时长
  onset?: number; // 第一个字开口的帧数（相对本句开头）
  caps?: { at: number; text: string }[]; // 字幕分段：at 为相对本句开头的帧数（由 align-captions 按真实配音时间算出）
};

export type TScene = {
  id: string;
  start: number;
  dur: number;
  sentences: TSentence[];
};

export type Timeline = {
  fps: number;
  totalFrames: number;
  scenes: TScene[];
};
