import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-fo-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForFunction(() => window.api?.apiVersion === 1);
await page.waitForTimeout(2500);
const win = await app.browserWindow(page);
await win.evaluate((w) => w.setContentSize(1728, 1091));
await page.waitForTimeout(2500);
const out = process.argv[2] || "/Users/louloulin/Downloads/cur-footer.png";
await page.screenshot({ path: out, clip: { x: 0, y: 950, width: 264, height: 100 } });
const m = await page.evaluate(() => {
  const f = document.querySelector('.sidebar__footer');
  if (!f) return null;
  return {
    rect: (() => { const r = f.getBoundingClientRect(); return {y: Math.round(r.y), h: Math.round(r.height)}; })(),
    html: f.outerHTML.slice(0, 1200),
    children: [...f.children].map(el => ({
      tag: el.tagName,
      cls: el.className,
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      txt: el.textContent.trim().slice(0, 30),
      svg: el.querySelector('svg') ? 'yes' : 'no',
      rect: (() => { const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; })(),
    })),
  };
});
console.log(JSON.stringify(m, null, 1));
await app.close();
