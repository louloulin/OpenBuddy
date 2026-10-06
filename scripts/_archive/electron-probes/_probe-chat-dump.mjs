/**
 * 打开一个会话，把 chat 内容区所有元素的 class 全 dump 出来，找出包含
 * "tool" / "file" / "preview" / "edit" / "editor" / "ProseMirror" 的。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-chat-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15000);
await page.evaluate(() => { for (const el of [...document.querySelectorAll("*")]) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== "none") el.remove(); } });
await page.waitForTimeout(500);

// 遍历前 15 个 session，dump 与 file/tool 相关的 class
const allClasses = new Set();
const interestingClasses = new Set();
for (let i = 0; i < 15; i++) {
  await page.evaluate((idx) => { document.querySelectorAll(".sidebar__conv-wrap")[idx]?.click(); }, i);
  await page.waitForTimeout(2200);
  const cls = await page.evaluate(() => {
    const root = document.querySelector(".chatview__inner, .chatview, .app__main") || document.body;
    const all = [...root.querySelectorAll("*")].map((e) => e.className.toString());
    return { all };
  });
  cls.all.forEach((c) => {
    c.split(/\s+/).forEach((part) => { if (part) allClasses.add(part); });
  });
}
// 筛出 file / tool / preview / editor / prose / markdown 关键字
for (const c of allClasses) {
  if (/file|tool|preview|edit|editor|prose|markdown|tipTap|TipTap/i.test(c)) {
    interestingClasses.add(c);
  }
}
console.log("interesting:", JSON.stringify([...interestingClasses], null, 2));
console.log("total:", allClasses.size, "interesting:", interestingClasses.size);
await app.close();
process.exit(0);
