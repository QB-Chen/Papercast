// 给模型看的 canvas 说明书（接在 storyboard-schema.mjs 的元素说明书后面）
export const CANVAS_DOC = `
24. canvas（画布）：**旁白在讲"某个量被推高/拉开/压低""相对某个基准的变化""一层一层叠起来的过程"时用它，代替卡片和大字。** 同一块画布上，东西随旁白一个个长出来、移动，再被括号、圈、箭头标出来。观众看到的是"画面在变"，不是"换了一张图"。**你不写坐标**，只写有哪些东西、什么时候出现和移动、标什么，程序会排版；排不下会把原因告诉你，照着改。
   **能演示的内容就演示，不要转述成文字或卡片。**画面要一直有东西在动：点在移动、柱子在涨落、数据包在流动、东西在分叉或汇合。
   版式 form 有四种：
   **line、row、tree 至少 3 个东西，bars 至少 2 个。**
   · "line"（一把尺子，东西是尺子上的点，会移动）。适合：对比两个量并随旁白拉开或缩小、相对基准的变化、某个量涨了或降了。
   {"kind":"canvas","slot":"C","at":"d11","form":"line","things":[{"id":"base","label":"基准","tone":"gray","at":"d11","pos":10},{"id":"bad","label":"差的","tone":"pink","at":"d11@差的","pos":28,"moves":[{"at":"d12@压低","pos":22,"arrow":true}]},{"id":"good","label":"好的","tone":"teal","at":"d11@好的","pos":42,"moves":[{"at":"d12@拉开","pos":78,"arrow":true}]}],"marks":[{"type":"brace","from":"bad","to":"good","text":"差距小","at":"d11#1","until":"d12@拉开","tone":"orange"},{"type":"ring","who":"base","at":"d13@基准","tone":"gray"}]}
     - things：2 到 6 个。id 用英文小写字母；label 不超过 8 字、**不含数字**；tone 取 teal/orange/pink/navy/gray/green；at 是出现的时刻；pos 是尺子上的相对位置 0 到 100（越大越靠右，只表示相对大小，不显示数字）。同时在场的两个东西 pos 至少差 8。
     - moves：到那一刻，这个东西移到新的 pos（弹簧式滑过去）；arrow:true 会画一支"推"的箭头（移动的 pos 差不到 11 时画不下，只让点滑过去）。
   · "row"（一排方块，依次长出来，相邻的自动用箭头连起来）。适合：流水线、层层叠加、先后步骤、一个东西由几部分组成。things 按从左到右的顺序写，出现时间也必须依次变晚；不需要 pos 和 moves。
   {"kind":"canvas","slot":"C","at":"e3","form":"row","things":[{"id":"a","label":"输入","at":"e3","tone":"navy"},{"id":"b","label":"编码层","at":"e4@编码层","tone":"teal"},{"id":"c","label":"输出","at":"e5","tone":"orange"}],"marks":[{"type":"brace","from":"a","to":"b","text":"一起算","at":"e6"},{"type":"note","text":"一步到位","at":"e7"}]}
   · "bars"（一排柱子，高度 pos 0 到 100，moves 让柱子随旁白涨落，标签在下面）。适合：概率、分数、占比、规模这类"某个量变大变小"的演示；涨落至少差 12，否则看不出来。**bars 里至少要有一根柱子涨或落（moves），而且只能用来表示"有大小、有多少"的东西；"稳定、轻量、效果好"这类没有数量的性质不要用柱子表示。**
   {"kind":"canvas","slot":"C","at":"d11","form":"bars","things":[{"id":"ref","label":"基准","tone":"gray","at":"d11","pos":40},{"id":"bad","label":"差的","tone":"pink","at":"d11@差的","pos":42,"moves":[{"at":"d12@压低","pos":18}]},{"id":"good","label":"好的","tone":"teal","at":"d11@好的","pos":45,"moves":[{"at":"d12@拉开","pos":88}]}],"marks":[{"type":"brace","from":"bad","to":"good","text":"差距","at":"d12@差距"},{"type":"note","text":"拉开了","at":"d13"}]}
   · "tree"（第一个东西是根，其余是它的分支，用箭头连起来，箭头上有流动的小点）。flow 取 "out"（默认，一生多：一个东西分出几个）或 "in"（多合一：几个东西汇进一个）。分支 1 到 4 个。适合：一个输入产生多个结果、几个部分合成一个整体、一个问题有几种答案。
   {"kind":"canvas","slot":"C","at":"e3","form":"tree","flow":"in","things":[{"id":"out","label":"最终答案","tone":"navy","at":"e3"},{"id":"a","label":"路径甲","tone":"teal","at":"e3@甲"},{"id":"b","label":"路径乙","tone":"orange","at":"e4@乙"}],"marks":[{"type":"brace","from":"a","to":"b","text":"都通向","at":"e5"}]}
   · row 还可以加 token：一个小数据包依次移到几个方块上，像数据在流水线里走。写在镜头里 "token":{"steps":[{"at":"e3","to":"a"},{"at":"e4@编码","to":"b"},{"at":"e5","to":"c"}],"tone":"orange"}，to 是 things 的 id，每一步的 at 必须在那个方块已经出现之后。
   marks（标记，可选，0 到 6 个）：
     · {"type":"point","who":"甲","at":"句子id@短语"}：旁白说到甲的时候，甲弹一下（像用手指一下）。**画布存续期间，任意两次变化（出现、移动、标记、弹一下）之间不能超过 6 秒，旁白很长时要用 point 或让东西出现、移动来填满，不能让画面停住。**
     · {"type":"brace","from":"甲","to":"乙","text":"不超过8字","at":"…","until":"可选"}：在两个东西下面画大括号。
     · {"type":"ring","who":"甲","at":"…","until":"可选"}：手绘圈住一个东西。
     · {"type":"arrow","from":"甲","to":"乙","text":"可选，不超过6字","at":"…"}：只用于 line，在两个东西之间画箭头（其他版式的箭头已自动画好，不要写）。
     · tree 的括号只能括分支，文字不超过 6 字。
     · {"type":"note","text":"不超过8字","at":"…"}：画布下方弹出一个醒目的结论小块。
     · {"type":"caption","text":"不超过8字","at":"…"}：画布顶部的一行小标题，后一条会替换前一条。
   规则：
     · **画面里不出现数字**（这是示意图，数字只由旁白来讲）；label、text 里不要写数字、英文、符号。
     · 括号、圈、箭头不写 until 时只留到下一句开始，想留得更久就明确写 until。
     · 同一个 at 的多个东西会自动一个接一个长出来，不必自己错开。
     · 括号、圈、箭头只能标"此刻已在画面上"的东西；被标的东西如果后来会移动，就给标记写 until，让它在移动之前收掉。
     · 时间锚点：句子 id（"d11"）、句内某个短语开口的时刻（"d11@拉开"，短语必须是该句原文里的连续字）、第几段字幕（"d11#1"）、句首后 N 帧（"d11+30"）。**句子很长（十几秒）时，一定要用"@短语"让东西在说到它的时候才出现，不要全挂在句首。** **这种带 @ # + 的写法只能用在 canvas 的 things 和 marks 里；其他所有镜头（stage、diagram、fig、table、card 等）的 at 和各种步骤的 at，一律只能写纯句子 id（如 "d12"）。**
     · 一块画布管 1 到 4 句旁白；用了 canvas，这几句里中央不要再放别的镜头。

25. 自由动画（canvas 的 form:"free"）：**前面 4 种版式装不下的内容，你自己搭动画。** 公式讲解场景里"这条公式到底在干什么"尤其要用它演示：概率被乘上权重再归一化、函数曲线随参数变陡、几个量合成一个量、一个量被拆成几部分……你自己决定画什么、怎么动，不要照抄示例。
   {"kind":"canvas","slot":"C","at":"i7","form":"free","clear":true,"objs":[
     {"id":"title","type":"text","at":"i7","x":50,"y":10,"size":"m","tone":"navy","text":"原来的概率"},
     {"id":"p","type":"bars","at":"i7","x":50,"y":50,"w":720,"h":230,"vals":[30,45,25],"labels":["回答甲","回答乙","回答丙"],"tone":"teal","keys":[{"at":"i7@奖励越高","vals":[22,95,48],"dur":40,"ease":"spring"},{"at":"i8@归一化","vals":[16,62,32],"dur":40}],"pulse":["i7@放大得越多"]},
     {"id":"w","type":"shape","shape":"pill","at":"i7@指数放大","x":13,"y":45,"w":230,"h":84,"tone":"orange","text":"exp(r/β)"},
     {"id":"a1","type":"line","at":"i7@指数放大","from":"w","to":"p","tone":"orange","flow":true},
     {"id":"ring","type":"ring","at":"i8@归一化","until":"i9","of":"p","tone":"teal"}]}
   {"kind":"canvas","slot":"C","at":"g3","form":"free","objs":[
     {"id":"c","type":"curve","at":"g3","x":50,"y":55,"w":760,"h":270,"fn":"exp(b*x)","params":{"b":0.4},"xmin":0,"xmax":1,"ymin":0,"ymax":20,"tone":"orange","text":"放大项","markOn":true,"mark":0.2,"keys":[{"at":"g3@越高","mark":0.95,"dur":50},{"at":"g3@越来越陡","params":{"b":3},"dur":60,"ease":"spring"}]}]}
   对象类型：
     · shape 图形：shape 取 circle（要 r）、rect 或 pill（要 w、h）；可带 text（≤10 字）、sticker、fill（实心）。
     · text 文字：text ≤12 字，size 取 s/m/l/xl。
     · line 连线：from、to 是对象 id（也可以是 {"x":..,"y":..} 百分比坐标），箭头会自动贴着对象边缘，对象移动时跟着走；flow:true 箭头上有流动的小点；dash:true 虚线；bend 弯曲；text ≤6 字。
     · bars 柱子组：x、y 是整组的中心，w、h 是占的区域（像素），vals 是 2 到 8 个 0 到 100 的数（高度占 h 的百分比），labels 每个 ≤6 字，tones 可给每根柱子不同颜色。
     · curve 函数曲线：x、y 是绘图区中心，w、h 是大小；fn 是 x 的表达式（x 从 xmin 到 xmax），params 给参数初值（表达式里用到的变量名都必须在这里给），ymin、ymax 是纵轴范围，超出会被截平；fn2 是第二条（灰色参照线）；markOn:true 加一个沿曲线移动的圆点，mark 是它在横轴上的位置 0 到 1。表达式支持 + - * / ^ 括号和函数 exp log sqrt abs sin cos tanh sig min max pow 以及常量 pi，**不要写别的**。
     · ring 手绘圈：of 是要圈的对象 id。brace 大括号：from、to 是两个对象 id，text ≤8 字。
   位置和尺寸：x、y 是对象的**中心点**，用 0 到 100 的百分比（x=0 最左，y=0 最上）；w、h、r 是**像素**（画布逻辑尺寸 1600×520，所以 w 最大 1600、h 最大 520）。想让两个东西左右并排，x 至少差 (w1+w2)/2/16 个百分点。
   关键帧 keys：[{"at":"锚点","x":..,"y":..,"w":..,"h":..,"r":..,"o":透明度0~1,"s":缩放,"rot":旋转角度,"vals":[..],"params":{"b":3},"mark":0.5,"text":"..","tone":"..","dur":帧数,"ease":"soft|out|pop|spring|bounce|snap"}]：到那个时刻，列出的数值**平滑过渡**到目标值（text、tone 是瞬间切换）。**讲到哪里就让对应的东西动：移动、变大变小、数值涨落、曲线变陡、合并、淡出。**pulse 是"旁白说到它时弹一下"的锚点列表。
   规则：
     · **画面上的字母、希腊字母、函数名只能是论文公式里出现过的**（比如 exp、β、Z、r、π）；**不能出现数字**；中文自由。想表达数量关系用柱子高度、曲线形状，不要写数字。
     · 对象 3 到 24 个；至少 1 个关键帧，关键帧加弹跳合计至少 4 次；任意两次变化（出现、关键帧、弹跳）之间不超过 6 秒；对象之间不能部分重叠（文字写在图形里面、完全被包住是可以的）。
     · 连线、圈、括号引用的对象必须比它先出现；对象不要伸出画布。
     · 时间锚点写法和别的版式相同（"句子id@句中短语"最常用，短语必须是该句原文里的连续字）。

26. **演示举例、比喻和动作（char 角色 + icon 道具）**：旁白里举例子、打比方、讲一连串动作的地方（"厨师把菜端给客人，客人尝了一口"），**必须用自由动画把人和物演出来**：谁出场、拿着什么、把什么交给谁、对方有什么反应，一步一步按旁白发生。**不能只放一个人站着说话，也不能用卡片转述。**
   在 form:"free" 的 objs 里再加两种对象：
   · char 角色：{"id":"chef","type":"char","look":"cook","at":"h2","x":22,"y":66,"w":200,"tag":"厨师","say":"…","mood":"thinking-face","flip":false,"keys":[…]}。look 是角色 id（见下面的角色清单）；w 是大小 90 到 320 像素（默认 150）；tag 不超过 5 个中文字，写在脚下；x、y 是脚附近的中心点百分比，y 取 55 到 70 比较合适（头顶要留出 100px 给说话气泡，所以 y 不要太小）。
     keys 里可以写：x/y/s/rot/o 平滑移动变化（走过去、变大、转身、淡出）；**look 瞬间换成另一个姿势或角色**（比如 person-tipping-hand 伸手介绍、person-shrugging 耸肩、person-frowning 皱眉、person-cartwheeling 兴奋、person-gesturing-no 摆手、person-facepalming 捂脸）；**say 头顶冒出一句台词气泡（不超过 14 字，不含数字和英文，口语化；写 "" 清掉）**；**mood 头上冒一个表情（道具清单里的表情，如 face-savoring-food 好吃、thinking-face 思考、nauseated-face 想吐、confused-face 困惑、partying-face 庆祝）**；**act 做一个动作：bounce 蹦、shake 摇头、nod 点头、wiggle 晃、jump 跳**。
   · icon 道具：{"id":"dish","type":"icon","prop":"fork-and-knife-with-plate","at":"h2@端出来","x":30,"y":62,"w":100,"keys":[{"at":"h2@端出来的菜","x":70,"dur":44}]}。prop 是道具清单里的 id（菜、钱、文件、车、房子、动物、符号、表情）。**道具可以在角色之间移动**（从厨师手边移到客人面前），也可以变大、变小、淡出（被吃掉、被扔掉）。
   **公式讲解（eqx）占着的句子里也要演示：给那个 eqx 写 "insets"**：[{"from":"i5","to":"i5","objs":[…自由动画对象，写法同上…]}]。from 到 to（最多 4 句，必须落在 eqx 占用的句子范围里）这几句里，公式会缩小到上方（高亮、圈、名字标签照常），下面换成你搭的演示，演完公式恢复原大小。**演示区比整块画布矮：它的逻辑尺寸是 1600×300（不是 1600×520）**——x 仍是 0~100 的百分比（横向），y 0~100 对应 300 像素高；w、h、r 是像素，h 最大 300，角色 w 建议 120~170，柱子组 h 建议 130~200；说话气泡要头顶留 100 像素，所以角色的 y 要取 70 以上（脚在下面）。
   演示的写法：
     · 先想清楚"这段旁白里谁做了什么、对方怎么样"，把每个动作、每个反应都变成一个关键帧，**时间锚点用旁白里对应动作的原话**（"h2@端出来"、"h2@合不合你口味"）。
     · 角色之间要有互动：走近、递东西、点头、摇头、冒表情、说一句话；不能全程站着不动。
     · 一个人演不完就两个人：旁白里有"厨师和客人""老师和学生""评委和选手"，两个角色都要出场。
     · 例子里的东西要画出来，用 icon（菜、钱、书、文件）；抽象的变化用柱子、曲线、箭头。
     · 一处演示管 1 到 4 句旁白，镜头要铺满这几句；演完下一句换别的镜头。
   角色清单（look 的取值）：teacher(老师)、student(学生)、cook(厨师)、judge(评委/法官)、scientist(科学家)、detective(侦探)、mechanic(修理工)、office-worker(上班族)、technologist(程序员)、farmer(农夫)、artist(画家)、pilot(飞行员)、astronaut(宇航员)、police-officer(警察)、construction-worker(工人)、health-worker(医生)、singer(歌手)、firefighter(消防员)、guard(守卫)、baby(婴儿)、older-person(老人)、child(小孩)、person-standing(站着)、person-walking(走路)、person-running(跑步)、person-raising-hand(举手提问)、person-gesturing-no(摆手说不)、person-gesturing-ok(比 OK)、person-shrugging(耸肩无奈)、person-facepalming(捂脸懊恼)、person-bowing(鞠躬)、person-tipping-hand(伸手介绍)、person-lifting-weights(举重/费力)、person-climbing(攀爬)、person-juggling(杂耍/同时处理多件事)、person-in-lotus-position(打坐/冷静)、person-cartwheeling(翻跟头/兴奋)、person-pouting(生气)、person-frowning(皱眉)、person-kneeling(跪着)、person-fencing(击剑/对抗)、person-rowing-boat(划船)、person-biking(骑车)、person-swimming(游泳)、person-surfing(冲浪)、man-dancing(跳舞)、woman-dancing(跳舞(女))、people-hugging(拥抱)、handshake(握手)、clapping-hands(鼓掌)、flexed-biceps(有力量)、thumbs-up(点赞)、waving-hand(挥手)
   道具和表情清单（prop、mood 的取值）：pot-of-food(一锅菜)、shallow-pan-of-food(炒菜锅)、cooking(煎蛋/炒菜)、bowl-with-spoon(一碗汤)、steaming-bowl(热汤面)、fork-and-knife-with-plate(一盘菜)、hamburger(汉堡)、pizza(披萨)、bento-box(便当)、cooked-rice(米饭)、spaghetti(意面)、sushi(寿司)、dumpling(饺子)、bread(面包)、green-salad(沙拉)、cut-of-meat(肉排)、poultry-leg(鸡腿)、egg(鸡蛋)、red-apple(苹果)、banana(香蕉)、watermelon(西瓜)、strawberry(草莓)、tomato(番茄)、carrot(胡萝卜)、birthday-cake(蛋糕)、shortcake(小蛋糕)、ice-cream(冰淇淋)、hot-beverage(热饮)、teacup-without-handle(茶)、cup-with-straw(饮料)、kitchen-knife(菜刀)、package(包裹/箱子)、briefcase(公文包)、page-facing-up(文件)、memo(便签)、file-folder(文件夹)、clipboard(写字板)、books(书堆)、open-book(打开的书)、newspaper(报纸)、envelope(信封)、mobile-phone(手机)、laptop(笔记本电脑)、desktop-computer(台式电脑)、keyboard(键盘)、light-bulb(灯泡)、battery(电池)、gear(齿轮)、wrench(扳手)、hammer(锤子)、key(钥匙)、locked(锁)、magnifying-glass-tilted-left(放大镜)、scissors(剪刀)、paintbrush(画笔)、pencil(铅笔)、puzzle-piece(拼图)、game-die(骰子)、balance-scale(天平)、money-bag(钱袋)、coin(硬币)、dollar-banknote(钞票)、credit-card(银行卡)、wrapped-gift(礼物)、trophy(奖杯)、1st-place-medal(金牌)、chequered-flag(终点旗)、bell(铃)、megaphone(喇叭)、stopwatch(秒表)、hourglass-not-done(沙漏)、calendar(日历)、wastebasket(垃圾桶)、door(门)、shopping-cart(购物车)、shopping-bags(购物袋)、ticket(票)、compass(指南针)、telescope(望远镜)、microscope(显微镜)、dna(基因)、test-tube(试管)、bar-chart(柱状图)、chart-increasing(上涨图)、chart-decreasing(下跌图)、label(标签)、link(链条)、paperclip(回形针)、pushpin(图钉)、toolbox(工具箱)、magnet(磁铁)、crown(皇冠)、mirror(镜子)、balloon(气球)、house(房子)、office-building(写字楼)、hospital(医院)、school(学校)、bank(银行)、factory(工厂)、department-store(商场)、classical-building(大楼)、automobile(汽车)、bus(公交车)、airplane(飞机)、rocket(火箭)、bicycle(自行车)、ship(轮船)、train(火车)、tent(帐篷)、bridge-at-night(桥)、world-map(地图)、globe-showing-asia-australia(地球)、deciduous-tree(树)、seedling(幼苗)、sun(太阳)、cloud(云)、umbrella(伞)、snowflake(雪花)、fire(火)、mountain(山)、droplet(水滴)、dog-face(狗)、cat-face(猫)、mouse-face(老鼠)、ant(蚂蚁)、elephant(大象)、bird(小鸟)、fish(鱼)、turtle(乌龟)、monkey-face(猴子)、rabbit-face(兔子)、honeybee(蜜蜂)、red-question-mark(问号)、red-exclamation-mark(感叹号)、check-mark-button(对勾)、cross-mark(叉)、warning(警告)、prohibited(禁止)、up-arrow(向上箭头)、down-arrow(向下箭头)、right-arrow(向右箭头)、left-arrow(向左箭头)、counterclockwise-arrows-button(循环)、plus(加号)、minus(减号)、red-heart(爱心)、star(星星)、high-voltage(闪电)、sparkles(闪光)、speech-balloon(对话框)、thought-balloon(想法气泡)、zzz(睡觉)、collision(碰撞)、dashing-away(飞奔)、grinning-face(开心)、face-savoring-food(好吃)、smiling-face-with-heart-eyes(太爱了)、star-struck(惊艳)、partying-face(庆祝)、winking-face(眨眼)、smirking-face(得意)、thinking-face(思考)、confused-face(困惑)、neutral-face(面无表情)、slightly-frowning-face(不满意)、grimacing-face(尴尬)、face-with-rolling-eyes(翻白眼)、worried-face(担心)、downcast-face-with-sweat(冷汗)、pensive-face(失落)、nauseated-face(想吐)、face-vomiting(吐了)、angry-face(生气)、loudly-crying-face(大哭)、exploding-head(炸裂)、face-with-monocle(仔细看)、hugging-face(拥抱)、sleeping-face(困)、face-screaming-in-fear(吓坏了)、face-with-tears-of-joy(笑哭)、zany-face(疯狂)、face-with-raised-eyebrow(质疑)、melting-face(融化)

27. **动作配方**（旁白里的这些动作，用下面的写法演出来；没写出对应的关键帧，评审会判"没演到位"）：
   · **转动**（旋钮、齿轮、指针、转盘）：给那个 shape 或 icon 写 keys 的 rot（旋转角度，度），一次转到位：{"at":"d8@转动","rot":120,"dur":40,"ease":"spring"}；再转回来或继续转，写下一个 rot。指针用一个细长的 pill 加 rot。
   · **倾斜**（天平、跷跷板、秤）：用一个很扁的 rect（比如 w=360,h=24）当横梁，两头各放一个 icon（物品），keys 里横梁 rot 从 0 变到 -14（左低）或 14（右低），两头的 icon 的 y 跟着一头升一头降（y 变化约 ±6）。
   · **变大变小、变粗变细**（气球吹大、手臂变粗、数值变大）：keys 里写 s（缩放）：{"at":"…","s":1.6,"dur":36,"ease":"spring"}；想"一点点变大"就连着写几个 s。
   · **压扁、拉长**（把一长条压成一小段）：用一个 rect，keys 里改 w（变短）或 h（变矮）；{"at":"…","w":160,"dur":40}。同时改 h 可以做"被压扁又变厚"。
   · **翻转**（把公式板翻过来）：一块 rect 或 shape，keys 里 rot 到 180 或 s 先变到 0.05 再变回 1，中间用 text 换成翻转后的文字（keys 的 text 是瞬间切换）：先 {"at":"A","s":0.05,"dur":10}，再 {"at":"A+12","text":"新文字","s":1,"dur":10}。
   · **握手、拥抱、鼓掌、挥手**：两个 char 走到一起（x 相向移动，最后相距约 14 个百分点），然后其中一个 look 换成 handshake / people-hugging / clapping-hands / waving-hand，或者直接放一个 icon（prop 是 handshake 之类）在两人中间弹出来：{"id":"hs","type":"icon","prop":"handshake","at":"x10@握手","x":50,"y":60,"w":120,"pulse":["x10@握手"]}。
   · **两个并排比较**（两份摘要、两盘菜、两个回答）：**必须放两个**对象，左右对称（比如 x=32 和 x=68），各自有标签；比较结果用 ring、对勾（prop check-mark-button）、叉（cross-mark）、星星标在其中一个上。
   · **一排东西**（记录卡片、排队的新菜）：放 4 到 6 个同样的 icon 或小 shape，x 等间距，at 依次错开（e8@一组、e8@一组+8、+16…），"反复跑很多组"再加一个循环箭头 icon（prop counterclockwise-arrows-button）一直转（rot 每 1 秒加 180）。
   · **冲过线、被拦住**（选手冲过终点线）：画一条竖着的细 rect 当线；选手用 char（look 取 person-running），x 从线左边移到线右边，其他选手的 x 停在线前面（不移动或只挪一点）并且 look 换成 person-frowning。
   · **晃动**（天平晃、东西不稳）：同一个对象连着写几个 rot 或 y 的关键帧来回变：{"at":"A","rot":-10,"dur":10},{"at":"A+10","rot":10,"dur":10},{"at":"A+20","rot":-6,"dur":10},{"at":"A+30","rot":0,"dur":14}。
   · **变亮变暗、发光**（调亮度、点亮）：给一个大的 shape（比如画框）写 keys 的 o（透明度）从 0.3 变到 1，或者用 icon（prop sun）放大 s 并且 pulse。
   · **品尝、吃、打分**：角色 look 换成 face-savoring-food（用 mood，不是 look），icon（菜）移到角色面前后淡出（o 变 0），角色 mood 冒出表情（好吃 face-savoring-food、难吃 nauseated-face、一般 neutral-face），可再配 say。
   · **批改、打勾打叉**：一张 icon（page-facing-up），keys 里依次出现 check-mark-button 或 cross-mark 的 icon（每个对象 at 错开）。
   **每个动作都要有对应的 keys 事件，时间锚点用旁白里这个动作的原话。**
`;
