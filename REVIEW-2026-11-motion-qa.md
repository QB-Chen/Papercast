# 动画生成/评审、渲染后质检与自动修复（motion + qa）审查

本次改动让模型写 HTML+CSS+GSAP 动画并逐帧 seek 渲染，加上渲染后看图质检（qa-render）和自动重做（qa-fix），并接进 paper2video 的 motion、qa 阶段。渲染侧改动（rich3.tsx 蒙版盒子、free.tsx 角色夹取）基本站得住。自动化闭环有三处会让结果静默出错：qa-fix 的"high 变少"判据读的是缓存的旧静帧，分镜校验步骤永远通过，渲染时的 `DUR` 和检查时的 `DUR` 不是同一个值。另外，motion-runtime 的静态检查不能当沙箱，PIPELINE.md 里有几处数字与项目现状不符。

Watch for:
- qa-fix 复检不会重新渲染静帧（`qa-render.mjs:36`），PIPELINE.md 里 b5、b6 的"high 2 → 0"没有可靠依据（confirmed）。
- `validate-project.mjs` 永远退出 0，qa-fix 的"分镜校验"是空操作（confirmed）。
- 渲染时脚本的 `DUR` 是"到场景结束"，检查和提示词里是"这段旁白总长"，已装的 4 个脚本用到了 `DUR`（confirmed）。
- 已装的 30 个 motion 镜头里 25 个低于 install-motion 默认的 50% 门槛，其中 6 个 0 个动作成立（confirmed）。
- `checkScript`/`sanitizeHtml`/`scopeCss` 可被绕过，检查页还能被 `</script>` 注入（confirmed，用静态检查函数实测；未在浏览器里执行）。
- 这套 motion、qa 阶段从未通过 paper2video 跑完过：项目没有 `qa.log`、`qa-fix.log`、`motion-install.log`，`motion-gen.log` 只有 1004 字节且停在中途（confirmed）。

**Verdict**: NEEDS_CHANGES

**结论：不通过。** 渲染运行时（rich3.tsx、free.tsx）可有条件通过。动画生成、评审、安装和质检、自动修复这一整条自动化链，在 B1 到 B3 修掉之前不能当作"无需人盯"使用。

## High-level view

rich3 的蒙版盒子改动没有发现收敛或 delayRender 问题。free.tsx 的夹取在两种画布高度下 `stageH` 都对，但连接线、圈、括号仍按未夹取的位置画，会和被夹取的角色错开。

motion-runtime 靠正则黑名单限制模型代码，没有真正的隔离。脚本能经 `$()` 拿到的元素走到 `ownerDocument.defaultView`，再用字符串拼接绕开 `fetch`、`constructor` 等关键字。检查页（motion-check）用 `--no-sandbox --allow-file-access-from-files` 的 Edge 加载，且把模型脚本内嵌进 `<script>`，没有转义 `</script>`。渲染期脚本出错时 MotionEl 会吞掉异常，把错误文字画进视频，渲染仍以 0 退出。

动画评审的"两边都认可才算成立"在看图失败时退化成只看文字。看图只取时间上最早的 12 帧，动作数 ≥ 6 的演示（30 个里有 12 个）后面的动作根本没被看到，成立占比被压低。install-motion 的门槛在项目里实际没有生效：30 个已装镜头中只有 5 个达到 50%。

qa 链的核心缺陷是缓存。qa-render 按帧号缓存 PNG，复检时不重渲染，qa-fix 比较的是同一批旧图的两次模型判断。再加上校验步骤不会失败、模型调用全失败时质检仍判"通过"，自动修复的保留/恢复决定不可信。分镜、props、qa-report 三者在失败分支里大多能恢复一致，例外见 M4、M5 和 N3。

PIPELINE.md 把"约一半的动作成立"写成事实（实际 27%，45/168），写了 50% 安装门槛和"校验"步骤（项目状态与代码都不支持），没有写明这套流程没在新论文上跑通过。

<details>
<summary>Issues (25)</summary>

