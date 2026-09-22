import { _electron as electron } from "playwright";
import { join } from "node:path";
const root = "/Users/louloulin/appx/OpenBuddy";
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "dist/main/index.js")], cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(3000);
const dump = await page.evaluate(() => {
  const lines = [];
  const walk = (el, depth = 0) => {
    if (depth > 7) return;
    for (const c of Array.from(el.children)) {
      const cls = (c.className || "").toString().trim().slice(0, 70);
      const r = c.getBoundingClientRect();
      const t = (c.childElementCount === 0) ? (c.textContent || "").trim().slice(0, 45) : "";
      if (cls || t || r.height > 0) {
        lines.push(`${"  ".repeat(depth)}<${c.tagName.toLowerCase()} class="${cls}"> ${Math.round(r.width)}x${Math.round(r.height)} ${t}`);
      }
      walk(c, depth + 1);
    }
  };
  walk(document.body);
  return lines.slice(0, 400).join("\n");
});
console.log(dump);
await app.close();
