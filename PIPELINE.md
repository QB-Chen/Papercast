# 论文 → 讲解视频 流水线

输入一个 arXiv 编号，输出一支带配音和字幕的讲解视频（中文或英文）。模型都通过本地网关 bifrost（`http://localhost:8080`）调用云端 API；渲染用本机的 Remotion + Edge + ffmpeg。

## 一条命令

```powershell
cd AI-Media-Agent-Backend\media_process\explainer-video
node scripts/paper2video.mjs 2305.18290 --minutes 10
```

跑到检查点会停下（退出码 10），打印要看的文件。看完（需要的话改一下），继续：

```powershell
node scripts/paper2video.mjs 2305.18290 --approve 1     # 确认检查点 1，往下跑到检查点 2
node scripts/paper2video.mjs 2305.18290 --approve 2
node scripts/paper2video.mjs 2305.18290 --approve 3     # 确认后开始渲染成片
```

`--auto` 跳过所有检查点；`--from <阶段>` 从某个阶段重来；`--only <阶段>` 只跑一个阶段。已完成的阶段、已生成的文件默认跳过，所以中途失败直接再跑同一条命令即可。

只支持**有 arXiv HTML 版**的论文（2023 年以后的大多数都有；先打开 `https://arxiv.org/html/<编号>` 看一眼）。

**论文来源白名单**：只做大厂的论文。名单在 `config/allowed-orgs.json`（Microsoft、Google/DeepMind、Amazon、ByteDance、Meta、OpenAI、xAI、Anthropic、Tencent、DeepSeek、Alibaba/Qwen、Zhipu、Moonshot；可以直接编辑，每家有名称正则和邮箱/网址域名）。fetch 阶段在 arXiv HTML 的作者栏文字、邮箱、摘要里的链接里找；一个都对不上就以退出码 5 停下，不下载任何东西。确实要做就加 `--force`。注意只看作者栏：arXiv HTML 没有结构化的机构字段，作者栏里没写机构的论文（比如只写了人名）会被拦下。`node scripts/org-check.mjs <编号>` 可以单独查一篇已抓取的论文。

**英文版**：`node scripts/paper2video.mjs 2609.19969 --lang en --auto`。英文版用独立的项目目录 `projects/<编号>-en/`（论文素材、旁白、配音、分镜各自一份，不影响中文版）；`plan.json` 的 `lang` 是 `en`，所有后续阶段、渲染器都读它。英文版的写法和校验见下面"多语言"一节。

## 阶段和检查点

| 阶段 | 做什么 | 模型 |
|---|---|---|
| fetch | 抓 HTML 版，整理出正文、公式（原始 LaTeX）、图（含左右子图，下载）、表 | 无 |
| plan | 拆场景，写每个场景的简报。**每条论文事实必须附论文原文摘录，脚本会在论文里逐条核对，找不到就打回** | kimi-k3 |
| **检查点 1** | 看 `CHECKPOINT-1.md`：场景拆分、每条事实的中文复述是否忠于原文、局限有没有写进最后一个场景 | |
| narration | 每个场景：**写稿**（口吻对标范例，带风格指标闸门）→ **事实审查**（对照论文逐句）‖ **风格审查**（对照范例逐句）→ 一次修订；然后做数字审计 | kimi-k3 写和改，glm-5.3 审 |
| **检查点 2** | 看 `CHECKPOINT-2.md`：数字审计、审查发现的问题、旁白全文。要改句子或读法，写 `narration/manual-fixes.json`（`text` 改字幕和配音，`speak` 只改读法） | |
| voice | 逐句配音 → ASR 回听打分 → 压缩句中停顿 → 变速 → 生成时间线 | MiMo TTS，XingChen ASR |
| boards | 先 `plan-demos` 找出旁白里要演出来的地方，再给每个场景设计分镜，通过校验才算过；展开论文素材引用 | kimi-k3（失败回退 sensenova-6.8-flash） |
| motion | OpenMotion 式动画：每个演示生成多个候选，评审后挑最好的装进分镜，写 `motion-report.md`，再生成联系图。见下文「OpenMotion 式动画」 | deepseek-flash 写代码，glm-5.3 读时间线评审，kimi-k3 看画面评审 |
| qa | 渲染后画面质检：每句抽一帧静帧，看图模型（kimi-k3）找观众一眼看得出的毛病；high 级自动重做对应演示（`qa-fix.mjs`），重新质检，没改善就保留原画面。见下文「渲染后画面质检」 | kimi-k3 看图，deepseek-flash 重写动画 |
| **检查点 3** | 看 `qa-report.md`、`motion-report.md` 和 `out/st_sheet_<场景>.jpg`：质检还剩哪些 high、动画哪些成立；数字、公式、图是否对得上旁白 | |
| render | 渲染成片，ffprobe 核对，逐句 ASR 核对成片音轨 | 无 |

## 文案风格是怎么对标的

范例是 `prompts/style-exemplar.txt`（即「讲的好的文案.txt」）。不是只把它塞进提示词，而是把它的风格量化成指标，写稿时当闸门，不达标就把差距回喂给模型重写：

| 指标 | 范例 | 闸门 |
|---|---|---|
| 平均每句字数 | 31 | ≥ 25，≤ 46 |
| 超过 25 字的句子占比 | 0.58 | ≥ 0.41 |
| 问句占比 | 0.13 | ≥ 0.07 |
| 含口语连接词（那、不过、所以说、当然了、比如说……）的句子占比 | 0.75 | ≥ 0.60 |
| 以这些词开头的句子占比 | 0.37 | ≥ 0.22 |

- 字幕按标点自动分段显示，所以句子可以写长（硬上限 100 字符）。
- 贯穿比喻是可选的，一个场景最多用一两次，不强行回扣。
- 风格审查（`scripts/review-style.mjs`）再让 glm-5.3 对照范例逐句挑毛病，并给出改写；和事实审查的意见一起交给 `revise-narration.mjs` 一次改完。
- 想看一篇稿子离范例多远：`node scripts/style-metrics.mjs 范例.txt 旁白.json`。

## 检查点里怎么改

- 检查点 1：改 `plan.json` 和 `briefs/*.md`。
- 检查点 2：写 `narration/manual-fixes.json`，格式 `{"场景id":{"句子id":{"text":"新句子","speak":"只改读法时用","reason":"原因"}}}`，然后 `--from narration --approve 2`。
- 检查点 3：直接改 `storyboards/<场景>.json`，或删掉它再 `--from boards` 让模型重做；改完 `node scripts/validate-project.mjs <编号>` 检查，`node scripts/build-props.mjs <编号>` 重建渲染输入。

## 常用小工具

