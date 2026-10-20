import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-y344-"));
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

const result = await page.evaluate(() => {
  // Find all visible elements whose DOM rect overlaps with y ~= 344 (screenshot y=320 maps to DOM y=344)
  const all = Array.from(document.querySelectorAll('body *'));
  const relevant = all.filter(el => {
    const r = el.getBoundingClientRect();
    return r.y < 360 && r.y + r.height > 330 && r.width > 20 && r.height > 10;
  });
  return relevant.slice(0, 20).map(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 60),
      text: (el.textContent || '').trim().slice(0, 40),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      bg: cs.backgroundColor,
    };
  });
});
console.log(JSON.stringify(result, null, 2));
await app.close();
