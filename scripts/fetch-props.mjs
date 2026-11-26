// 下载"道具和表情"素材：Fluent Emoji Flat（Microsoft，MIT），存到 public/props/，并写 src/story/props.json。
//   node scripts/fetch-props.mjs
// 用途：自由动画里的 icon（菜、钱、文件、车、房子……可以在角色之间传递）和角色头上的表情气泡（mood）。
// 和 public/chars/ 里的角色同一风格、同一来源。
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
const SETS = {
  食物: { "pot-of-food": "一锅菜", "shallow-pan-of-food": "炒菜锅", "cooking": "煎蛋/炒菜", "bowl-with-spoon": "一碗汤", "steaming-bowl": "热汤面", "fork-and-knife-with-plate": "一盘菜", "hamburger": "汉堡", "pizza": "披萨", "bento-box": "便当", "cooked-rice": "米饭", "spaghetti": "意面", "sushi": "寿司", "dumpling": "饺子", "bread": "面包", "green-salad": "沙拉", "cut-of-meat": "肉排", "poultry-leg": "鸡腿", "egg": "鸡蛋", "red-apple": "苹果", "banana": "香蕉", "watermelon": "西瓜", "strawberry": "草莓", "tomato": "番茄", "carrot": "胡萝卜", "birthday-cake": "蛋糕", "shortcake": "小蛋糕", "ice-cream": "冰淇淋", "hot-beverage": "热饮", "teacup-without-handle": "茶", "cup-with-straw": "饮料", "kitchen-knife": "菜刀" },
  物品: { "package": "包裹/箱子", "briefcase": "公文包", "page-facing-up": "文件", "memo": "便签", "file-folder": "文件夹", "clipboard": "写字板", "books": "书堆", "open-book": "打开的书", "newspaper": "报纸", "envelope": "信封", "mobile-phone": "手机", "laptop": "笔记本电脑", "desktop-computer": "台式电脑", "keyboard": "键盘", "light-bulb": "灯泡", "battery": "电池", "gear": "齿轮", "wrench": "扳手", "hammer": "锤子", "key": "钥匙", "locked": "锁", "magnifying-glass-tilted-left": "放大镜", "scissors": "剪刀", "paintbrush": "画笔", "pencil": "铅笔", "puzzle-piece": "拼图", "game-die": "骰子", "balance-scale": "天平", "money-bag": "钱袋", "coin": "硬币", "dollar-banknote": "钞票", "credit-card": "银行卡", "wrapped-gift": "礼物", "trophy": "奖杯", "1st-place-medal": "金牌", "chequered-flag": "终点旗", "bell": "铃", "megaphone": "喇叭", "stopwatch": "秒表", "hourglass-not-done": "沙漏", "calendar": "日历", "wastebasket": "垃圾桶", "door": "门", "shopping-cart": "购物车", "shopping-bags": "购物袋", "ticket": "票", "compass": "指南针", "telescope": "望远镜", "microscope": "显微镜", "dna": "基因", "test-tube": "试管", "bar-chart": "柱状图", "chart-increasing": "上涨图", "chart-decreasing": "下跌图", "label": "标签", "link": "链条", "paperclip": "回形针", "pushpin": "图钉", "toolbox": "工具箱", "magnet": "磁铁", "crown": "皇冠", "mirror": "镜子", "balloon": "气球" },
  地点交通: { "house": "房子", "office-building": "写字楼", "hospital": "医院", "school": "学校", "bank": "银行", "factory": "工厂", "department-store": "商场", "classical-building": "大楼", "automobile": "汽车", "bus": "公交车", "airplane": "飞机", "rocket": "火箭", "bicycle": "自行车", "ship": "轮船", "train": "火车", "tent": "帐篷", "bridge-at-night": "桥", "world-map": "地图", "globe-showing-asia-australia": "地球" },
  自然动物: { "deciduous-tree": "树", "seedling": "幼苗", "sun": "太阳", "cloud": "云", "umbrella": "伞", "snowflake": "雪花", "fire": "火", "mountain": "山", "droplet": "水滴", "dog-face": "狗", "cat-face": "猫", "mouse-face": "老鼠", "ant": "蚂蚁", "elephant": "大象", "bird": "小鸟", "fish": "鱼", "turtle": "乌龟", "monkey-face": "猴子", "rabbit-face": "兔子", "honeybee": "蜜蜂" },
  符号: { "red-question-mark": "问号", "red-exclamation-mark": "感叹号", "check-mark-button": "对勾", "cross-mark": "叉", "warning": "警告", "prohibited": "禁止", "up-arrow": "向上箭头", "down-arrow": "向下箭头", "right-arrow": "向右箭头", "left-arrow": "向左箭头", "counterclockwise-arrows-button": "循环", "plus": "加号", "minus": "减号", "red-heart": "爱心", "star": "星星", "high-voltage": "闪电", "sparkles": "闪光", "speech-balloon": "对话框", "thought-balloon": "想法气泡", "zzz": "睡觉", "collision": "碰撞", "dashing-away": "飞奔" },
  表情: { "grinning-face": "开心", "face-savoring-food": "好吃", "smiling-face-with-heart-eyes": "太爱了", "star-struck": "惊艳", "partying-face": "庆祝", "winking-face": "眨眼", "smirking-face": "得意", "thinking-face": "思考", "confused-face": "困惑", "neutral-face": "面无表情", "slightly-frowning-face": "不满意", "grimacing-face": "尴尬", "face-with-rolling-eyes": "翻白眼", "worried-face": "担心", "downcast-face-with-sweat": "冷汗", "pensive-face": "失落", "nauseated-face": "想吐", "face-vomiting": "吐了", "angry-face": "生气", "loudly-crying-face": "大哭", "exploding-head": "炸裂", "face-with-monocle": "仔细看", "hugging-face": "拥抱", "sleeping-face": "困", "face-screaming-in-fear": "吓坏了", "face-with-tears-of-joy": "笑哭", "zany-face": "疯狂", "face-with-raised-eyebrow": "质疑", "melting-face": "融化" },
};
mkdirSync("public/props", { recursive: true });
const list = [];
const failed = [];
for (const [group, items] of Object.entries(SETS)) {
  for (const [id, zh] of Object.entries(items)) {
    const file = `public/props/${id}.svg`;
    if (!existsSync(file)) {
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        try {
          const r = await fetch(`https://api.iconify.design/fluent-emoji-flat/${id}.svg`);
          const t = await r.text();
          if (r.ok && t.startsWith("<svg")) { writeFileSync(file, t); ok = true; }
          else if (r.status === 404) break; // 名字不对，不用重试
        } catch { /* 网络失败，等一下再试 */ }
        if (!ok) await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
      }
      await new Promise((res) => setTimeout(res, 120)); // 别请求太快
      if (!ok) { failed.push(id); continue; }
    }
    list.push({ id, zh, group });
  }
}
writeFileSync("src/story/props.json", JSON.stringify(list, null, 2));
writeFileSync("public/props/CREDITS.txt", "道具和表情素材来源: Fluent Emoji Flat (Microsoft Corporation)\n项目: https://github.com/microsoft/fluentui-emoji\n许可证: MIT\n通过 Iconify 获取: https://api.iconify.design/\n");
console.log(`已就绪 ${list.length} 个道具/表情 → public/props/，src/story/props.json`);
if (failed.length) console.log(`没下到（名字不对或网络问题）：${failed.join("、")}`);