| 命令 | 用途 |
|---|---|
| `node scripts/quick-shots.mjs <编号> 场景/句子+偏移帧 …` | 只渲染指定几帧拼成 `out/shots.jpg`，改完画面快速看效果 |
| `node scripts/validate-project.mjs <编号> [--fix-focus]` | 按当前规则检查所有分镜（含论文素材核对）；`--fix-focus` 自动修两类常见问题 |
| `node scripts/board-stats.mjs <编号>` | 每个场景用了哪些元素、模型几轮通过 |
| `node scripts/audit-numbers.mjs <编号>` | 旁白数字审计 |
| `node scripts/analyze-pauses.mjs <旁白.json> --dir <配音目录>` | 统计配音里的句中停顿 |

## 目录

```
projects/<编号>/
  paper/         meta.json  paper.txt  equations.json  figures.json  tables.json
  plan.json      场景规划
  briefs/*.md    每个场景给写手的简报
  narration/     <场景>.draft/review/revised/final.json  manual-fixes.json
  narration.json 合并后的全片旁白（配音输入）
  timeline.json  配音后的时间线
  storyboards/   <场景>.json
  props.json     渲染输入（时间线 + 分镜，素材引用已展开）
  out/           联系图、video.mp4
  logs/          每个阶段的日志
  state.json     进度
public/projects/<编号>/   figs/（论文原图）  audio/（配音）
```

## 画面元素（分镜里能用的）

论文素材类：`fig`（论文原图，左右子图并排，可逐步放大到某一块）、`table`（论文原表，按旁白高亮行列）、`eq`（公式栈，LaTeX 原式，来自论文源码，可高亮片段，自动缩放到装得下）。

动画和数据类：`dist`（概率分布柱）、`numberline`（数轴）、`chart`（条形/折线图，数字必须出自论文）、`diagram`（架构/流程图）、`rows`（清单加 ✓✗）、`dots`、`bars`、`grow`。

只用于 DRPO 那支视频：`leash`（遛狗绳）、`plot`（权重曲线预设）、公式库 `eqlib.json`。

静态类（只能当配角，有数量上限）：`card`、`text`、`formula`、`compare`、`flow`、`sticker`、`title`。

公式逐项讲解类：`eqx`。讲一条公式必须用它：整条公式放大居中，旁白讲到哪一项，那一项就高亮（其余变淡），下面画下划线和名字标签，再写出这一项的"为什么"。
镜头每次停留期间会缓慢推近 3%，元素出现时有弹出动画。

## 配音、语速和字幕
- **语速按句变化**（`plan-pace.mjs`，voice 阶段自动先跑，结果在 `narration/pace.json`）：讲公式某一项的句子一律 slow；其余由 glm-5.3 挑，首次出现的新概念、反直觉的结论、带数字的关键结果放慢，过渡句、玩笑、回顾略快；slow 不超过全片 40%，light 不超过 25%。想重新定就删掉 `pace.json`。
- 慢句不是简单拉长音频：先在 TTS 风格指令里加"放慢、一字一顿、重点词加重"，再用 tempo 0.95；轻快句 tempo 约 1.15；句间停顿在难点句前后各多留 0.1 到 0.2 秒。DPO 实测：难点句 3.97 字/秒，正常句 5.25，轻快句 5.69。
- **字幕按真实配音时间换段**（`align-captions.mjs`）：长句要拆成几段字幕，原先按字数比例分配时间，和配音相差中位 0.14 秒、最大 1 秒以上。现在对每句配音取 whisper（`groq/whisper-large-v3`）逐字时间戳，和字幕原文逐字对齐，每段字幕在它第一个字开口前一点点切换，结果写进 `timeline.json` 每句的 `caps`。逐字结果缓存在 `audio/fast/<id>.words.json`。
- **读音按词表**（`narration/lexicon.json`）：字幕保留原文，配音按词表读（`Bradley-Terry → 布拉德利特里`）。按词替换，不绑定句子 id。
- **人工修改必须带 `orig`**（`narration/manual-fixes.json`）：它是按句子 id 记的，旁白重写后同一个 id 可能是另一句话。组装旁白时只有 `orig` 和当前句子原文完全一致才套用，否则丢弃并告警。DPO 项目就因为没有这道检查，旧稿的读音修正套到了重写后的 `insight/i7`、`oldway/o3` 上，造成字幕和配音讲的不是同一句话。
- 排查工具：`llm-test/text-vs-audio.mjs`（字幕文字 vs 配音转写）、`llm-test/av-offset.mjs`（成片声音相对时间线的整体偏移）、`llm-test/speech-rate.mjs`（各语速类别的实际字/秒）。

