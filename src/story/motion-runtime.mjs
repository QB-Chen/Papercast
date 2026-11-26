// 动画代码运行时（OpenMotion 的做法：HTML 结构 + 一条暂停的 GSAP 时间线，由渲染器逐帧 seek）。
// Remotion 组件（motion.tsx）和浏览器校验器（scripts/motion-check.mjs）共用这一份，保证"校验时看到的就是渲染时的"。
//
// 模型写三样东西：
//   html   —— 舞台里的 HTML 片段（可含内联 SVG）。舞台是 position:relative 的 W×H 像素盒子（全幅 1600×520，插入演示 1600×300）。
//   css    —— 样式。只作用于这个舞台内部。
//   script —— GSAP 时间线脚本。可用：tl（时间线包装，tl.to / from / fromTo / set，目标可以直接写选择器字符串）、
//             cue("句子id@短语") 取旁白里这个动作开口的秒数（相对本镜头起点）、$ / $$ 选元素、W / H 舞台尺寸、DUR 镜头时长（秒）、
//             gsap（只能用其中的 utils、parseEase 之类，不能用 gsap.to 自己开动画）。
//   插件：MotionPathPlugin、DrawSVGPlugin、MorphSVGPlugin 已注册（沿路径运动、描边画出、形状变形）。

