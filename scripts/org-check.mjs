// 论文来源白名单检查。
//   import { checkOrgs } from "./org-check.mjs"; checkOrgs({ authorsText, abstract, links })
//   node scripts/org-check.mjs <id>        # 读 projects/<id>/paper/meta.json，看是否在白名单里（退出码 0 在 / 5 不在）
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cfgFile = join(dirname(fileURLToPath(import.meta.url)), "..", "config", "allowed-orgs.json");

export function loadOrgs() {
  return JSON.parse(readFileSync(cfgFile, "utf8").replace(/^\uFEFF/, "")).orgs;
}

/** 在作者栏文字、摘要和链接里找白名单机构。返回 [{ org, by, hit }]，by 是来源（作者栏/邮箱/链接/摘要） */
export function checkOrgs({ authorsText = "", emails = [], links = [], abstract = "" }) {
  const found = [];
  for (const o of loadOrgs()) {
    const flags = o.caseSensitive ? "" : "i";
    const tryText = (text, by) => {
      for (const p of o.patterns ?? []) {
        const m = new RegExp(p, flags).exec(text);
        if (m) return found.push({ org: o.name, by, hit: m[0] });
      }
    };
    tryText(authorsText, "作者栏");
    for (const d of o.domains ?? []) {
      const dl = d.toLowerCase();
      const e = emails.find((x) => x.toLowerCase().includes("@" + dl) || x.toLowerCase().endsWith("." + dl));
      if (e) found.push({ org: o.name, by: "邮箱", hit: e });
      const l = links.find((x) => new RegExp(`(^|[/.@])${dl.replace(/\./g, "\\.")}([/:]|$)`, "i").test(x) || x.toLowerCase().includes("/" + dl + "/"));
      if (l) found.push({ org: o.name, by: "链接", hit: l });
    }
    // 摘要里只认"机构名 + 模型/团队"这类很明确的写法太容易误判，所以摘要只用域名/链接，不用名字
  }
  // 同一机构只留优先级最高的来源
  const seen = new Map();
  for (const f of found) if (!seen.has(f.org)) seen.set(f.org, f);
  return [...seen.values()];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const id = process.argv[2];
  if (!id) throw new Error("用法：node scripts/org-check.mjs <arXiv 编号>");
  const f = join("projects", id, "paper", "meta.json");
  if (!existsSync(f)) throw new Error(`没有 ${f}，先运行 fetch-paper`);
  const m = JSON.parse(readFileSync(f, "utf8"));
  const hits = checkOrgs({ authorsText: m.authors ?? "", emails: m.emails ?? [], links: m.links ?? [], abstract: m.abstract ?? "" });
  console.log(hits.length ? `在白名单：${hits.map((h) => `${h.org}（${h.by}：${h.hit}）`).join("、")}` : "不在白名单（作者栏、邮箱、链接都没有匹配的机构）");
  process.exit(hits.length ? 0 : 5);
}