## 动画手法：缓动、进场短句、接力转场
学自 [nexu-io/openmotion](https://github.com/nexu-io/openmotion)（Apache 2.0）。它的价值不在素材（模板库里 287 个全是商业发布片的拆解，没有一个讲解或学术类，且每个模板声明品牌、截图、字体仍归原作者所有），而在**动画设计思想**（`skills/openmotion-director/references/motion-craft.md`、`motion-phrases.md`）和实际代码里用的缓动。它的示例代码（`library/components/showcase/nyc-paris-flight`）每个元素用不同的缓动：标题 `expo.out`、主标题 `back.out(1.45)`、地图针 `back.out(2.8)`、巴黎针 `elastic.out`、航线 `sine.inOut`，并且按 0.08 到 0.2 秒错峰进场。我们之前全项目只有一种缓动（`Easing.out(cubic)`），没有一处用过弹簧，所有镜头同一个淡入上浮，这是"像 PPT"的原因之一。
- **缓动库**（`src/anim.ts`）：`ease.out / circ / soft / pop / bounce / spring / snap`，以及 `prog(frame, start, dur, kind)` 和 `stagger(...)`。曲线都用 `llm-test/ease-check.mjs` 数值检查过（起点 0、终点 1、过冲量）：`pop` 过冲 7.5%，`bounce` 20%，`spring` 16%。我第一版的 `spring` 过冲 40%，是凑系数凑出来的，换成了标准的衰减振荡 `1 - e^(-6x)·cos(3πx)`。
- **按元素种类选进场性格**（`StoryScene.tsx` 的 `FEEL`）：讲解主体（公式、图、表、图表、流程图、逐字输出）平滑落定、位移小；活泼的元素（角色、贴纸、卡片、对比、流程）轻微过冲。透明度仍用不超过 1 的平滑进度，位移和缩放用可以过冲的进度（`Abs` 新增 `pm`、`grow` 参数，不传时行为不变）。
- **接力转场**：原来旧镜头 8 帧淡出、新镜头 14 帧淡入，两者同时发生，会半透明叠在一起（实测：旧流程卡压在新人物上）。现在中央整屏的替换：旧镜头 6 帧内收走（先慢后快），新镜头晚 4 帧出现。代价：新镜头比旁白晚约 0.13 秒；每次替换多约 0.1 秒"空档"，是否顺眼要播放看。
- **开关**：项目里放 `motion-style.txt`，内容写 `classic` 再 `build-props`，就退回原来的统一淡入叠化。`llm-test/motion-compare.mjs` 能把同一段分别渲染两种风格并拼成左右对比视频。
- **没有学**：它的 HTML/GSAP 引擎、模板、品牌素材、着色器转场。它的"外围容器进场只是一种手段，关键动作应发生在承载意义的内容上"这一条，我们大量镜头仍是"卡片浮出、停住、被替换"，还没有解决。

## 手绘强调、逐字打出和论文条
这几样借鉴了 [Lunamos/paper2video](https://github.com/Lunamos/paper2video)（MIT）里的做法，只学了元素和手法，没有用它的流程。原则：**强调落在元素上（一圈、一个勾、一句旁注），不放大整个画面**。
- **手绘圈**（`src/story/hand.tsx` 的 `HandLoop`）：围着要强调的区域画一圈，笔画随旁白画出来，略有手抖，起笔处多画一点。已接进 `eqx`（每切换一项重新画一圈，代替原来的下划线）和 `table`（`hlSteps` 高亮某行或某列时圈住它）。`HandCheck`（两笔画出的勾）、`HandNote`（手写旁注）已写好，暂未接进任何元素。
- **书写显示**（`WipeReveal`）：内容从左到右被蒙版扫开，像被写出来。现在用在 `eqx` 的整条公式首次出现。
- **逐字打出**（新元素 `stream`）：论文里真实的模型输出样例，逐字打出，打完后关键短语依次点亮。**文字必须是论文原文**：校验器会把 `text` 规范化后去论文里逐字核对，编造的文字会被拦下（已验证：真实原文通过、编造文字被拦、`phrases` 不在文中被拦）。`gradient/g11` 用它展示表 T3 里模型退化后的真实输出。
- **论文条**（新元素 `paperbar`，放在顶部 T 位置）：一张倾斜的论文首页缩略图加标题、作者、单位、会议。**数据不让模型写**：读 `projects/<id>/paper/paperbar.json`，作者名必须人工对照论文首页核对（`meta.json` 里的 authors 字段带脚注乱码，不能直接用）。首页图由 `scripts/paper-shot.mjs <arXiv 编号>` 下载 PDF 后用 PyMuPDF（经 uv 临时安装）渲染第 1 页。DPO 项目放在 `hook/h8`（旁白第一次说"这篇论文"那句）。
- 没有学的：它的整屏标题卡（需要旁白读出论文名和单位，而我们的开场旁白没有，改旁白要重做配音）、竖屏版、背景音乐音效、暗色视觉风格。

**关于镜头缓慢推近**：它的文档说整屏缩放会让文字抖动。我们每个镜头有 3% 的缓慢推近，所以实测了：成片里一个静止文字镜头的连续 40 帧，文字重心总共平滑移动 0.55 像素，逐帧不规则位移（拟合残差）约 0.07 到 0.08 像素，不推近的对照区域为 0。这是亚像素级，没有测到抖动，所以保留推近。注意这个指标量的是文字重心，不是单个笔画边缘的闪烁。

## Lottie 动画（默认关闭）
`@remotion/lottie` 已装（4.0.542，与 remotion 同版本）。`scripts/lottie-search.mjs` 能用 LottieFiles 官方 GraphQL 接口按关键词搜公开动画，并筛掉不适合 Remotion 的（体积大、有文字层、内嵌图片、有表达式、整块背景）；`scripts/lottie-fetch.mjs` 下载选定的 10 个并逐个读其页面的授权标注（都标 Lottie Simple License）。角色小剧场里"头上冒的表情"和"手边的道具"会优先播放动画。
**默认关闭**：实测动画只占 96 像素格子里一小块、线条细、没有描边，在小尺寸下不如静态贴纸醒目，和现有贴纸风格也不统一。要启用：把 `src/story/lottie-map.full.json` 复制成 `src/story/lottie-map.json`。渲染开销：每帧约多 13%，但测量波动 35%，在噪声范围内；带 Lottie 与静态画面的两次重复渲染差异一样大（像素级噪声，PSNR 下限 73 dB），没有引入闪烁。授权方面，Lottie Simple License 要求展示、发布这些文件时带上同样的许可条款，视频里嵌入是否算"分发"条款没写清，保守做法是在视频简介里注明。

## 角色小剧场
纯文字画面容易枯燥，所以旁白里打比方、讲故事、做对比、提问的地方用 `stage`：1 到 3 个人物（职业或动作姿势图）站在台上，随旁白出场、做动作（蹦、摇、点头、变大）、说一句台词、头上冒表情、手边出现道具。
- 素材：`scripts/fetch-chars.mjs` 下载 Fluent Emoji Flat 的 22 个职业角色和 31 个动作姿势到 `public/chars/`，清单在 `src/story/chars.json`（和贴图同一来源，MIT）。
- 校验：台词不超过 18 字，不含数字、数量、英文和符号（台词只演比喻，数字和结论由旁白讲）；角色、表情、道具必须在清单里；演员不能同位置；动作按旁白先后排列。项目模式下，7 句以上的场景必须有 `stage`，纯文字镜头（text、card、formula、compare、flow）不得超过 40%。
- 公式的每一项也配一个角色（`plan-actors.mjs`，plan 阶段自动跑）：讲到这一项时，下方出现与比喻对应的角色，"为什么"变成对话气泡。

## 公式是怎么逐项讲的
1. `plan-formulas.mjs`（plan 阶段自动跑）把每个场景最多 2 条重点公式拆成 3 到 6 项。每项的 `tex` 必须是公式 LaTeX 里的原文片段，按出现顺序、互不重叠、KaTeX 能渲染；并附 `name`、`say`（旁白里讲到这项会说的词）、`role`（作用）、`why`（为什么）和论文原文 `quote`。结果写进 `plan.json` 的 `formulas`，也写进简报的"必须逐项讲解的公式"一节。
2. 写旁白时（`gen-narration.mjs`）检查：每一项都必须在自己的句子里讲到（含 `say` 里的词），并且顺序不能乱。`say` 里的词要足够具体，太泛的词会提前匹配到别处。
3. 分镜里模型只写 `{"kind":"eqx","slot":"C","eq":"eq4","at":"…"}`；每一项在哪一句高亮由 `syncEqx()` 按旁白里的 `say` 词自动算出，提示里会把应放的 `at` 和占用的句子范围直接告诉模型。校验器要求场景里每条公式各有一个 eqx。
4. 论文原式里的 `\underbrace{…}_{英文注释}` 渲染前会被去掉，避免英文注释盖住中文标签。
5. 名字（`name`）里不要带英文字母，否则写稿模型会照抄，被"不允许英文"的检查拦下。
6. 带公式的场景句数会变多，成片比无公式时长；`plan` 里的句数范围要给够（每项一句，再加开头总述和结尾）。

**防编造的做法**：公式、图、表只能按 id 引用论文里的原件；`chart` 和 `numberline` 里的数字，校验器会去论文里核对；旁白里的数字做审计；`fig` 只有在图注里提到左右/上下/分图时才允许放大到某一块；`plot`/`numberline` 的圆点位置要对应旁白里讲过的数。

## 画布（canvas）：同一块画布上长出来、动起来

目标：让画面像动画而不是幻灯片。一块画布（1600×520 的逻辑坐标）上，图形原件随旁白一个个长出来、移动、被圈住、被清走，而不是整块卡片换来换去。原件：dot 点、box 方块、vec 向量格、axis 坐标轴、arrow 箭头、text 文字、ring 手绘圈、brace 大括号。任何原件都可以带 moves，在指定时刻移到新位置。

时间锚点（at / until / moves[].at）：`d11` 句首；`d11+30` 句首后 30 帧；`d11#1` 第 2 段字幕起点；`d11@拉大` 这个短语开口的时刻（在字幕段内按字数插值，误差约 ±0.3 秒）。

- 字段在 `Beat.cv`（不是 items，那个被 bars 占了）；`schematic:false` 可去掉"示意图"角标。
- 校验：`storyboard-schema.mjs` 的 canvas 分支（原件类型、id 唯一、锚点必须在句子原文里、坐标在画布内、文字 ≤12 字且不含数字/英文；示意图不承载数字）。反例测试：`node llm-test/canvas-validate-test.mjs`。
- 几何检查：`node scripts/check-canvas.mjs <id> [场景]` 按真实配音时间每 3 帧采样，报告持续重叠和出画布（缓动与字宽是近似，只当预警）。自测：`node llm-test/canvas-check-selftest.mjs`。
- 看短片：`node llm-test/clip.mjs <id> <场景> <起始句> <结束句> [名字]` → `projects/<id>/out/<名字>.mp4`（带声，画面用当前 props，声音取自成片同一段）。
- **模型怎么生成**：模型不写坐标，只写“画布说明”：`form`（`line` 一把尺子，点会移动；`row` 一排方块依次长出来）、`things`（东西、相对位置 pos 0~100、出现和移动的时刻）、`marks`（括号、圈、箭头、结论小块、小标题）。`scripts/canvas-compile.mjs` 把它算成坐标写进 `cv`；说明书在 `scripts/canvas-doc.mjs`，已接入 `buildElementDoc`。
- 编译器排不下就返回能照着改的原因，由 `chatJson` 的校验重试反馈给模型：尺子上两点太近、标签上下都放不开、括号标了会移动的东西、圈会切到别的东西、row 的出现顺序倒了、锚点短语不在原文、第一个东西出现太晚（会留一整屏空白）。
- boards 阶段结束后自动跑 `check-canvas.mjs`，有重叠、圈切到别的东西或出界会提示（不阻断）。
- 验证过：用 `sensenova/kimi-k3` 对 dpoloss 实际生成，2~5 轮通过校验，几何检查无预警，已看过渲染静帧。测试：`node llm-test/canvas-compile-test.mjs`（13 个正反例）。临时把某个分镜换进去看静帧：`node llm-test/canvas-compiled-shots.mjs <llm-test/cc 下的名字>`。
- 手写示例 `llm-test/add-canvas-dpoloss.mjs` 只是第一版的参照，**正式流程不手写**。
- **版式共 4 种 + 自由动画**：`line`（尺子上的点移动）、`row`（流水线，可加 token 数据包）、`bars`（柱子涨落）、`tree`（一生多 / 多合一），以及 `form:"free"`（见下）。箭头带流动的小点；旁白说到某个东西的名字，它会弹一下（`point` 标记可指定时刻）。
- **覆盖率规则**（`storyboard-schema.mjs`）：静态镜头（card、compare、flow、sticker、formula、text）覆盖的句子不超过 30%；非公式、非论文图表的场景，画布覆盖不少于 25%；有 eqx 的场景必须至少有一个 canvas 演示这条公式在做什么；画布存续期间两次变化之间不能超过 6.5 秒（按旁白字数估算）；line/row/tree 至少 3 个东西，bars 至少一根柱子涨落。

### 自由动画（canvas 的 `form:"free"`）

不限于预设版式：模型自己搭对象（shape 图形、text 文字、line 连线、bars 柱子组、curve 函数曲线、ring 手绘圈、brace 括号），每个对象用关键帧 `keys` 在旁白的某个时刻平滑变化（位置、大小、透明度、缩放、旋转、柱子数值、曲线参数）。位置用 0~100 百分比，尺寸用画布像素。渲染在 `src/story/free.tsx`。

- **函数曲线**用 `src/story/expr.ts` 的安全表达式解析（只认数字、变量、`+ - * / ^`、括号、`exp log sqrt abs sin cos tanh sig min max pow` 和 `pi`，不 eval，`constructor` 之类原型属性不可用）。测试：`node llm-test/expr-test.mjs`。
- **校验**（`scripts/free-validate.mjs`）：字段与取值范围；时间锚点（短语必须在原文里）；**画面上的字母、希腊字母、函数名必须出自论文公式**，不能出现数字；表达式合法且变量有初值；连线、圈、括号引用的对象必须已出现；按 0.4 秒采样检查部分重叠、伸出画布、圈压住别的对象、连线两端太近、柱子或曲线画太小；画面不能停住。测试：`node llm-test/free-test.mjs`（20 个正反例）。
- 错误信息是中文，由 `chatJson` 的校验重试原样反馈给模型。
- 看模型搭了什么：`node llm-test/show-free.mjs <分镜文件>`；把某份分镜临时换进去渲染静帧：`node llm-test/canvas-compiled-shots.mjs <场景> <分镜文件>`。
- 已验证：模型（sensenova/kimi-k3）为 DPO 的 oldway、insight 自己搭了公式演示（两个得分经 exp 放大变成柱子比例；概率被乘上指数加成再除以配分函数归一化），已看过渲染静帧。
- 局限：模型不能写任意代码，只能用上面这些对象和关键帧；表达式只能是单变量曲线；没有图片、粒子、3D；对象位置靠模型估算，由校验器兜底，不保证好看。

### 旁白里的举例、比喻、动作必须演出来

问题：旁白说「厨师把菜端给客人，客人尝了一口」，画面却只有两个人站着说话，或者只有公式高亮。解决分四步，全部由模型自动完成：

1. **找出来**：`node scripts/plan-demos.mjs <id>` 让模型通读每个场景的旁白，列出所有举例、比喻、一连串动作、机制讲解，写到 `narration/demos.json`。每一处有句子范围、类型（example/analogy/process/mechanism）、要出场的角色、道具、按时间的「画面事件」（每条锚在旁白原文的连续几个字上）。
2. **演出来**：自由动画新增 `char`（角色：53 种造型，可走动、换姿势、冒表情、说话气泡、蹦/摇头/点头）和 `icon`（道具：184 种食物、物品、符号、表情，可以在角色之间移动、变大变小、淡出）。素材来自 Fluent Emoji Flat（MIT），`node scripts/fetch-props.mjs` 下载，清单在 `src/story/props.json`、`chars.json`。
3. **公式场景也要演**：`eqx` 新增 `insets`：[{from,to,objs}]，那几句里公式缩到上方（高亮、圈、标签照常），下方换成自由动画，演完恢复。演示区逻辑尺寸 1600×300。
4. **卡住**：校验器按 `demos.json` 检查，每一处必须有动画镜头覆盖（canvas、stage，或 eqx 的 insets；论文原图原表数据图本身算演示）、事件数够、有人物的必须有角色出场；`gen-storyboard` 会把清单作为必须演出的片段放进提示。

**审计和评审**：`node scripts/audit-demos.mjs <id> [--board-dir …]` 结构性审计（有没有镜头、事件够不够、有没有人物）。`node scripts/judge-demos.mjs <id> [--board-dir …]` 把动画翻译成按时间的事件清单，连同旁白交给另一个模型评审，旁白里的每个动作和反应是否有对应画面，缺了什么，写到 `narration/demo-judge.json`。`node scripts/improve-demos.mjs <id> --rounds 3` 把评审意见喂回去重做，最多 3 轮，每个场景保留得分最高的一版。

测试：`node llm-test/free-test.mjs`（自由动画）、`node llm-test/eqx-inset-test.mjs`（eqx 插入演示）、`node llm-test/canvas-compile-test.mjs`、`node llm-test/expr-test.mjs`。
- 场景里有 canvas 也算满足"每个 ≥7 句的场景至少一个 stage/canvas"。
## OpenMotion 式动画（`motion` 阶段）
用的是 OpenMotion 的方法（动作脚本 → 真代码 → 看实际输出再改），不是它的程序：渲染仍是 Remotion，运行时是 `src/story/motion-runtime.mjs`。动画是分镜里的 `canvas` 镜头，`form:"motion"`，`motion:{html,css,script}`：HTML+CSS 摆舞台，GSAP 暂停时间线由渲染器逐帧 seek（不用定时器、不能 `.play()`、不能无限循环、不能联网）。**素材不设限**：① 角色组件 `<x-person role="cook" face="smirk" style="left:140px;top:140px" width="230">`（8 种角色 cook/judge/scientist/student/teacher/programmer/guest/worker，6 种表情 neutral/happy/sad/surprised/worry/smirk，部件 `.head .body .arm-l .arm-r .leg-l .leg-r` 可单独做动画，脚本里用 `face("#id","sad",时间)` 切表情，定义在 `src/story/motion-runtime.mjs` 的 `personSvg`）；② 模型自己画内联 SVG 道具；③ 现成 emoji 小图标 `props/*.svg`（可选）。OpenMotion 仓库本身没有人物/图标素材库（`library/` 是模板、品牌包、动效组件源码），它的做法就是原生 HTML/SVG/CSS/GSAP 自己画，我们照此办理。锚点写成 `cue("句子id@原话")`。
**一个演示怎么做**（`node scripts/gen-motion-best.mjs <id>`，全部是本地网关模型，不需要人盯）：
1. 导演（`gen-motion.mjs`）写动作脚本：意图、舞台、至少 4 个动作，每个动作锚在旁白原话上。
2. 动画师写代码，**真浏览器（Edge 无头）检查**，不通过就把中文错误喂回去重写，最多 8 轮。检查项：脚本安全、选择器匹配、cue 能解析、元素出界、重叠（`data-hold` 可豁免拿在手里的道具）、画面停住 >5.5 秒、时间线够长、旁白动作那一刻画面有变化、文字大小和内容（不含数字、英文）、人物 ≥150px、道具 ≥70px、内容铺满舞台、同一角色不换姿势图（不同图是不同的人）。
3. 生成 N 个候选（`--candidates`，流水线默认 1，脚本默认 3）。每个候选评审：`motion-review.mjs` = 文字评审（`glm-5.3` 读浏览器测出的时间线）+ 看图评审（`kimi-k3` 看每个动作时刻的截图，`motion-vision.mjs`）。**每个动作只要一边说需修改就是需修改，两边都认可才是成立**。已有版本也参加比较，选成立动作占比最高的。已有版本占比 ≥ `--target`（默认 0.6）就不重新生成。
4. `install-motion.mjs` 把成立占比 ≥ `--min-ratio`（默认 0.5）的装进分镜。**这个项目里实际装的 30 个动画是手动用 `--min-ratio 0` 全部装的，其中 25 个低于 50%、6 个一个动作都不成立**（用户要求动画多，且抽样对比旧画面后判断旧画面不更好；评审的"成立数"衡量的是动作变化，不是画面好坏）。装完后的锚点检查、分镜校验、build-props 任何一步失败，都会恢复备份分镜并重建 props（先备份 `storyboards-before-motion-*`），`motion-slots.mjs` 决定哪些镜头能换（公式、论文图镜头不换；动画演完后下一个镜头离得太远会定格也不换），跑 `check-anchors`、重建 props，写 `motion-report.md`。没装的演示保留分镜阶段按演示清单放的自由动画画布。
**反复重写不收敛，多候选收益也不明显**：把评审意见喂回去重写（h2：0/6 → 1/6 → 1/6，文字评审分 68 → 58 → 48）；每个演示生成 3 个候选再挑最好，在 hook 的 4 个演示上也没有稳定变好（h2 已有 2/5、候选 1/5、2/6、1/4；h6 四个版本都是 0），所以流水线默认只生成 1 个。评审本身有波动（同一个版本 h2 两次评审分别是 3/5 和 2/5），看图评审只看每个动作后 0.3 秒和 1.2 秒两个时间点，判断会偏严，不要把"成立占比 ≥50%"当成精确的合格线。
**评审是 AI 评的，不是人看过**：评审结论只用 成立/需修改/未验证 加证据，不用分数当合格线。看图评审会看错（例如把头顶表情说成"悬浮的第二颗头"）。**动作是否顺滑、声音是否同步、实际播放效果，没有任何模型或工具验证过**，报告里写明"未验证"，检查点 3 要人看。
**模型与预算**：只用 `sensenova/*`，另允许 `nvidia-nim/z-ai/glm-5.3-flash`（`scripts/llm.mjs` 的 `chat()` 有白名单，其他模型直接报错；临时放开设环境变量 `ALLOW_ANY_MODEL=1`）。网关接受 `max_tokens` 到 120000，动画师 100000、导演和评审 40000。写代码用 deepseek-flash；glm-5.3-flash 做导演可以，但动画师 20 分钟过不了浏览器检查，而且一个字的回复也要 45 秒；图像生成：`sensenova-u1.5-fast` 现在可以走 `/v1/images/generations`（6 到 14 秒一张，扁平风，画风比 emoji 和模型自画 SVG 好），但输出是不透明的白底 RGB，右下角带「日日新 SensNova」水印，接口没有关水印的参数，所以**决定不用**（测试脚本 `llm-test/img-gen-test.mjs`）。**踩过的坑**：deepseek-flash 的思考会吃掉输出预算（`max_tokens` 14000 时一整轮只在思考、正文为空）；`xstack` 至少 2 帧（预览单帧会失败）；`llm-test/canvas-compiled-shots.mjs` 超时被杀会把临时分镜留在项目里（`finally` 没跑），之后要核对分镜是否被换。GSAP 3.15 的 MotionPath/DrawSVG/MorphSVG 插件自 3.13 起免费，商用请自行确认当前许可。
**常用命令**：`node scripts/gen-motion.mjs <id> <场景> <起始句>` 单个演示；`node scripts/gen-motion-best.mjs <id> --only hook/h2,out/u4 --list`；`node scripts/install-motion.mjs <id> --dry`；`node llm-test/vision-all.mjs` 对已有结果重跑看图评审；`node llm-test/motion-check-test.mjs` 检查器的 18 个用例。模型参数：`--motion-model`、`--motion-judge-model`、`--motion-vision-model`、`--motion-candidates`、`--motion-parallel`、`--motion-target`。

## 渲染后画面质检（`qa` 阶段）
**为什么要有**：校验器只检查分镜数据的格式，不看真实画面。实际出过的毛病校验器都没拦住：带文字的标签旋转 180° 后文字倒着停在画面上（dpoloss d5）、前面讲别的东西用的贴图一直不退场、公式被画面边缘裁掉。这些每换一篇论文都可能再出现，所以不能靠人一个个看，也不能每出一个毛病就补一条规则。
**怎么做**（`node scripts/qa-render.mjs <id>`，全部是本地网关模型）：
1. 每句话开口后约 1.7 秒抽一帧（长句再抽一帧），一次打包渲染成静帧，每 6 帧一组连同当时字幕交给 `kimi-k3`（`frame-qa.mjs`）。
2. 只找"观众一眼看得出的通用毛病"，类型固定：`text_flipped`（文字倒置、镜像）、`leftover`（和当前字幕无关的贴图残留）、`overlap`（互相盖住）、`too_small`、`clutter`、`empty`（空白）、`off_topic`、`other`（含公式被裁）。严重程度 high（观众会看错或看不懂）/ low（只是不好看，常有误报）。
3. 写 `qa-report.json` 和 `qa-report.md`。**只有 high 触发自动处理，low 只留在报告里**。
4. high 的自动处理 `node scripts/qa-fix.mjs <id>`：按毛病所在句子找到 `demos.json` 里的演示 → 用 `gen-motion` 只重做这一个演示（质检意见通过 `--notes` 告诉导演和动画师）→ 评审 → 装进分镜 → 校验 → 重新质检该场景。**保留新版的条件**：新版评审至少有一个动作成立，且该场景的 high 数必须变少；否则恢复原分镜。不重做整张分镜（实测整张重做过不了校验，旧 JSON 动画一重写就有重叠和没演到位）。`gen-storyboard.mjs` 也会读 `qa-report.json`，下次从 boards 重做时带着这些毛病作为"别再犯"的提醒。
5. 没有对应演示的毛病（公式被裁、公式讲解里的空白）不乱动，只写进报告，由检查点 3 的人处理。
**这套 motion、qa 阶段没有通过 paper2video 从头跑通过**（各步骤是分别手动跑过的），审查已发现若干会让自动链静默出错的问题（见 `REVIEW-2026-11-motion-qa.md`，阻断 3 条，修完前不要当"无需人盯"用）。**验证过的**：修复前的 d5（"最小化"标签倒着）3 次都被抓到，修复后的画面不再报文字倒置；整片 177 帧质检发现 6 处 high（公式被裁、两处空白、b5 b6 内容未出现、一个看不懂的小元素）。**自动修复这一环没有被可靠验证**：子 agent 审查（`REVIEW-2026-11-motion-qa.md`）发现复检读的是复用的旧静帧（`qa-render` 看到已有 PNG 就不重渲染）、分镜校验步骤从不拦截（`validate-project` 永远退出 0），所以曾经报告的"b5、b6 重做后 high 2 → 0"不可信，应视为未验证。d12、e9 重做后评审 0 个动作成立，被拒绝并保留原画面这一点是可信的。**运行时兜底**：`free.tsx` 的 Actor 把角色整体（含头顶气泡/表情、脚下标签）夹在舞台里，防止标签被字幕条挡住；`rich3.tsx` 的公式蒙版盒子随缩放后的大小走，防止放大的公式两端被切（实测 i1、i9 曾各被切 67、74px）。生成分镜时（`gen-storyboard`）校验器会额外要求角色整个留在舞台里（`ctx.strictLayout`），`validate-project` 对已有分镜不启用这条。
**局限**：只看静帧，动作是否顺滑、声音是否同步没有验证；质检模型会误报（b5、b6 有一部分是抽帧时动画还没演到）；"一个标签旋转"这类具体毛病也加了校验规则（`free-validate.mjs`：带字元素旋转不能超过 45°），但画面质检才是通用的兜底。
**退出码约定**：`validate-project.mjs` 有任何问题退出 1（以前永远 0）；`qa-render.mjs` 0 = 全部检查完且无 high，3 = 有 high，4 = 有质检调用没跑成（结果不完整，不能当"通过"）。静帧缓存放在 `out/qa/<props 指纹>/`，分镜改动、props 重建后不会读到旧图。**`--from render` 注意**：`state.done` 里没有 `qa` 的老项目，主循环会先跑 `qa` 和 `qa-fix`，可能改写分镜；要只渲染，请直接用 `render-retry.ps1`，或先手动跑一次 `qa-render.mjs` 确认。
**已知未修**（见 `REVIEW-2026-11-motion-qa.md`）：渲染期 motion 脚本报错时错误文字画进视频但渲染仍以 0 退出（渲染前用 `llm-test/probe-errtext.mjs` 抽帧自检）；`checkScript` 等静态检查能被绕过，模型输出是不可信输入；看图评审只取前 12 帧，动作数 ≥ 6 的演示后面的动作没被看到；`DUR` 在检查时是旁白时长、渲染时是到场景结束的时长；`llm.mjs` 的模型白名单不覆盖流式调用。

## 自动改进（`auto-improve`）
`node scripts/auto-improve.mjs <id> [--rounds 2] [--concurrency 3] [--only scene/from,…]`，已接进 `paper2video` 的 `qa` 阶段，不需要人盯，任何论文都走同一套（演示清单来自 `demos.json`）：
1. **检测**（`demo-qa.mjs`）：对每个演示用**当前 props 现渲染**的 3 帧（按 props 指纹分目录，不读旧图），让看图模型对照旁白和导演的 `key` 判断成立 / 需修改，并给毛病类型（blank_start、empty、static、half_acted、too_small、overlap、hidden、off_topic）。
2. **修复**：按毛病类型把具体要求写进 `--notes`，用 `gen-motion` 只重做这一个演示（导演和动画师都看得到）；评审（浏览器检查 + 文字评审 + 看图评审）至少一个动作成立才继续。
3. **复测**：装进分镜（整块画布替换镜头，公式场景写进 eqx 的 `insets`，舞台 1600×520 或 1600×300 由位置决定）→ 锚点检查 → 分镜校验 → build-props → 重新渲染这几帧复测。**修之前和修之后用同一份 `key` 去检测**（旧画面可能是别的标准生成的，不能用它自己的标准比），变好才保留，否则恢复这一个演示的分镜。
4. 生成和评审并行（`--concurrency`），装入和复测用互斥锁串行。出报告 `auto-improve-report.md / .json`。退出码 0 = 全成立，3 = 仍有需修改，4 = 检测调用没跑成。
**这个项目上的一次完整运行**（2305.18290，71 个演示）：起始成立 24、需修改 47；处理 47 个：28 个改善并保留、11 个复测没变好被恢复、6 个没改（生成没通过浏览器检查或评审里没有动作成立）、2 个不能换（论文原表原图）；结束成立 34、需修改 37（其中不少已变好但仍有 half_acted）。我对 h8、o14、i5、d5 四个演示在成片里的前后帧逐一看过，画面确实更完整。**局限**：检测和复测都是 AI 看静帧，动作是否顺滑、声音是否同步没有验证；评审偏严且有波动；只在这一篇论文上跑过；运动占比几乎没变（r2 26% → r3 28%），改变的是"关键变化有没有演出来"，不是动得更多。踩过的坑：检测标准不统一曾让自动循环 0 个改善（几处评审各用各的标准，剧本细节、规划事件、关键变化互相矛盾），统一成同一份 key 之后同样 5 个演示 4 个变好。

## 动作积木与多语言
**动作积木**（`src/story/motion-runtime.mjs` 的 `makeLib`，OpenMotion 的 motion-phrases 思路，**默认关闭，见下**）：脚本里直接调用一句话完成一个常见动作，不用自己算坐标、不用手写连接线。`moveTo`（弧线移动）、`link`（两元素间连线：line / chain / dashed / spring，跟着两端元素走）、`stamp`（徽章：check / cross / star / question…）、`say`（气泡，不出舞台）、`setText`（换标签文字）、`splitInto`（切成几份）、`appear` / `vanish` / `grow` / `pulse` / `shake` / `nod` / `wave`。**积木本身不含任何文字**，文字由调用方按视频语言传入，所以中英文通用。连线画在元素下层，徽章和气泡在上层；这些覆盖层带 `data-hold`，检查器不把它们当成"元素重叠"。实现里踩过的坑：GSAP 的 `fromTo` 作用在普通对象上时，只补间"结束值里出现的属性"，且 `immediateRender:false` 时 from 值不会写入，所以连线透明度的初始值必须直接写成 1；`moveTo` 必须是真正的补间（用函数取值，起点终点在补间开始那一刻按真实位置算），否则会和脚本里别处的 `tl.to` 打架、连线读到的位置也滞后。
**导演的 `key`**：导演每个动作要写一个 `key`（观众必须看到的那一个可见的"从 A 到 B"），`change` 里的细节只是参考。文字评审和看图评审都只核对 `key`。原因：评审拿剧本里的每个细节（"脚下有滑痕""链条一环环被卷入"）去挑，静帧很难满足，会把"主要意思已演出来"也判成没演出来。导演写 3 到 5 个动作，不要面面俱到。**积木说明默认不放进动画师提示词**（设 `MOTION_BLOCKS=1` 才带；积木函数本身在运行时一直可用）。依据（同一个模型 deepseek-flash、同样 5 个最难的演示、同一套按 `key` 的评审，各跑两次）：带积木说明 25%、33%，不带 65%、58%；我看 h8、d5 的画面，带积木版的核心变化没演出来（h8 的旧流程面板始终没被取代，d5 最后一帧还停在"最大化"），不带的完整。原因没有验证过（猜测是积木说明把模型引向装饰性小动作）。注意这个实验里同时变了两件事（评审只看 key、导演少而精），所以"不带积木的分数比以前高"不能全算积木的功劳；也别把"积木没用"当成定论，只是在这批演示、这个模型上没有帮助。
**时间用真实时间线**：`motion-ctx.mjs` 的 `realCue` 与渲染器 `cueAt` 同一套规则（按 `timeline.json` 里的 local / dur / onset / caps 算），演示时长也取真实值；不再按"每秒 5 个字"估算，所以任何语言都准。生成、评审、渲染三处共用同一份。
**多语言**：`--lang zh|en`（缺省 zh）。英文版用独立项目 `projects/<编号>-en/`；`plan.json` 的 `lang`、`narration.json` 的 `lang`、`timeline.json` 的 `lang`、`props.json` 的 `lang` 一路传下去，脚本用 `scripts/lang.mjs` 的 `langOf(项目)`（环境变量 `VIDEO_LANG` 优先）读取。设定集中在 `scripts/lang-pack.mjs`（音色、配音风格、语速提示、字幕每行上限、画面文字上限换算系数）。
- 规划：`plan-scenes` / `plan-formulas` / `plan-demos` 在提示词末尾追加"语言：英文版"一节（title、tag、facts、说出词、画面事件全部英文），字数上限按字符数放宽（系数 2.4~2.6）。每句耗时估算：中文 10.3 秒/句（实测 116 句 → 19.9 分钟、121 句 → 20.8 分钟），英文 8.5 秒/句（只是估计，没有英文完整成片的实测）。
- 旁白：`gen-narration` 英文分支（`prompts/style-exemplar-en.txt` 是我自己写的英文口播范例，不是用户给的；指标是词数、长句占比、问句占比、口语词占比、开场词占比，见 `style-metrics.mjs` 的 `metricsOfEn`）；每场景只有 3~5 句时只查平均句长。`review-narration`（事实）、`review-style`、`revise-narration` 都有英文分支；`audit-numbers` 认阿拉伯数字、`16B`/`45T`、英文数词。
- 配音：MiMo TTS 的音色 `Mia`（试了 Mia、Chloe、Milo、Dean 和中文音色，听写回读都基本通顺（cache 都被听成 cash），没有明显差别，选了英文女声 Mia；**没有人听过音色是否自然**）；回听打分去掉数字和数词再比（`normEn`）；缩写拆字母读（`speakify(text, "en")`）。对齐用 whisper 英文，字幕按词切分（`src/story/i18n.ts` 的 `splitCaptionLang`，渲染器和 `align-captions.mjs` 共用，每段 ≤52 字符）。
- 画面：渲染器固定文字（"Illustration"、"Why: "、"Part 1 of 5"、"Step n"）在 `src/story/i18n.ts`，`StoryVideoView` 收到 `lang` 后设置。分镜校验 `storyboard-schema.mjs` / `free-validate.mjs` / `canvas-compile.mjs` 按 `ctx.lang` 切换：英文字数上限放宽、不再要求字母来自公式、禁止中文、画面文字里禁止 LaTeX 记号（`_ { } \ ^`，否则会原样显示）。动画检查器、导演和动画师提示词早先已经按 `lang` 切换。
- **没有验证**：英文版的整片观感、配音自然度、字幕和声音是否对得上（只量过偏移）、英文版 10 分钟目标的实际成片时长。
**分镜校验的软/硬分级**（`scripts/error-classes.mjs`）：画面够不够动、演示有没有演全、同类元素重复、元素重叠属于"质量类"；锚点不存在、字段缺失、出界、文字规则属于"结构类"。`gen-storyboard` 轮数用完后只剩质量类就接受最好的一版（写 `storyboards/<场景>.warnings.json`），结构类仍然失败并换下一个模型（kimi-k3 → 6.8-flash → deepseek-flash）；`validate-project` 只有结构类问题才返回失败，质量类列为警告。这是因为英文小版本的 10 个场景里有 4 个因为质量类规则两个模型都没通过，整个分镜阶段失败（见下"新论文暴露的缺陷"）。
**新论文（DeepSeek-V4.1-Flash 技术报告）暴露并修掉的缺陷**（都是流水线对"没见过的论文"不够稳，不是这篇论文的特例）：①简报要求"必须出现"含多个英文单词的名字（Hierarchical Sparse Indexer）或含阿拉伯数字的词（890 字节），而中文旁白规则禁止，永远通不过 → 写稿时自动放宽、规划时就禁止；②公式分项的"说出词"里带英文和函数记号（`C max`、`k(b)`），旁白里说不出来 → 规划时校验，`plan-formulas --fix-say` 修已有计划；③旁白句数偏离目标变成硬错误 → 改成软目标（超过两倍才失败）；④中文旁白里混入论文里的英文模式名（Full）→ 改成软提示；⑤一个场景有多条公式时，第二条公式的说出词匹配到第一条的讲解范围里，两个 eqx 时间段重叠 → `syncEqx` 按先后顺序处理；⑥有公式讲解的场景要求"至少 6 个镜头"几乎无解 → 3 个；⑦事实审查只看论文前 6 万字，这篇有 13 万字 → 10 万；⑧`plan-scenes` 只给模型前 7 万字 → 12 万；⑨一个场景写稿失败时整个阶段立刻退出、留下孤儿进程 → 全部跑完再统一报错；⑩每句耗时估算 7 秒与实测 10.3 秒不符，"10 分钟"一直做成约 20 分钟 → 按实测；⑪分镜 bestEffort 选"最好的一版"时，只有 1 条错误"beats 至少 N 个"的版本（模型第一版什么都没设计）看起来错误最少，被选中 → 给这类错误最大权重；⑫最后一句上有别的镜头顶掉公式讲解的收尾，属于质量类 → 归入软错误；⑬英文版：画面文字里出现 LaTeX 源码（`C_{l}`）会原样显示 → 校验里禁止。
**时长仍然不准**：公式场景会按"每条公式项数 + 2"追加句数，模型写的句子又偏长。这篇做出来：中文 82 句、52 字/句、11.3 秒/句，成片 16.1 分钟；英文 89 句、28 词/句、12.3 秒/句，成片约 19 分钟（目标都是 10）。已把平均句长闸门收紧（中文 ≤ 1.25 倍范例即 39 字，英文 ≤ 1.5 倍即约 20 词）并把估算改成 9.5 秒/句，**收紧后的闸门没有用完整论文跑过**，效果未验证。`--minutes` 是目标不是保证。

## 已知限制

- 模型看不到图的内容，`fig` 放大哪一块只能按图注和旁白猜，检查点 3 要人看。
- 贯穿比喻是模型想的，只能用 Fluent Emoji 贴图（105 个）表现，没有 DRPO 视频里那种专门做的遛狗动画。
- 只有人看过检查点，才能保证最终内容对；脚本能拦的是"编数字、编引用、图表数字对不上、元素重复"这类，拦不住"解释得不够准确"。
- 英文人名和带连字符的模型名（Bradley-Terry、GPT-4）TTS 读法不稳，要在 `manual-fixes.json` 里写 `speak`。
- 动画是模型生成、模型评审的，质量参差。已装的 30 个动画里，文字评审和看图评审两边都认可的动作合计 45/168（约 27%），25 个低于 50%，6 个一个都不成立；只看"看图一边"时第一批约 51%。，人物偏小、少数动作缺失；没有任何环节验证过播放时的顺滑度和声音同步。
- `motion` 阶段耗时：每个演示约 30 到 40 分钟（含评审），全片几个小时。
- 渲染 10 分钟的片子约 50 分钟（1440×810，本机内存紧张时更慢）。