/** 禁止出现的写法：联网、动态执行、定时器、自己开播放、死循环、访问全局 */
export const FORBIDDEN = [
  [/\bfetch\s*\(/, "不能联网（fetch）"],
  [/XMLHttpRequest|WebSocket|EventSource|sendBeacon/, "不能联网"],
  [/\bimport\s*[(\s{*]/, "不能 import"],
  [/\brequire\s*\(/, "不能 require"],
  [/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/, "不能动态执行代码"],
  [/\bdocument\b/, "不能访问 document，选元素用 $(\"选择器\") 或直接在 tl 里写选择器字符串"],
  [/\bwindow\b|\bglobalThis\b|\bself\b|\btop\b\s*\./, "不能访问全局对象"],
  [/localStorage|sessionStorage|indexedDB|cookie/, "不能用本地存储"],
  [/setTimeout|setInterval|requestAnimationFrame|queueMicrotask/, "不能用定时器（动画由时间线逐帧 seek，不是实时跑的）"],
  [/\.play\s*\(|\.resume\s*\(|\.restart\s*\(|gsap\.ticker/, "不能自己 play（时间线是暂停的，由渲染器逐帧定位）"],
  [/\brepeat\s*:\s*-1/, "不能无限重复（repeat:-1）；要循环请用有限次数，如 repeat: 8"],
  [/\bwhile\s*\(|for\s*\(\s*;\s*;|do\s*\{/, "不能写 while / 死循环；需要重复请用 for (let i = 0; i < 次数; i++)，次数写死且不超过 60"],
  [/__proto__|\bconstructor\b|\bprototype\b/, "不能碰原型"],
  [/\bprocess\b|\bBuffer\b/, "不能访问 process"],
  [/gsap\.(to|from|fromTo|set|timeline|delayedCall)\s*\(/, "不能直接用 gsap.to / gsap.timeline 开动画，所有动画都写在 tl 上（tl.to / tl.from / tl.fromTo / tl.set）"],
];

/** 静态检查脚本，返回问题列表（中文，原样反馈给模型） */
export function checkScript(script) {
  const errs = [];
  if (typeof script !== "string" || script.trim().length < 20) return ["script 太短或不是字符串"];
  if (script.length > 12000) errs.push(`script 太长（${script.length} 字符，上限 12000），请精简`);
  for (const [re, msg] of FORBIDDEN) if (re.test(script)) errs.push(msg);
  for (const m of script.matchAll(/for\s*\([^;]*;[^;]*?<=?\s*(\d+)\s*;/g)) if (Number(m[1]) > 60) errs.push(`for 循环次数 ${m[1]} 太大（上限 60）`);
  if (/for\s*\(/.test(script) && !/for\s*\([^;]*;[^;]*?<=?\s*\d+\s*;/.test(script)) errs.push("for 循环的上限必须是写死的数字（如 i < 12）");
  if (!/tl\.(to|from|fromTo|set)\s*\(/.test(script)) errs.push("script 里没有任何 tl.to / tl.from / tl.fromTo 动画");
  return errs;
}

/** 清洗 HTML：去掉脚本、事件属性、外链、危险标签；资源路径只允许 props、chars、stickers 开头的目录下的 svg。返回 {html, errs} */
export function sanitizeHtml(html, assetUrl = (p) => p) {
  const errs = [];
  let h = String(html ?? "");
  if (h.length > 120000) errs.push(`html 太长（${h.length} 字符，上限 120000）`);
  if (/<\s*(script|iframe|object|embed|link|meta|base|form|foreignObject)\b/i.test(h)) errs.push("html 里不能有 script / iframe / object / embed / link / meta / form / foreignObject 标签");
  if (/\son[a-z]+\s*=/i.test(h)) errs.push("html 里不能有 onclick 之类的事件属性");
  if (/javascript\s*:/i.test(h)) errs.push("html 里不能有 javascript: 链接");
  if (/(src|href|xlink:href)\s*=\s*["']?\s*(https?:|\/\/|data:)/i.test(h)) errs.push("html 里不能引用外部链接或 data: 图片，图片只能用 props/xxx.svg、chars/xxx.svg 这样的本地素材");
  if (/url\(\s*["']?\s*(https?:|\/\/)/i.test(h)) errs.push("样式里不能引用外部 url");
  h = h.replace(/<\s*(script|iframe|object|embed|link|meta|base|form|foreignObject)\b[\s\S]*?(<\/\s*\1\s*>|\/>|>)/gi, "");
  h = h.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // 本地素材路径改写成可访问的地址（并检查路径合法）
  h = h.replace(/\b(src|href|xlink:href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, attr, q, a, b) => {
    const v = a ?? b ?? "";
    if (v.startsWith("#")) return m; // 内联 SVG 里的 #id 引用
    if (!/^(props|chars|stickers[\w-]*)\/[\w-]+\.svg$/.test(v)) { errs.push(`素材路径「${v}」不合法：只能是 props/名字.svg 或 chars/名字.svg（名字见素材清单）`); return `${attr}=""`; }
    return `${attr}="${assetUrl(v)}"`;
  });
  return { html: h, errs };
}

/** 样式限定在舞台内部：用 CSS 嵌套把全部规则包进 #舞台id { … }（Chrome 120+）。禁止 @import、外部 url、position:fixed 之类逃出舞台的写法 */
export function scopeCss(css, rootId) {
  const errs = [];
  let c = String(css ?? "");
  if (c.length > 20000) errs.push(`css 太长（${c.length} 字符，上限 20000）`);
  if (/@import|@font-face|expression\s*\(|behavior\s*:/i.test(c)) errs.push("css 里不能有 @import / @font-face");
  if (/url\(\s*["']?\s*(https?:|\/\/|data:)/i.test(c)) errs.push("css 里不能引用外部或 data: url");
  if (/position\s*:\s*fixed/i.test(c)) errs.push("css 里不能用 position:fixed（用 absolute，相对舞台定位）");
  c = c.replace(/@import[^;]*;/gi, "").replace(/@font-face\s*\{[^}]*\}/gi, "");
  return { css: `#${rootId}{${c}}`, errs };
}

/**
 * 搭起舞台并建好时间线。root 是已经在文档里的舞台根元素（宽 W 高 H）。
 * 返回 { tl, seek(sec), dispose() }。出错抛异常（校验器和渲染器都会捕获）。
 */
export function buildMotion({ root, html, css, script, gsap, cue, assetUrl, W = 1600, H = 520, dur = 10 }) {
  const rootId = root.id || (root.id = `mo-${Math.random().toString(36).slice(2, 8)}`);
  const s = sanitizeHtml(expandKit(html), assetUrl);
  const c = scopeCss(css, rootId);
  const errs = [...s.errs, ...c.errs, ...checkScript(script)];
  if (errs.length) throw new Error(errs.join("；"));
  const base = `img{aspect-ratio:1/1;height:auto;display:block;max-width:none} svg{overflow:visible}`;
  root.innerHTML = `<style>#${rootId}{${base}}${c.css}</style>${s.html}`;
  // 角色部件的转轴：手臂/腿在肩/髋，头在脖子，身体在脚
  const origin = (sel, o) => { const els = Array.from(root.querySelectorAll(sel)); if (els.length) gsap.set(els, { transformOrigin: o }); };
  origin(".person .arm-l, .person .arm-r", "50% 8%"); origin(".person .leg-l, .person .leg-r", "50% 4%"); origin(".person .head", "50% 92%"); origin(".person .body", "50% 100%");

  const tl = gsap.timeline({ paused: true });
  const find = (t) => {
    if (typeof t !== "string") return t;
    const els = Array.from(root.querySelectorAll(t));
    if (!els.length) throw new Error(`选择器「${t}」在舞台里找不到任何元素（html 里没有这个 id 或 class？）`);
    return els;
  };
  const T = {
    to: (t, v, p) => (tl.to(find(t), v, p), T),
    from: (t, v, p) => (tl.from(find(t), v, p), T),
    fromTo: (t, a, b, p) => (tl.fromTo(find(t), a, b, p), T),
    set: (t, v, p) => (tl.set(find(t), v, p), T),
    addLabel: (l, p) => (tl.addLabel(l, p), T),
    duration: () => tl.duration(),
  };
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));
  const safeGsap = { utils: gsap.utils, parseEase: gsap.parseEase, registerEase: undefined };
  // face("#chef", "sad", 时间)：切换 <x-person> 的表情（neutral/happy/sad/surprised/worry/smirk）
  const face = (sel, name, t) => {
    if (!["neutral", "happy", "sad", "surprised", "worry", "smirk"].includes(name)) throw new Error(`face 的表情「${name}」不存在，可选：neutral、happy、sad、surprised、worry、smirk`);
    for (const p of find(sel)) { const all = Array.from(p.querySelectorAll('[class^="f-"]')); if (!all.length) throw new Error(`face("${sel}") 选中的不是 <x-person> 人物`); tl.set(all, { opacity: 0 }, t); tl.set(p.querySelectorAll(".f-" + name), { opacity: 1 }, t); }
  };
  const { lib, run: runLib } = makeLib({ root, gsap, tl, find, W, H });
  const LIBNAMES = Object.keys(lib).join(",");
  const fn = new Function("tl", "cue", "$", "$$", "W", "H", "DUR", "gsap", "face", "__lib", `"use strict";\nconst {${LIBNAMES}} = __lib;\n${script}`);
  fn(T, (ref) => { const v = cue(ref); if (!Number.isFinite(v)) throw new Error(`cue("${ref}") 解析不了：句子 id 不对，或短语不在这句原文里`); return Math.max(0, v); }, $, $$, W, H, dur, safeGsap, face, lib);
  if (tl.duration() <= 0.2) throw new Error("时间线几乎是空的（总时长不到 0.2 秒）");
  // 先跑到末尾再回到开头：让 .to() 记录起始值，之后任意顺序 seek 都稳定
  tl.time(tl.duration(), true);
  runLib();
  tl.time(0, true);
  runLib();
  return {
    tl,
    seek: (sec) => { tl.time(Math.min(Math.max(0, sec), tl.duration()), true); runLib(); },
    dispose: () => { tl.kill(); root.innerHTML = ""; },
  };
}


// ---------- 动作积木（脚本里直接调用；不含任何文字，文字由调用方传入，所以中英文通用） ----------
// 位置都是舞台坐标（左上角 0,0）。连接线、气泡、徽章每次定位之后会重新读元素的真实位置，所以会跟着移动的元素走。
export function makeLib({ root, gsap, tl, find, W, H }) {
  const NS = "http://www.w3.org/2000/svg";
  const updaters = [];
  const layer = document.createElement("div");
  layer.className = "mo-gen";
  layer.setAttribute("data-hold", "");
  layer.style.cssText = "position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;pointer-events:none;overflow:visible";
  root.appendChild(layer);
  // 连线放在用户元素的下面一层（不盖住人物和道具），徽章和气泡放在上面一层
  const underLayer = document.createElement("div");
  underLayer.className = "mo-gen";
  underLayer.setAttribute("data-hold", "");
  underLayer.style.cssText = layer.style.cssText + ";z-index:0";
  const firstEl = Array.from(root.children).find((c) => c.tagName !== "STYLE" && c !== layer);
  root.insertBefore(underLayer, firstEl || layer);
  const rootRect = () => root.getBoundingClientRect();
  const kk = () => (rootRect().width || W) / W || 1;
  const one = (t) => { const e = typeof t === "string" ? find(t)[0] : Array.isArray(t) ? t[0] : t; if (!e) throw new Error("积木：找不到元素 " + t); return e; };
  const box = (el) => { const r = el.getBoundingClientRect(), s0 = rootRect(), k = kk(); return { l: (r.left - s0.left) / k, t: (r.top - s0.top) / k, w: r.width / k, h: r.height / k, cx: (r.left - s0.left + r.width / 2) / k, cy: (r.top - s0.top + r.height / 2) / k }; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const gp = (el, p) => +gsap.getProperty(el, p) || 0;

  // 把一个元素移到目标元素（或 {x,y} 点）的位置，走弧线。dx、dy 是目标中心的偏移。
  // 起点终点在补间开始那一刻按真实位置计算（按时间顺序，所以接在别的移动后面也对），用的是真正的补间，不会和脚本里其它 tl.to 打架
  function moveTo(target, to, t, o = {}) {
    const el = one(target), dur = num(o.dur, 0.9), arc = num(o.arc, 70), ox = num(o.dx, 0), oy = num(o.dy, 0);
    const dest = () => (to && typeof to === "object" && !(to instanceof Element) && !Array.isArray(to) && "x" in to ? { cx: to.x, cy: to.y } : box(one(to)));
    const st = { init: false, sx: 0, sy: 0, ex: 0, ey: 0 };
    const prep = () => { if (!st.init) { const b0 = box(el), d = dest(); st.sx = gp(el, "x"); st.sy = gp(el, "y"); st.ex = st.sx + (d.cx + ox - b0.cx); st.ey = st.sy + (d.cy + oy - b0.cy); st.init = true; } return st; };
    tl.to(el, { x: () => prep().ex, duration: dur, ease: o.ease || "power2.inOut", immediateRender: false }, t);
    tl.to(el, { y: () => (prep().sy + prep().ey) / 2 - arc, duration: dur / 2, ease: "power2.out", immediateRender: false }, t);
    tl.to(el, { y: () => prep().ey, duration: dur / 2, ease: "power2.in", immediateRender: false }, t + dur / 2);
    return el;
  }

  // 两个元素之间连一根线（line 直线 / chain 链条点线 / dashed 虚线 / spring 弹簧 / 带 arrow 箭头），线会跟着两端的元素走
  function link(a, b, t, o = {}) {
    const style = o.style || "line", color = o.color || "#3E9C8C", width = num(o.width, 8), dur = num(o.dur, 0.6);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible;pointer-events:none";
    const path = document.createElementNS(NS, "path");
    path.setAttribute("fill", "none"); path.setAttribute("stroke", color); path.setAttribute("stroke-width", width); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
    if (style === "chain") path.setAttribute("stroke-dasharray", "1 " + (width * 1.7));
    if (style === "dashed") path.setAttribute("stroke-dasharray", width * 2 + " " + width * 1.6);
    const head = document.createElementNS(NS, "path");
    head.setAttribute("fill", color); head.setAttribute("stroke", "none");
    svg.appendChild(path); svg.appendChild(head); underLayer.appendChild(svg);
    const st = { p: 0, o: 1, tight: 1 }; // o 的初始值必须是 1：fromTo 只补间"结束值里出现的属性"，而且 immediateRender:false 时 from 值不会写入，之前 o 一直是 0 导致连接线从不显示
    tl.fromTo(st, { p: 0 }, { p: 1, duration: dur, ease: "power2.out", immediateRender: false }, t);
    updaters.push(() => {
      if (st.p <= 0.001 || st.o <= 0) { svg.style.display = "none"; return; }
      svg.style.display = "";
      const A = box(one(a)), B = box(one(b));
      const dx = B.cx - A.cx, dy = B.cy - A.cy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const ra = Math.min(A.w, A.h) * 0.42, rb = Math.min(B.w, B.h) * 0.42;
      const x1 = A.cx + ux * ra, y1 = A.cy + uy * ra, x2full = B.cx - ux * rb, y2full = B.cy - uy * rb;
      const x2 = x1 + (x2full - x1) * st.p, y2 = y1 + (y2full - y1) * st.p;
      let d;
      if (style === "spring") {
        const n = 12, L = Math.hypot(x2 - x1, y2 - y1), amp = clamp(40 - L / 14, 6, 26) * st.tight, nx = -uy, ny = ux; d = "M" + x1 + " " + y1;
        for (let i = 1; i < n; i++) { const q = i / n, sgn = i % 2 ? 1 : -1; d += " L" + (x1 + (x2 - x1) * q + nx * amp * sgn) + " " + (y1 + (y2 - y1) * q + ny * amp * sgn); }
        d += " L" + x2 + " " + y2;
      } else d = "M" + x1 + " " + y1 + " L" + x2 + " " + y2;
      path.setAttribute("d", d);
      svg.style.opacity = st.o;
      if (o.arrow && st.p > 0.9) { const s1 = width * 2.4; head.setAttribute("d", "M" + x2 + " " + y2 + " L" + (x2 - ux * s1 + -uy * s1 * 0.6) + " " + (y2 - uy * s1 + ux * s1 * 0.6) + " L" + (x2 - ux * s1 + uy * s1 * 0.6) + " " + (y2 - uy * s1 - ux * s1 * 0.6) + " Z"); head.style.display = ""; } else head.style.display = "none";
    });
    return { release: (t2, d2 = 0.3) => tl.to(st, { o: 0, duration: d2 }, t2), st };
  }

  // 给元素贴一个徽章：check 对勾 / cross 叉 / star 星 / question 问号 / exclaim 感叹号 / plus / minus / heart。徽章会跟着元素走
  function stamp(target, kind, t, o = {}) {
    const size = num(o.size, 64), where = o.where || "tr";
    const defs = {
      check: ["#12B76A", '<path d="M18 33 L28 43 L46 22" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>'],
      cross: ["#E5384C", '<path d="M20 20 L44 44 M44 20 L20 44" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>'],
      star: ["#F5B301", '<path d="M32 12 L38 26 L53 27 L41 37 L45 52 L32 44 L19 52 L23 37 L11 27 L26 26 Z" fill="#fff"/>'],
      question: ["#E8832B", '<path d="M23 24 Q23 14 32 14 Q42 14 42 23 Q42 30 32 34 L32 40" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="50" r="4.5" fill="#fff"/>'],
      exclaim: ["#E5384C", '<path d="M32 12 L32 38" stroke="#fff" stroke-width="8" stroke-linecap="round"/><circle cx="32" cy="50" r="4.5" fill="#fff"/>'],
      plus: ["#3E9C8C", '<path d="M32 16 L32 48 M16 32 L48 32" stroke="#fff" stroke-width="8" stroke-linecap="round"/>'],
      minus: ["#7A5AF8", '<path d="M16 32 L48 32" stroke="#fff" stroke-width="9" stroke-linecap="round"/>'],
      heart: ["#E5384C", '<path d="M32 50 C10 34 14 16 26 17 C30 17 32 20 32 22 C32 20 34 17 38 17 C50 16 54 34 32 50 Z" fill="#fff"/>'],
    };
    const dd = defs[kind];
    if (!dd) throw new Error("stamp 的类型「" + kind + "」不存在，可选：" + Object.keys(defs).join("、"));
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 64 64"); svg.setAttribute("width", size); svg.setAttribute("height", size);
    svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible;pointer-events:none;opacity:0";
    svg.innerHTML = '<circle cx="32" cy="32" r="30" fill="' + dd[0] + '" stroke="#fff" stroke-width="3"/>' + dd[1];
    layer.appendChild(svg);
    const st = { o: 0, s: 0.3 };
    tl.fromTo(st, { o: 0, s: 0.3 }, { o: 1, s: 1, duration: 0.35, ease: "back.out(2)", immediateRender: false }, t);
    if (o.until !== undefined) tl.to(st, { o: 0, duration: 0.25 }, o.until);
    updaters.push(() => {
      if (st.o <= 0) { svg.style.opacity = 0; return; }
      const B = box(one(target));
      const x = where === "center" ? B.cx - size / 2 : where === "tl" ? B.l - size * 0.3 : B.l + B.w - size * 0.7;
      const y = where === "center" ? B.cy - size / 2 : B.t - size * 0.3;
      svg.style.left = clamp(x, 0, W - size) + "px"; svg.style.top = clamp(y, 0, H - size) + "px";
      svg.style.opacity = st.o; svg.style.transform = "scale(" + st.s + ")";
    });
  }

  // 元素旁边冒一个说话气泡。文字由调用方按视频语言传入。气泡不会超出舞台。
  function say(target, text, t, o = {}) {
    const hold = num(o.hold, 2.6), size = num(o.size, 30), tone = o.tone || "#1F3A5F", side = o.side || "top";
    const div = document.createElement("div");
    div.textContent = String(text);
    div.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;font-size:" + size + "px;font-weight:800;line-height:1.25;color:" + tone + ";background:#fff;border:4px solid " + tone + ";border-radius:26px;padding:8px 22px;opacity:0;transform-origin:50% 100%;pointer-events:none";
    layer.appendChild(div);
    const st = { o: 0, s: 0.6 };
    tl.fromTo(st, { o: 0, s: 0.6 }, { o: 1, s: 1, duration: 0.3, ease: "back.out(1.7)", immediateRender: false }, t);
    tl.to(st, { o: 0, duration: 0.25 }, t + hold);
    updaters.push(() => {
      if (st.o <= 0) { div.style.opacity = 0; return; }
      const B = box(one(target)), w = div.offsetWidth, h = div.offsetHeight;
      const x = clamp(B.cx - w / 2, 8, W - w - 8);
      const y = side === "bottom" ? clamp(B.t + B.h + 10, 4, H - h - 4) : clamp(B.t - h - 14, 4, H - h - 4);
      div.style.left = x + "px"; div.style.top = y + "px"; div.style.opacity = st.o; div.style.transform = "scale(" + st.s + ")";
    });
  }

  // 把一个标签/元素的文字换成另一段文字（旧的缩小淡出，新的在原位弹出）：比如"加减"变成"乘除"、"最大化"变成"最小化"
  function setText(target, text, t, o = {}) {
    const el = one(target);
    const nu = el.cloneNode(true);
    nu.removeAttribute("id"); nu.setAttribute("data-hold", "");
    const leaf = (function walk(n) { for (const c of n.childNodes) if (c.nodeType === 3 && c.textContent.trim()) return c; for (const c of n.children) { const r = walk(c); if (r) return r; } return null; })(nu);
    if (leaf) leaf.textContent = String(text); else nu.textContent = String(text);
    nu.style.opacity = 0;
    el.parentNode.insertBefore(nu, el.nextSibling);
    const dur = num(o.dur, 0.35);
    tl.to(el, { opacity: 0, scale: gp(el, "scale") * 0.7 || 0.7, duration: dur * 0.6, ease: "power2.in", immediateRender: false }, t);
    tl.fromTo(nu, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: dur, ease: "back.out(1.8)", immediateRender: false }, t + dur * 0.5);
    return nu;
  }

  // 把一个东西切成 n 份并分开（用同一个元素的 n 个裁切副本）：比如切蛋糕、把总数分成几份
  function splitInto(target, n, t, o = {}) {
    const el = one(target), count = clamp(Math.round(num(n, 2)), 2, 8), gap = num(o.gap, 36), pieces = [];
    for (let i = 0; i < count; i++) {
      const c = el.cloneNode(true);
      c.removeAttribute("id"); c.setAttribute("data-hold", ""); c.classList.add("mo-piece");
      c.style.clipPath = "inset(0 " + (1 - (i + 1) / count) * 100 + "% 0 " + (i / count) * 100 + "%)";
      c.style.opacity = 0;
      el.parentNode.insertBefore(c, el.nextSibling);
      pieces.push(c);
    }
    tl.set(el, { opacity: 0 }, t);
    pieces.forEach((c, i) => {
      tl.set(c, { opacity: 1 }, t);
      tl.to(c, { x: gp(c, "x") + (i - (count - 1) / 2) * gap, y: gp(c, "y") + (i % 2 ? 8 : -8), rotation: (i - (count - 1) / 2) * 3, duration: num(o.dur, 0.5), ease: "power2.out", immediateRender: false }, t + 0.05);
    });
    return pieces;
  }

  // 出现 / 消失 / 放大 / 抖动 / 点头 / 挥手 / 弹一下
  const appear = (target, t, o = {}) => { const how = o.how || "pop", dur = num(o.dur, 0.4); const els = find(target);
    const from = how === "fade" ? { opacity: 0 } : how === "drop" ? { opacity: 0, y: "-=60" } : how === "rise" ? { opacity: 0, y: "+=50" } : { opacity: 0, scale: 0.4 };
    tl.from(els, { ...from, duration: dur, ease: how === "fade" ? "power1.out" : "back.out(1.7)", immediateRender: false }, t); };
  const vanish = (target, t, o = {}) => { const how = o.how || "fade", dur = num(o.dur, 0.35); const els = find(target);
    tl.to(els, how === "shrink" ? { opacity: 0, scale: 0.2, duration: dur, ease: "power2.in" } : how === "fly" ? { opacity: 0, y: "-=90", duration: dur, ease: "power2.in" } : { opacity: 0, duration: dur }, t); };
  const grow = (target, factor, t, o = {}) => { for (const el of find(target)) tl.to(el, { scale: gp(el, "scale") * num(factor, 1.3) || num(factor, 1.3), duration: num(o.dur, 0.5), ease: o.ease || "back.out(1.5)", immediateRender: false }, t); };
  const shake = (target, t, o = {}) => { const a = num(o.amp, 10), n = Math.max(1, Math.min(8, Math.round(num(o.times, 4)))); tl.to(find(target), { x: "+=" + a, duration: 0.06, yoyo: true, repeat: n * 2 - 1, ease: "sine.inOut", immediateRender: false }, t); };
  const pulse = (target, t, o = {}) => { for (const el of find(target)) tl.to(el, { scale: (gp(el, "scale") || 1) * num(o.factor, 1.25), duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, t); };
  const nod = (target, t, o = {}) => { for (const el of find(target)) { const head = el.querySelector(".head"); tl.to(head || el, head ? { rotation: 14, duration: 0.18, yoyo: true, repeat: 3, ease: "sine.inOut", immediateRender: false } : { y: "-=12", duration: 0.18, yoyo: true, repeat: 3, ease: "sine.inOut", immediateRender: false }, t); } };
  const wave = (target, t, o = {}) => { for (const el of find(target)) { const arm = el.querySelector(o.arm === "l" ? ".arm-l" : ".arm-r"); if (!arm) throw new Error("wave：这个元素里没有手臂（只有 <x-person> 才有）"); tl.to(arm, { rotation: o.arm === "l" ? 150 : -150, duration: 0.25, yoyo: true, repeat: 5, ease: "sine.inOut", immediateRender: false }, t); } };

  const run = () => updaters.forEach((u) => u());
  return { lib: { moveTo, link, stamp, say, setText, splitInto, appear, vanish, grow, shake, pulse, nod, wave }, run, layer };
}
// ---------- 角色组件（OpenMotion 式"可复用组件"：模型不用画人，直接写 <x-person>） ----------
export const KIT_ROLES = {
  cook: { skin: "#F6C79B", hair: "#6B4226", top: "#F7F9FB", pants: "#5B6B7C", extra: "chef", label: "厨师" },
  judge: { skin: "#F2C29A", hair: "#9AA5B1", top: "#2B2F3A", pants: "#2B2F3A", extra: "robe", label: "评委/法官" },
  scientist: { skin: "#F6C79B", hair: "#3A2E2A", top: "#FFFFFF", pants: "#4B5D73", extra: "glasses", label: "科学家/研究员" },
  student: { skin: "#F6C79B", hair: "#2A2A33", top: "#E8832B", pants: "#3F5E8C", extra: "", label: "学生" },
  teacher: { skin: "#F2C29A", hair: "#3A3A44", top: "#3E9C8C", pants: "#3A4350", extra: "glasses", label: "老师" },
  programmer: { skin: "#F6C79B", hair: "#22252E", top: "#4C6FFF", pants: "#33394A", extra: "hood", label: "程序员" },
  guest: { skin: "#F6C79B", hair: "#5A3B28", top: "#D6336C", pants: "#3F5E8C", extra: "", label: "客人/普通人" },
  worker: { skin: "#F2C29A", hair: "#2A2A33", top: "#1F3A5F", pants: "#2A3350", extra: "tie", label: "上班族/标注员" },
};
const KIT_FACES = ["neutral", "happy", "sad", "surprised", "worry", "smirk"];
export function personSvg(role, { id = "", cls = "", style = "", face = "neutral", flip = false, hold = false, width = "" } = {}) {
  const R = KIT_ROLES[role];
  if (!R) throw new Error("x-person 的 role「" + role + "」不存在，可选：" + Object.keys(KIT_ROLES).join("、"));
  if (!KIT_FACES.includes(face)) throw new Error("x-person 的 face「" + face + "」不存在，可选：" + KIT_FACES.join("、"));
  const ink = "#1F3A5F", sw = 3;
  const skin = R.skin, hair = R.hair;
  const hat = R.extra === "chef"
    ? '<g class="hat"><rect x="68" y="14" width="64" height="22" rx="4" fill="#fff" stroke="' + ink + '" stroke-width="' + sw + '"/><circle cx="76" cy="14" r="16" fill="#fff" stroke="' + ink + '" stroke-width="' + sw + '"/><circle cx="100" cy="6" r="18" fill="#fff" stroke="' + ink + '" stroke-width="' + sw + '"/><circle cx="124" cy="14" r="16" fill="#fff" stroke="' + ink + '" stroke-width="' + sw + '"/><rect x="68" y="14" width="64" height="22" rx="4" fill="#fff"/><line x1="68" y1="36" x2="132" y2="36" stroke="' + ink + '" stroke-width="' + sw + '"/></g>'
    : '<path class="hair" d="M58 62 Q58 22 100 20 Q142 22 142 62 Q128 40 100 42 Q72 40 58 62Z" fill="' + hair + '" stroke="' + ink + '" stroke-width="' + sw + '"/>';
  const glasses = R.extra === "glasses" ? '<g fill="none" stroke="' + ink + '" stroke-width="3"><circle cx="82" cy="70" r="12" fill="#fff" fill-opacity=".5"/><circle cx="118" cy="70" r="12" fill="#fff" fill-opacity=".5"/><line x1="94" y1="70" x2="106" y2="70"/></g>' : "";
  const faces = {
    neutral: '<circle cx="84" cy="70" r="5" fill="' + ink + '"/><circle cx="116" cy="70" r="5" fill="' + ink + '"/><path d="M88 96 L112 96" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/>',
    happy: '<path d="M76 72 Q84 62 92 72" fill="none" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/><path d="M108 72 Q116 62 124 72" fill="none" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/><path d="M80 88 Q100 114 120 88Z" fill="#fff" stroke="' + ink + '" stroke-width="4" stroke-linejoin="round"/><path d="M90 98 Q100 106 110 98" fill="#E8736B"/>',
    sad: '<circle cx="84" cy="72" r="5" fill="' + ink + '"/><circle cx="116" cy="72" r="5" fill="' + ink + '"/><path d="M72 58 L92 64" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/><path d="M128 58 L108 64" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/><path d="M86 102 Q100 90 114 102" fill="none" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/><path d="M80 80 Q76 90 80 94 Q86 90 80 80Z" fill="#7CC4F0"/>',
    surprised: '<circle cx="84" cy="68" r="9" fill="#fff" stroke="' + ink + '" stroke-width="3"/><circle cx="116" cy="68" r="9" fill="#fff" stroke="' + ink + '" stroke-width="3"/><circle cx="84" cy="68" r="3.5" fill="' + ink + '"/><circle cx="116" cy="68" r="3.5" fill="' + ink + '"/><path d="M72 52 Q84 44 94 52" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/><path d="M106 52 Q116 44 128 52" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="9" ry="12" fill="#7A2E2E" stroke="' + ink + '" stroke-width="3"/>',
    worry: '<circle cx="84" cy="72" r="5" fill="' + ink + '"/><circle cx="116" cy="72" r="5" fill="' + ink + '"/><path d="M74 62 L92 56" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/><path d="M126 62 L108 56" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/><path d="M86 100 Q93 94 100 100 Q107 106 114 100" fill="none" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/><path d="M132 52 Q126 62 132 68 Q138 62 132 52Z" fill="#7CC4F0" stroke="' + ink + '" stroke-width="2"/>',
    smirk: '<circle cx="84" cy="70" r="5" fill="' + ink + '"/><circle cx="116" cy="70" r="5" fill="' + ink + '"/><path d="M74 58 L92 60" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/><path d="M108 54 L128 50" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/><path d="M86 96 Q104 100 116 88" fill="none" stroke="' + ink + '" stroke-width="4" stroke-linecap="round"/>',
  };
  const faceG = KIT_FACES.map((n) => '<g class="f-' + n + '" style="opacity:' + (n === face ? 1 : 0) + '">' + faces[n] + "</g>").join("");
  const robe = R.extra === "robe" ? '<path d="M88 118 L100 150 L112 118Z" fill="#fff" stroke="' + ink + '" stroke-width="2"/>' : "";
  const tie = R.extra === "tie" ? '<path d="M100 120 L94 140 L100 168 L106 140Z" fill="#D6336C" stroke="' + ink + '" stroke-width="2"/>' : "";
  const scarf = R.extra === "chef" ? '<path d="M82 116 Q100 134 118 116 L112 106 Q100 114 88 106Z" fill="#E64560" stroke="' + ink + '" stroke-width="2"/>' : "";
  const hood = R.extra === "hood" ? '<path d="M70 112 Q100 134 130 112 L124 104 Q100 120 76 104Z" fill="#3552D6" stroke="' + ink + '" stroke-width="2"/>' : "";
  const arm = (x, c) => '<g class="' + c + '"><rect x="' + x + '" y="122" width="22" height="78" rx="11" fill="' + R.top + '" stroke="' + ink + '" stroke-width="' + sw + '"/><circle cx="' + (x + 11) + '" cy="206" r="12" fill="' + skin + '" stroke="' + ink + '" stroke-width="' + sw + '"/></g>';
  const leg = (x, c) => '<g class="' + c + '"><rect x="' + x + '" y="206" width="28" height="86" rx="10" fill="' + R.pants + '" stroke="' + ink + '" stroke-width="' + sw + '"/><ellipse cx="' + (x + 14) + '" cy="296" rx="20" ry="10" fill="#3A3F4B" stroke="' + ink + '" stroke-width="' + sw + '"/></g>';
  const inner =
    leg(70, "leg-l") + leg(102, "leg-r") +
    '<g class="body"><rect x="62" y="112" width="76" height="106" rx="22" fill="' + R.top + '" stroke="' + ink + '" stroke-width="' + sw + '"/>' + robe + tie + scarf + hood + "</g>" +
    arm(40, "arm-l") + arm(138, "arm-r") +
    '<g class="head"><rect x="90" y="104" width="20" height="16" fill="' + skin + '"/><circle cx="58" cy="76" r="9" fill="' + skin + '" stroke="' + ink + '" stroke-width="' + sw + '"/><circle cx="142" cy="76" r="9" fill="' + skin + '" stroke="' + ink + '" stroke-width="' + sw + '"/><circle cx="100" cy="72" r="46" fill="' + skin + '" stroke="' + ink + '" stroke-width="' + sw + '"/>' + hat + faceG + glasses + "</g>";
  const body = flip ? '<g transform="translate(200,0) scale(-1,1)">' + inner + "</g>" : inner;
  const st = "position:absolute;aspect-ratio:200/320;overflow:visible;" + style + (width ? ";width:" + width + "px" : "");
  return '<svg id="' + id + '" class="person role-' + role + " " + cls + '" viewBox="0 0 200 320" style="' + st + '"' + (hold ? " data-hold" : "") + ">" + body + "</svg>";
}
/** 把 html 里的 <x-person …></x-person> 展开成矢量人物 */
export function expandKit(html) {
  return String(html ?? "").replace(/<x-person\b([^>]*?)\/?>(?:\s*<\/x-person>)?/gi, (m, attrs) => {
    const get = (n) => { const r = new RegExp("(?:^|\\s)" + n + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", "i").exec(attrs); return r ? (r[2] ?? r[3] ?? "") : null; };
    const flag = (n) => new RegExp("(?:^|\\s)" + n + "(?=\\s|=|$)", "i").test(attrs);
    return personSvg(get("role") ?? "guest", { id: get("id") ?? "", cls: get("class") ?? "", style: get("style") ?? "", face: get("face") ?? "neutral", flip: flag("flip"), hold: flag("data-hold"), width: get("width") ?? "" });
  });
}
