// 论文第一页截图：给标题卡用。arXiv 编号 → 下载 PDF（缓存）→ 用 PyMuPDF（通过 uv 临时安装，不污染系统）渲染第 1 页 → public/projects/<id>/paper.png
// 借鉴 Lunamos/paper2video 的 paper_shot.mjs（MIT）：只取页面上部（标题、作者、摘要），所以导出时就裁掉左右白边。
//   node scripts/paper-shot.mjs <arXiv 编号> [--dpi 170]
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const id = process.argv[2];
if (!id) throw new Error("用法：node scripts/paper-shot.mjs <arXiv 编号>");
const dpi = process.argv.includes("--dpi") ? process.argv[process.argv.indexOf("--dpi") + 1] : "170";
const pdf = `projects/${id}/paper/${id}.pdf`;
const out = `public/projects/${id}/paper.png`;
mkdirSync(`public/projects/${id}`, { recursive: true });
if (!existsSync(pdf)) {
  const r = await fetch(`https://arxiv.org/pdf/${id}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`下载 PDF 失败：${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.slice(0, 4).toString() !== "%PDF") throw new Error("下载到的不是 PDF");
  writeFileSync(pdf, buf);
  console.log(`已下载 PDF：${(buf.length / 1024).toFixed(0)} KB`);
}
const py = `
import fitz, sys
doc = fitz.open(sys.argv[1])
page = doc[0]
pix = page.get_pixmap(dpi=int(sys.argv[3]))
pix.save(sys.argv[2])
print(pix.width, pix.height, doc.page_count)
`;
writeFileSync(`llm-test/_shot.py`, py);
const r = spawnSync("uv", ["run", "--with", "pymupdf", "python", "llm-test/_shot.py", pdf, out, dpi], { encoding: "utf8" });
if (r.status !== 0) throw new Error(`渲染失败：${(r.stderr ?? "").slice(-400)}`);
console.log(`→ ${out}（宽 高 总页数：${r.stdout.trim()}）`);
