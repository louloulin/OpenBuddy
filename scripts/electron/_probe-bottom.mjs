import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-bottom-"));
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

// Dump all visible elements with their texts to understand layout
const result = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('body *'));
  const vis = all.filter(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.1;
  });
  return vis.map(el => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 80),
      text: (el.textContent || '').trim().slice(0, 60).replace(/\s+/g, ' '),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    };
  });
});
// Print only items in interesting regions: bottom strip (y > 600) or right edge (x > 1100)
const bottom = result.filter(e => e.y > 600 && e.y < 800 && e.w > 30);
const farRight = result.filter(e => e.x > 1100 && e.w > 30);
console.log("=== bottom strip ===");
console.log(JSON.stringify(bottom.slice(0, 20), null, 2));
console.log("=== far right ===");
console.log(JSON.stringify(farRight.slice(0, 20), null, 2));
await app.close();
