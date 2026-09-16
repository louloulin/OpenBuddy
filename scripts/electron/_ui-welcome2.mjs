import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots/welcome";
mkdirSync(outDir, { recursive: true });
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "out/main/index.js")], cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

const before = await page.evaluate(() => ({
  msgs: document.querySelectorAll(".msg").length,
  status: document.querySelector(".chatview__status")?.textContent?.trim(),
  title: document.querySelector(".chatview__title")?.textContent?.trim(),
}));
console.log("BEFORE new task:", JSON.stringify(before));

await page.locator(".sidebar__nav-item", { hasText: "新建任务" }).first().click();
await page.waitForTimeout(2000);

const after = await page.evaluate(() => {
  // 列出 chatview 内的直接子元素结构
  const cv = document.querySelector(".chatview");
  const walk = (el, depth = 0, out = []) => {
    if (depth > 4) return out;
    for (const c of Array.from(el.children)) {
      const cls = (c.className || "").toString().slice(0, 60);
      const r = c.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        out.push({ depth, tag: c.tagName, cls, w: Math.round(r.width), h: Math.round(r.height), text: c.textContent?.trim().slice(0, 40) });
        walk(c, depth + 1, out);
      }
    }
    return out;
  };
  return {
    msgs: document.querySelectorAll(".msg").length,
    hasEmpty: !!document.querySelector(".chatview__empty-state"),
    status: document.querySelector(".chatview__status")?.textContent?.trim(),
    title: document.querySelector(".chatview__title")?.textContent?.trim(),
    structure: cv ? walk(cv) : [],
  };
});
console.log("AFTER:", JSON.stringify(after, null, 2));
await page.screenshot({ path: join(outDir, "after-newtask.png") });
await app.close();