1. **B1 复检读旧静帧** — `qa-render.mjs:36` 按帧号复用已有 PNG，qa-fix 复检不会渲染新画面。`--scene` 模式下跳过缓存，或在复检前删掉该场景帧对应的 `out/qa/qa_<frame>.png`。
2. **B2 校验步骤是空操作** — `validate-project.mjs` 不设退出码，`qa-fix.mjs:75-77` 的"分镜校验"永远通过。加 `--scene` 过滤并在有问题时设 `process.exitCode = 1`，qa-fix 只校验被改的场景。
3. **B3 `DUR` 渲染与检查不一致** — `motion-code.tsx:34,50` 把 `DUR` 设为到场景结束，检查和提示词是旁白长度。已装 4 个脚本受影响，x2 是 9.8 秒对 79.4 秒。安装时把 `to` 写进 `motion`，渲染按真实时间线算旁白长度。
4. **M1 静态沙箱可绕过** — `ownerDocument.defaultView`、字符串拼接属性名、`<svg/onload>`、CSS `}` 逃出舞台等全部通过检查。把正则当 lint，补关键字和括号平衡检查，要处理不可信论文就加 iframe sandbox 与 CSP。
5. **M2 检查页注入与 Edge 权限** — `motion-check.mjs:29` 内嵌 JSON 未转义 `<`，`:64` 开了 `--no-sandbox --allow-file-access-from-files`。转义 `<` 为 `\u003c`，先去掉文件访问开关再试。
6. **M3 质检全失败也判通过** — `qa-render.mjs:54-59,85-86` 分组失败只打印，不影响退出码。统计失败组数，超过 0 时在报告标注并以非 0/3 退出。
7. **M4 qa-fix 复用旧候选文件** — `qa-fix.mjs:55-58` 不删旧 `motion-qafix/<scene>-<from>.json` 也不看 gen-motion 退出码，导演阶段失败会读到上一次的候选。生成前先删文件。
8. **M5 失败分支不回滚与中断窗口** — `install-motion.mjs:52,81-86` 先写分镜再查锚点，失败时不恢复也不重建 props。`qa-fix.mjs:71-92` 在安装后、写 `motion/*.json` 前被杀会让分镜与结果文件不一致。失败时从备份恢复并重建 props。
9. **M6 看图失败时只看文字就判成立** — `motion-review.mjs:44` 在 `vOK === null` 时只凭文字判成立，`gen-motion.mjs:103` 的写法又不同。看图缺失时一律判"未验证"，两处合并成一个函数。
10. **M7 看图只截前 12 帧** — `motion-vision.mjs:31-32` 按时间截断，动作数 ≥ 6 时后面的动作没有画面。按动作均摊帧数，或分两张拼图。
11. **M8 `--from render` 会先跑 qa 和 qa-fix** — state.json 没有 `qa`，`paper2video.mjs:340` 会先执行 qa 阶段并可能改分镜。给已有项目补 `done.qa`，或让 render 只依赖 motion 完成。`paper2video.mjs:233` 传的 `--board-model` 被 qa-fix 忽略。
12. **M9 `--fresh` 覆盖旧结果无备份** — `gen-motion-best.mjs:67-96` 新候选全部评审更差也会覆盖旧文件。覆盖前备份，或让旧版本也参与比较。
13. **M10 free.tsx 夹取与 bbox 不一致** — `free.tsx:81,88` 的 bbox 用未夹取位置，圈和连线会和被夹取的角色错开。把夹取抽成函数，bboxOf 也用它。
14. **M11 非确定性写法未禁止** — FORBIDDEN 没有 `Math.random`、`Date`、`performance`，多标签渲染会各自生成不同的随机值。加入黑名单。
15. **M12 模型白名单漏掉流式调用** — `llm.mjs:57-130` 的 `chatStream` 不检查白名单，`ALLOW_ANY_MODEL=0` 也会放开。在 `chatStream` 入口复用同一检查，改成 `=== "1"`。
16. **M13 渲染期脚本出错只画进视频** — `motion-code.tsx:53-58` 捕获异常后继续渲染。在 render 前用真实时间线对所有 motion 镜头跑一遍 `checkMotion`。
17. **M14 已装动画低于门槛** — 25/30 个已装 motion 镜头 <50%，6 个为 0。从 `storyboards-before-motion-*` 恢复后按门槛重装，或明确决定保留并改文档。
18. **M15 PIPELINE.md 夸大与遗漏** — 见 Q5。逐条改成与数据一致，补上"未在新论文上跑通"。
19. **N1 旋转规则漏掉初始 rot** — `free-validate.mjs:138` 只查关键帧，`:130` 的初始 `rot` 不查。加同样检查。
20. **N2 qa-render 边界崩溃** — `frame-qa.mjs:38` 不检查 frame 为整数，`qa-render.mjs:81` 不检查 `what` 为字符串。
21. **N3 报告三者不一致** — `qa-report.json` 的 `frames` 是上次 `--scene` 的帧数，恢复分支不回写 `qa-report.md`，motion-report.md 已过期。
22. **N4 实体解码顺序** — `motion-check.mjs:91` 先解 `&amp;` 再解 `&lt;`，应最后解 `&amp;`。
23. **N5 日志体积** — `llm.mjs:32` 每次看图调用写 2.4 MB 日志，无上限。
24. **N6 无测试与硬编码路径** — `installPlan`、qa-fix、install-motion 没有测试；Edge、ffmpeg 路径写死。
25. **N7 定格阈值按句数** — `motion-slots.mjs:29-30` 的 `tail > 1` 按句子数，h7 实际定格 12.2 秒。

</details>

<details>
<summary>Details</summary>

## 审查范围与证据来源

