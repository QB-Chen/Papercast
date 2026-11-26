// 视频语言：zh（默认）或 en。
// 优先级：环境变量 VIDEO_LANG（paper2video 的 --lang 会设置）→ projects/<id>/plan.json 的 lang → zh。
// 项目目录名：中文版就是 arXiv 编号，英文版是 <编号>-en（两个版本互不干扰，论文素材各抓一份）。
import { readFileSync, existsSync } from "node:fs";

export const SUPPORTED = ["zh", "en"];

export function arxivIdOf(project) {
  return String(project).replace(/-(zh|en)$/, "");
}

export function langOf(project) {
  const env = process.env.VIDEO_LANG;
  if (env && SUPPORTED.includes(env)) return env;
  if (project) {
    const f = `projects/${project}/plan.json`;
    if (existsSync(f)) {
      try {
        const l = JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, "")).lang;
        if (SUPPORTED.includes(l)) return l;
      } catch {}
    }
    if (/-en$/.test(project)) return "en";
  }
  return "zh";
}
