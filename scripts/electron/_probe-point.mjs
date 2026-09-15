import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-point-"));
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

// The screenshot was 2560x1600 (2x DPR) resized to 1200x743.
// Point (350, 320) in resized = (350/1200*1280, 320/743*800) = (373, 344) in CSS
const result = await page.evaluate(() => {
  const points = [[373, 344], [373, 340], [480, 344], [300, 344], [700, 344]];
  return points.map(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return { x, y, el: null };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x, y,
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 60),
      text: (el.textContent || '').trim().slice(0, 30),
      rect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)},
      bg: cs.backgroundColor,
    };
  });
});
console.log(JSON.stringify(result, null, 2));
await app.close();
