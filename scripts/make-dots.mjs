// 贴图包里没有"彩色圆点"，按各包的风格自己画。
//   node scripts/make-dots.mjs <目录> <风格：sticker | glossy | clay>
//   sticker：白色描边 + 深色细边 + 高光 + 小星星；glossy：软 3D 光泽球；clay：哑光黏土球
import { writeFileSync, mkdirSync } from "node:fs";
const dir = process.argv[2] ?? "public/stickers-withicons-sticker";
const style = process.argv[3] ?? "sticker";
mkdirSync(dir, { recursive: true });
const COLORS = {
  blue: ["#7DBBFF", "#2F73D9", "#1B4A9E"],
  green: ["#6BE3A8", "#22B070", "#127A4C"],
  orange: ["#FFC27A", "#F28A1E", "#B85F08"],
  purple: ["#C4B0FF", "#8460E8", "#5A3BB5"],
  red: ["#FF9AA8", "#E8445E", "#A6203A"],
  yellow: ["#FFE680", "#F5BC0F", "#B88A00"],
};
for (const [name, [light, mid, dark]] of Object.entries(COLORS)) {
  let svg;
  if (style === "sticker") {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em"><circle cx="12" cy="12" r="10.6" fill="#fff"/><circle cx="12" cy="12" r="9" fill="${mid}" stroke="${dark}" stroke-width="1.3"/><ellipse cx="8.8" cy="8.4" rx="2.6" ry="1.6" transform="rotate(-35 8.8 8.4)" fill="#fff" opacity=".55"/><path d="M20.4 3.2l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" fill="${mid}"/></svg>`;
  } else if (style === "glossy") {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em"><defs><radialGradient id="g" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${light}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></radialGradient></defs><ellipse cx="12" cy="21.6" rx="6.5" ry="1.4" fill="#000" opacity=".16"/><circle cx="12" cy="11.5" r="9.6" fill="url(#g)"/><ellipse cx="8.6" cy="7.4" rx="3.2" ry="1.9" transform="rotate(-35 8.6 7.4)" fill="#fff" opacity=".6"/></svg>`;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em"><defs><radialGradient id="g" cx="40%" cy="32%" r="80%"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${mid}"/></radialGradient></defs><ellipse cx="12" cy="21.6" rx="6.8" ry="1.3" fill="#000" opacity=".12"/><circle cx="12" cy="11.5" r="9.6" fill="url(#g)"/><ellipse cx="8.8" cy="7.6" rx="2.6" ry="1.5" transform="rotate(-35 8.8 7.6)" fill="#fff" opacity=".35"/></svg>`;
  }
  writeFileSync(`${dir}/${name}-circle.svg`, svg);
}
console.log(`已画 6 个彩色圆点（${style}）→ ${dir}`);
