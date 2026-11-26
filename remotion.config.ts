import { Config } from "@remotion/cli/config";

// 本机 Remotion 自带的 chrome-headless-shell 在此环境下连接超时(25s),改用系统 Edge 渲染。
// 如果在别的机器上用自带浏览器正常,删掉这一行即可。
Config.setBrowserExecutable("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
