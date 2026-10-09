import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-text-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(3000);
// Print all visible text near "你的职场超能" - search DOM for it
const found = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('*'));
  const hits = [];
  for (const el of all) {
    const text = (el.textContent || '').trim();
    if (text.includes('职场') || text.includes('超能') || text.includes('1000') || text.includes('积分') || text.includes('领') || text.includes('活动中心')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        hits.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 80),
          text: text.slice(0, 100),
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width),
        });
      }
    }
  }
  return hits;
});
console.log(JSON.stringify(found, null, 2));
await app.close();