对比了所有带 `.bak-*` 的现行文件，新文件整份读过。项目侧用 `projects/2305.18290` 的 state.json、storyboards、props.json、narration/motion/*.json、qa-report.json、out/qa、logs 做了交叉核对。我没有渲染视频、没有在浏览器里执行任何绕过样例，只用 `checkScript`/`sanitizeHtml`/`scopeCss` 这些纯函数跑了静态探针（临时脚本已删除，未改任何源码和项目数据）。motion-prompts.mjs、storyboard-schema.mjs、free-validate.mjs 只审了 diff 及相关片段，没有通读。

## qa-fix 的复检读的是旧静帧（B1）

问题在 `qa-render.mjs:36`：`need = frames.filter((f) => !existsSync(...qa_${f}.png))`，已有 PNG 一律不重渲染。qa-fix 装进新动画后调用 `qa-render --scene <scene>`（`qa-fix.mjs:80`），场景内帧号不变，所以拿到的还是修复前的图。"high 必须变少"这个判据比较的是同一批图在两次模型调用中的随机差异。

项目里有直接证据：`out/qa` 下 178 张 PNG 的最新修改时间是 11-23 23:55，而 background.json（11-24 01:58）、dpoloss.json（02:14）、experiment1.json（02:25）都是之后才被改写，qa-report.json 写于 02:26。PIPELINE.md 里"b5、b6 自动重做后 high 2 → 0"就是这条路径产出的，不能当作修复有效的证据。paper2video 的 qa 阶段在 qa-fix 之后再跑一次 `run1()`（`paper2video.mjs:235`），同样读缓存，"画面质检通过"的提示不可信。

- 位置：`qa-render.mjs:36-40`、`qa-fix.mjs:80-91`、`paper2video.mjs:235`
- 触发：任何第二次对同一场景跑 qa-render
- 严重程度：阻断；置信度：confirmed
- 最小修改：`const need = only ? frames : frames.filter(...)`；整片重跑时按 `props.json` 的 mtime 或哈希给缓存目录分层。

## 校验步骤不会失败（B2）

`validate-project.mjs` 全文没有 `process.exit` 或 `exitCode`，只打印"合计 N 个问题"。qa-fix 的 `checks` 数组（`qa-fix.mjs:75`）依赖它的退出码，实际只有 check-anchors 和 build-props 会拦截。直接给它加退出码会有另一个问题：它校验全部场景，项目里只要有一个旧问题，每次修复都会被恢复。

- 位置：`validate-project.mjs:54-59`、`qa-fix.mjs:75-77`
- 触发：新动画引入校验器能识别的错误（出界、重叠、cue 缺失等）
- 严重程度：阻断；置信度：confirmed
- 最小修改：validate-project 增加 `--scene <id>`，并在有问题时 `process.exitCode = 1`；qa-fix 传入被改的场景。

## DUR 在检查和渲染里不是同一个值（B3）

提示词（`motion-prompts.mjs:43,72`）告诉模型 `DUR` 是"这段旁白总时长"，gen-motion、motion-ctx 和 motion-check 都传旁白估算秒数。渲染时 `motion-code.tsx:34` 把 `durSec` 算成 `(scene.dur - startF) / fps`，也就是从镜头起点到场景结束。对场景中间的演示，两者差很多。

已装的 30 个脚本里有 4 个用了 `DUR`：

- background-b8：检查 10.6 秒，渲染 20.9 秒，收尾动作 `DUR-0.9` 落在 20 秒处，比检查时的 9.7 秒晚一倍。
- experiment2-x2：9.8 秒对 79.4 秒，收尾的 `DUR - 0.7` 落在 78.7 秒，永远演不到。
- experiment2-x7：12.4 秒对 36.6 秒，`Math.min(t+2.4, DUR-4.4)` 取值不同。
- hook-h7：9.2 秒对 32.5 秒。

检查通过的画面和成片里的画面不一致，且没有任何报错。

- 位置：`motion-code.tsx:34,50`，对照 `gen-motion.mjs:30`、`motion-ctx.mjs:16`、`motion-prompts.mjs:43,72`
- 触发：演示不在场景末尾，且脚本用了 `DUR`
- 严重程度：阻断；置信度：confirmed
- 最小修改：`applyInstall` 把 `to: demo.to` 写进 `motion`；MotionEl 用 `(那一句的 local + dur − startF) / fps` 作为 `dur`（缺 `to` 时退回旧算法）。

旁白估算（每秒 5 字）和真实配音相差 0.71 到 1.21 倍（30 个演示的实测比值）。`cue()` 在渲染时用真实时间，所以靠 cue 定位的动作会跟着走。但 25 个脚本里有写死数字的开始时间，这些不会缩放，检查时的"画面停住"、"动作那一刻有变化"也是按估算时间测的（possible，没有逐个验证）。

## 沙箱：静态检查不是边界（M1、M2、M11）

模型输出属于不可信输入，这里的结论是：当前检查拦不住有意绕过的脚本。我用 `motion-runtime.mjs` 导出的函数做了探针：

- 以下写法 `checkScript` 返回空数组（通过）：`$("#a")["owner"+"Document"]["default"+"View"]["fe"+"tch"](...)`；`[]["fi"+"lter"]["con"+"structor"]("return this")()`；`$("#a").ownerDocument.body.innerHTML = "x"`；`for (let i=0;i<5;i--){}`；`Math.random()`；`Date.now()`；`for` 嵌套三层各 60 次。直接写 `fetch(`、`document` 会被拦。
- `sanitizeHtml` 不拦：`<svg/onload=...>`、`<details/open/ontoggle=...>`、`<img srcset="https://...">`、`<video poster="https://...">`。原因是事件属性正则要求前面有空白（`:49`），外链正则只认 `src`、`href`、`xlink:href`，不含 `srcset`、`poster`（`:51`）。
- `expandKit` 把 `<x-person class='a"/onload="..."'>` 的属性值原样拼进 `<svg ...>`（`:173`），展开发生在 sanitize 之前，但展开后的 `"/onload=` 前面不是空白，同样通过。
- `scopeCss` 不检查括号平衡：`.a{color:red} } body{display:none !important} .b{` 输出 `#mo-1{.a{color:red} } body{display:none !important} .b{}`，第二段规则在整个页面（Remotion 合成）上生效。`position:/**/fixed` 绕过 fixed 检查，`image-set("https://...")` 绕过外链检查。

无限循环类写法（`i--`、嵌套）按代码推断（未实际运行）会被 `motion-check.mjs:64` 的 60 秒超时拦住，返回"页面没有跑出结果"，不会进入渲染。渲染页没有这个兜底，但脚本和检查时运行的是同一份，没有随机性就会同样终止。

检查页本身另有问题：`motion-check.mjs:29` 把 `JSON.stringify({html, css, script, ...})` 直接放进 `<script>`，`</script>` 不会被转义。模型脚本里的字符串 `"</script><script>…"` 会提前结束脚本块，注入的代码在 `buildMotion` 之外运行，没有任何限制。Edge 以 `--no-sandbox --allow-file-access-from-files` 启动（`:64`），页面可以读本地文件并联网。

Q3 的回答：会被绕过。要处理未知来源的论文并无人值守，需要真正的隔离，正则只能当提示用的 lint。

- 位置：`motion-runtime.mjs:13-30`（FORBIDDEN）、`:32-42`（checkScript）、`:44-64`（sanitizeHtml）、`:66-76`（scopeCss）、`:173-176`（personSvg/expandKit）；`motion-check.mjs:29,64`
- 触发：论文文本诱导模型输出恶意脚本，或模型自己写出带 `}` 的 CSS
- 严重程度：重要（只处理自己信任的论文时风险低）；置信度：confirmed（静态探针），浏览器侧利用未执行
- 最小修改：payload 用 `.replace(/</g, "\\u003c")`；去掉 `--allow-file-access-from-files` 看资源是否仍能加载；FORBIDDEN 追加 `ownerDocument|defaultView|contentWindow|parentNode|Math\.random|Date\b|performance`，并拒绝 `[` 后面带 `"…"+` 的拼接属性名；scopeCss 加括号平衡检查并拒绝 `/*`；`personSvg` 对 `id/class/style/width` 做属性转义。不可信输入场景再加 iframe sandbox 和 `connect-src 'none'` 的 CSP。

非确定性：`Math.random`、`Date.now` 没有被禁，Remotion 多标签并行渲染时每个标签各自建一次时间线，随机值不同会让帧间闪烁。检查页只跑一次，看不出来。当前 30 个脚本都没用（confirmed），所以是预防项。

## 渲染期出错不会让渲染失败，也不会被发现（M13）

`motion-code.tsx:53-58` 捕获 `buildMotion` 异常，把"动画代码出错：…"画进视频底部，渲染继续并以 0 退出。渲染后的 `check-video-audio.mjs` 只检查音轨，发现不了。cue 解析规则本身在检查和渲染间一致：`check-anchors.mjs:11-24` 与 `canvas.tsx:34-56` 逻辑相同，动态拼接的 cue 参数在 `motion-check.mjs:77-80` 和浏览器里的 `P.cues` 查表（`:33`）都会被拒。所以这条路径只会在真实时间线和生成时的文本不同步时触发，例如重做配音后旁白改了而动画没重做。

- 位置：`motion-code.tsx:53-58`
- 触发：旁白或字幕改动后，motion 里的 cue 短语不再存在，或脚本抛异常
- 严重程度：重要；置信度：confirmed
- 最小修改：render 前对所有 motion 镜头用真实时间线（`cueAt` 同款解析）和真实 `dur` 再跑一次 `checkMotion`，失败则中止。

## install-motion 与 qa-fix 的失败分支（M4、M5）

install-motion 先备份，再在循环里逐场景写分镜（`:52`），最后才跑 check-anchors 和 build-props。锚点检查失败时 `process.exit(1)`（`:83`），分镜已改、props 是旧的，没有自动恢复，paper2video 只报错（`paper2video.mjs:219`）。写分镜不是原子的，中途异常会留下一部分场景已改。

qa-fix 逐条走一遍：

- plan 不可换：未改动，一致。
- 生成失败：未改动，但 `qa-fix.mjs:55` 不检查退出码，也不删旧文件，`:57-58` 会读到上一次运行遗留的候选（`motion-qafix` 下现有 4 个文件）。导演阶段 `process.exit(1)` 发生在写文件之前，这时就会误用旧候选，之后仍要过评审和复检，但是以旧候选为输入。
- 评审拒绝：未改动，一致。
- 锚点或构建失败：`restore` 复制备份并重建 props（`:74`），一致。校验步骤不会失败（B2）。
- 质检没跑成（退出码不在 0、3）：恢复分镜。若 qa-render 在 `:81` 抛错，`qa-report.json` 已在 `:75` 写入，会和恢复后的分镜不一致。
- high 没变少：恢复分镜，并把 `qa-report.json` 里该场景的条目换回 `rep0` 的版本（`:86`），但 `qa-report.md` 没有重写，仍是新结果。`rep0` 是脚本启动时的报告，同一场景里先前保留的修复会被这一步回退。
- 保留：`motion/<scene>-<from>.json` 在最后一步（`:92`）才写。在这之前被杀，分镜是新的、结果文件是旧的，之后重跑 install-motion 会用旧结果覆盖这次修复（possible，未模拟）。

项目现状：我对 10 个场景比较了 props.json 与 storyboards 的 beats，0 处不一致；qa-report 与分镜不一致（报告基于旧静帧，见 B1、N3）。

- 严重程度：重要；置信度：confirmed（install-motion 与旧候选），possible（被杀的窗口）
- 最小修改：install-motion 在检查失败时用刚做的备份恢复并重建 props；qa-fix 生成前 `rmSync(file, {force:true})` 并检查 `g.status`；恢复分支同时重写 md；先写 `motion/*.json` 的临时文件，检查通过后再替换。

## 评审判定与取帧（M6、M7）

`motion-review.mjs:42-44` 里，文字评审缺失（`tOK === null`）且看图成立时判成立；看图失败（`vOK === null`）且文字成立时也判成立。`reviewRank` 对没有看图的版本扣 500，但 install-motion 用的是 `okBeats/beatCount`，不看 `hasVision`（`install-motion.mjs:30-31`）。所以"两边都认可才算成立"在一边失败时被文字或看图单独放行。`gen-motion.mjs:103` 的写法对"文字缺失、看图成立"返回"未验证"，两处不一致。

`motion-vision.mjs:22-33` 给每个动作取两帧，加最后一帧，按时间排序后 `slice(0, 12)`。动作数 ≥ 6 就会超过 12 帧，后面的动作和最后一帧被截掉，模型却被要求判断所有动作，只能报"未验证"或"需修改"。项目里 12 个演示动作数 ≥ 6（b2、b6、d11、d12、e2、e8、g11、h2、h5、i15、u4、x7），这些的成立占比偏低是方法造成的。

- 严重程度：重要；置信度：confirmed
- 最小修改：`reviewMotion` 里 `vj` 为空时所有动作最多判"未验证"，install-motion 要求 `review.hasVision`；`pickTimes` 按动作均摊帧数（动作多就每个动作一帧）或分两张拼图。

默认只有一个文字评审模型（`glm-5.3`），motion-judge-multi 的"取各家更差的判定"实际不起作用。

## motion-slots 的"能不能换"（N7）

定格判断按句子数（`motion-slots.mjs:29-30`，`tail > 1` 才拒绝）。hook 场景里 `installPlan(h7)` 返回 `ok, tail 1`：h7 后面只有 h8 一句，但 h8 长 11.6 秒，动画在旁白结束后还要定格 12.2 秒（镜头共 19.9 秒）。项目全部 30 个 motion 镜头里只有 h7 超过 3 秒。

- 严重程度：次要；置信度：confirmed
- 最小修改：按秒判断：下一个镜头起点减去 `to` 句结束超过 4 秒就不换。

## 流水线阶段与已有项目（M8、M9）

state.json 的 `done` 里有 motion 和 render，没有 qa。`--from render` 只清除 render 及之后的阶段，主循环从头走，qa 阶段会被执行：约 30 次看图调用，若质检报告里还有 high（现有 4 条，d12、e9 是 `empty`），还会跑 qa-fix（PIPELINE.md:222 估计每个演示 30 到 40 分钟），并可能改写分镜，然后才渲染。这和"手动把 motion 标成已完成以避免重新生成动画"的目的相反。

`paper2video.mjs:233` 给 qa-fix 传的是 `--board-model`，qa-fix 只认 `--max-demos` 和 `--model`，动画模型不会跟着 `--motion-model` 变。`:17` 的 id 推断没有把 motion、qa 加入阶段名列表，`--only qa <id>`（id 在后）会把 `qa` 当成 id。

`--approve 3` 已经是 true，原来批准的是 motion 之后、没有 qa 的版本，现在检查点 3 含义变了但批准沿用。

- 严重程度：重要；置信度：confirmed
- 最小修改：在 state.json 给该项目补 `"qa": <时间>`，或在 `qa` 阶段开头检查 `out/qa` 缓存与 props 是否同步。把 `["plan","fetch",...]` 列表补上 motion 和 qa。去掉无效的 `--board-model` 并转发 `--model MODELS.motion`。

`gen-motion-best.mjs:67-96`：`--fresh` 时旧版本不进候选，只要有一个新候选通过浏览器检查就覆盖旧文件（`:96`），哪怕评审更差，且没有备份。文件头注释写的是"新版本全失败才保留旧版本"，与实际一致，但没说覆盖不可逆。最小修改：覆盖前 `copyFileSync` 到 `.bak-<时间>`，或让旧版本参与排名。

## 已装动画的状态（M14）

`install-motion.mjs:15,30-31` 的默认门槛是 0.5。项目里 30 个 motion 镜头的结果文件与分镜里的脚本逐字一致（全部已装），但只有 b4、e2、h2、i15、u8 五个占比 ≥ 0.5。e10、e9、x1、g11、o9、u7 这 6 个是 0 个动作成立。成立动作合计 45/168，约 27%。`motion-report.md`（11-23 18:30）写"已装 27 个"，没有包含之后装入的 b6、d12、e9。按文件时间推断，e9 在 11-24 02:25 被装入，而 qa-fix 的"至少一个动作成立"检查（`qa-fix.mjs:67`）所在文件是 02:27 才最后修改的，所以现存的 e9 是这个检查加入前装入的 0/4 版本。项目没有 `motion-install.log`，当时的命令行已无从查证，应该是用过更低的 `--min-ratio`。

- 严重程度：重要；置信度：confirmed
- 最小修改：要么从 `storyboards-before-motion-2026-11-231030` 恢复后用默认门槛重装，要么明确决定全部保留并在 PIPELINE.md、motion-report.md 里改成实际情况。重新生成 motion-report.md。

## free.tsx 与 rich3.tsx（M10）

free.tsx：Actor 里 `stageH = PY * 100`。非 fill 时 `LHeff = CH`，`stageH` 是 520；fill（eqx 插入区）时是 `box.h / k`。`PY` 是模块级变量，由 FreeEl 渲染时设置，React 深度优先渲染，Actor 在同一个 FreeEl 的子树内读到的是自己的值，两个 FreeEl 同帧并存也不会串。`hi < lo` 时居中，头顶气泡仍可能超出舞台上沿。

副作用：连接线、圈、括号通过 `bb()` 读 `bboxOf`（`free.tsx:81,88`），它用未夹取的 `st.y * PY`，而 Actor 画在夹取后的位置（`:305-308`）。角色 y 被夹取时，圈和线会偏离角色，偏移量等于被夹取的距离（520 画布里 size 300 的角色 y=90 时约 100 到 130px）。另外 `bounce`、`jump` 的 `gy` 加进 `cyRaw` 再夹取，原位已被夹取的角色这些动作会被压平。非角色的 `icon` 也被夹取，留 4px 边距，原来靠边放的道具会被推进来。已有的、没有开 `strictLayout` 校验的旧分镜会受影响，新分镜被校验器拦在舞台内。

- 严重程度：重要；置信度：confirmed（代码层面；未渲染验证）
- 最小修改：把 `lo/hi/cy` 的计算抽成函数，`bboxOf` 对 char/icon 用同一函数。

rich3.tsx（回答你的三个问题，仅读代码，没有渲染）：`inner` 改成绝对定位后 `offsetWidth/Height` 仍是未缩放的布局尺寸，`white-space: nowrap` 使宽度等于内容最大宽度，不受 `left: 50%` 影响，所以 `w/h` 与 `scale`、`boxSize` 无关。`setBoxSize` 只在尺寸变化超过 0.5 时触发，`setScale` 只在目标变化超过 0.004 时触发，各最多发生一次，不会循环。第一帧：`boxSize` 为 null 时先用旧布局，layout effect 里同步 `setBoxSize`，浏览器绘制前就会重渲染，不会出现不一致的第一帧。`delayRender` 的释放只发生在 `fonts.ready` 之后的最新一次 effect 里（`:153-159`），这次改动没有改变这一点；组件若在字体就绪前卸载，`alive` 为 false，handle 不会释放，只能等超时，这个风险不是本次引入的。遮罩盒现在恰好等于 `offsetWidth × offsetHeight`（整数）乘以缩放，斜体或上标悬出内容盒的部分会被遮罩切掉（possible，需要渲染 i1、i9 对比）。

## 模型白名单（M12）

`llm.mjs:11-13` 的正则本身没有漏洞，ASR 和 TTS 不走 `chat()`（`lib.mjs:22` 直接 fetch），没有被误伤。漏洞在别处，有两个。`chatStream`/`chatStreamOnce`（`:57-130`）不做检查，`chatJson` 在 `opts.stream` 为真时走这条路（`:160-161`），gen-narration、plan-scenes、plan-formulas、review-narration、review-storyboard、review-style 都是流式，这些脚本传非白名单模型不会报错。`process.env.ALLOW_ANY_MODEL` 只判断真假，设成 `"0"` 也会放开。

- 严重程度：重要；置信度：confirmed
- 最小修改：抽出 `assertModel(model)`，`chat` 和 `chatStream` 都先调用；环境变量改成 `=== "1"`。

## 质检模型失败被当作"没有毛病"（M3、N2）

`qa-render.mjs:54-59`：一组调用重试一次后仍失败，只打印"质检没跑成"，`defects` 为空，不影响报告和退出码。网关不可用、429 用尽或模型名被白名单拒绝时，整片报告是"0 处毛病"，退出码 0，paper2video 显示"画面质检通过"（`paper2video.mjs:237`）。qa-fix 的"high 变少"也会被这种失败满足。

另有边界崩溃：`frame-qa.mjs:38` 只检查 `d.frame` 在范围内，不要求整数，`1.5` 会让 `g.items[d.frame - 1]` 为 undefined，`:57` 抛 TypeError，工作协程崩溃，进程以非 0、非 3 退出。`d.what` 缺失时 `qa-render.mjs:81` 在 json 已写入后崩溃，md 没生成。`severity` 不是 `high`/`low` 时被静默忽略。

- 严重程度：重要（失败当通过）、次要（崩溃）；置信度：confirmed
- 最小修改：统计 `failedGroups`，写入 report，非 0 时在 md 顶部标出，并以 4 退出；`Number.isInteger(d.frame)` 且 `typeof d.what === "string"` 再入列。

## 小项（N1、N3 到 N6）

free-validate.mjs:138 只检查关键帧里的 `k.rot`，`:130` 的初始 `o.rot` 只检查范围，`{type:"text", rot:180}` 能通过，这正是 d5 那类问题。motion-check.mjs:91 先解 `&amp;` 再解 `&lt;`、`&gt;`，页面文字里本来就有 `&lt;` 字样时会多解一次，只影响文字内容检查。llm.mjs:32 每次调用写完整请求日志，看图调用带 base64 图片，每个日志 2.4 MB，`llm-test/log` 没有清理。qa-render 的 `frames` 字段记录的是本次的帧数，`--scene` 运行后 `qa-report.json` 里是 12，md 里"检查了 12 帧"与"发现 41 处毛病"并列，读者会误解。没有为 `installPlan`/`applyInstall`、`reviewMotion` 的合并逻辑、qa-fix 分支写测试；Edge 路径（`motion-check.mjs:11`）和 ffmpeg 路径写死，新机器上第一步就会失败。

## 对你的 6 个问题的回答

**Q1 渲染中途崩溃或静默产出错成片的路径。** 没有发现会让渲染崩溃的路径（check-anchors 的解析规则与 `cueAt` 一致，props 与分镜现在逐场景一致）。静默出错的路径有四条：B3（`DUR`）、M13（渲染期脚本出错只画进视频）、M10（圈与线偏离被夹取的角色）、M14（已装的低质量动画）。install-motion 在锚点检查失败时留下"分镜已改、props 没重建"的半成品（M5），不会自行恢复。

**Q2 失败分支能否恢复一致。** 大多能，例外见"install-motion 与 qa-fix 的失败分支"一节：install-motion 完全不恢复；qa-fix 的 qa-report.md 不回写，同场景先前保留的修复会在报告里被回退；被杀的窗口会造成分镜与结果文件不一致；旧候选会被误用。校验分支因 B2 实际不会触发。

**Q3 `new Function` 沙箱能否被绕过。** 能，见"沙箱"一节的探针结果。检查页还可以被 `</script>` 注入。

**Q4 `String.replace` 替换串含 `$` 的同类问题。** 在已应用到源码的改动里没有发现。我用脚本扫了 `scripts`、`llm-test`、`src` 下所有 `.replace`/`.replaceAll`：替换串是字面量且含 `$` 特殊序列的只有 `rich2.tsx` 里的 `"$1"`（正确的捕获组引用）；替换串是变量的 66 处几乎都在 `llm-test/patch-*.mjs`、`sub*.mjs`，其中文本含 `$$` 的只有 `patch-kit.mjs:74-76`，就是你说的那次。现行 `motion-runtime.mjs:116` 的 `new Function("tl","cue","$","$$",...)` 参数表和 `:117` 的调用都正确。本次改动涉及的源码文件里的 `.replace` 调用我逐条看过，没有第二个字符串替换串含 `$`。这是启发式扫描，无法追踪运行时才拼进替换串的变量内容。建议以后打补丁一律用函数形式 `.replace(a, () => b)`。

**Q5 文档与报告与代码或实测不符。**
- PIPELINE.md:198 写 install-motion 装"成立占比 ≥ 50% 的"，项目里 30 个已装镜头只有 5 个达标（M14）。
- PIPELINE.md:221 写"看图评审下约一半的动作成立"，实际 45/168，约 27%。
- PIPELINE.md:210 的 qa-fix 流程里有"校验"一步，该步骤永远通过（B2）。
- PIPELINE.md:212 的"b5、b6 自动重做后 high 2 → 0"来自读缓存的复检（B1）；"d12、e9 重做后评审 0 个动作成立，被拒绝并保留原画面"，保留下来的是已装入的 2/6 与 0/4 的动画，不是原来的画布；"整片 177 帧"、"6 处 high"、"i1、i9 曾各被切 67、74px"、"d5 3 次都被抓到"我在项目文件里没有找到可复核的记录（qa-report.json 已被后来的 `--scene` 运行覆盖）。
- PIPELINE.md:196 把"脚本安全"列为浏览器检查项，实际只是正则 lint（M1）。
- 没有写明：这套流程在 DPO 以外的论文上没有跑过；motion、qa 阶段没有通过 paper2video 跑完过（见 Watch for 最后一条）；评审用的是估算时间而不是真实配音时间。
- motion-report.md:3 写死"deepseek 系列写代码，文字评审与看图评审用本地网关里不同家的模型"，与实际使用的模型参数无关；motion-report.md 已过期。

**Q6 没提到但更重要的问题。** 有两个：B1（qa 复检读缓存，它决定了整个自动修复闭环是否有意义）和 B3（`DUR`）。还有 M8：`--from render` 会先触发 qa 和 qa-fix，这和你为避免重新生成动画而手动标记 motion 的意图相反。

## 复核清单（修完 B1 到 B3 后）

1. 对 `2305.18290` 删掉 `out/qa/qa_*.png` 后重跑 `qa-render`，确认 `qa-report.json` 的 high 条数与现在的 4 条一致或有合理差异。
2. 对 b8、x2、x7、h7 渲染静帧，核对收尾动作的位置。
3. 在 `projects/<新论文>` 上完整走一遍 `paper2video`（含 motion、qa），保存 `logs/`。
4. 用恶意样例（上面的探针）在浏览器里确认被拦。

</details>

<details>
<summary>File map</summary>

- `src/story/motion-runtime.mjs`（新增 `<x-person>` 展开、`face()`、`new Function` 运行脚本；M1、M11）
- `src/story/motion-code.tsx`（渲染入口，`DUR` 与错误吞掉；B3、M13）
- `src/story/free.tsx`（Actor 夹取进舞台；M10）
- `src/story/rich3.tsx`（蒙版盒子按缩放后尺寸；未发现需改的地方）
- `scripts/gen-motion.mjs`、`gen-motion-best.mjs`、`gen-motion-all.mjs`（生成与挑选候选；M6、M9）
- `scripts/motion-review.mjs`、`motion-judge-multi.mjs`、`motion-vision.mjs`、`motion-ctx.mjs`（评审；M6、M7）
- `scripts/motion-slots.mjs`、`install-motion.mjs`（安装；M5、M14、N7）
- `scripts/motion-check.mjs`（Edge 检查页；M2、N4）
- `scripts/qa-render.mjs`、`frame-qa.mjs`、`qa-fix.mjs`（质检与自动修复；B1、B2、M3、M4、N2、N3）
- `scripts/paper2video.mjs`（新增 motion、qa 阶段；M8）
- `scripts/llm.mjs`（模型白名单；M12、N5）
- `scripts/validate-project.mjs`（未改动，但被 qa-fix 依赖；B2）
- `scripts/storyboard-schema.mjs`、`free-validate.mjs`、`canvas-compile.mjs`、`check-anchors.mjs`、`gen-storyboard.mjs`（校验器与提示；N1）
- `PIPELINE.md`（M15）

完整差异：用各文件的 `.bak-*` 备份对比，例如 `git diff --no-index scripts/gen-motion.mjs.bak3 scripts/gen-motion.mjs`。

</details>
