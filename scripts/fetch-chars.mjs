// 下载"角色"素材：Fluent Emoji Flat（Microsoft，MIT）里的职业人物和动作姿势，存到 public/chars/，并写 src/story/chars.json。
//   node scripts/fetch-chars.mjs
// 和 public/stickers/ 里的物品贴图同一风格。角色分两类：role（职业，当固定角色用）和 pose（动作姿势，演到某个动作时换上）。
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const ROLES = {
  teacher: "老师", student: "学生", cook: "厨师", judge: "评委/法官", scientist: "科学家", detective: "侦探",
  mechanic: "修理工", "office-worker": "上班族", technologist: "程序员", farmer: "农夫", artist: "画家",
  pilot: "飞行员", astronaut: "宇航员", "police-officer": "警察", "construction-worker": "工人",
  "health-worker": "医生", singer: "歌手", firefighter: "消防员", guard: "守卫", baby: "婴儿", "older-person": "老人", child: "小孩",
};
const POSES = {
  "person-standing": "站着", "person-walking": "走路", "person-running": "跑步", "person-raising-hand": "举手提问",
  "person-gesturing-no": "摆手说不", "person-gesturing-ok": "比 OK", "person-shrugging": "耸肩无奈", "person-facepalming": "捂脸懊恼",
  "person-bowing": "鞠躬", "person-tipping-hand": "伸手介绍", "person-lifting-weights": "举重/费力", "person-climbing": "攀爬",
  "person-juggling": "杂耍/同时处理多件事", "person-in-lotus-position": "打坐/冷静", "person-cartwheeling": "翻跟头/兴奋",
  "person-pouting": "生气", "person-frowning": "皱眉", "person-kneeling": "跪着", "person-fencing": "击剑/对抗", "person-rowing-boat": "划船",
  "person-biking": "骑车", "person-swimming": "游泳", "person-surfing": "冲浪", "man-dancing": "跳舞", "woman-dancing": "跳舞(女)",
  "people-hugging": "拥抱", handshake: "握手", "clapping-hands": "鼓掌", "flexed-biceps": "有力量", "thumbs-up": "点赞", "waving-hand": "挥手",
};
mkdirSync("public/chars", { recursive: true });
const list = [];
for (const [kind, group] of [["role", ROLES], ["pose", POSES]]) {
  for (const [id, zh] of Object.entries(group)) {
    const file = `public/chars/${id}.svg`;
    if (!existsSync(file)) {
      const r = await fetch(`https://api.iconify.design/fluent-emoji-flat/${id}.svg`);
      const t = await r.text();
      if (!r.ok || !t.startsWith("<svg")) {
        console.log(`  ✗ ${id}：${r.status}`);
        continue;
      }
      writeFileSync(file, t);
    }
    list.push({ id, zh, kind });
  }
}
writeFileSync("src/story/chars.json", JSON.stringify(list, null, 2));
writeFileSync("public/chars/CREDITS.txt", "角色素材来源: Fluent Emoji Flat (Microsoft Corporation)\n项目: https://github.com/microsoft/fluentui-emoji\n许可证: MIT\n通过 Iconify 获取: https://api.iconify.design/\n");
console.log(`已就绪 ${list.length} 个角色（role ${list.filter((x) => x.kind === "role").length}，pose ${list.filter((x) => x.kind === "pose").length}）→ public/chars/，src/story/chars.json`);
