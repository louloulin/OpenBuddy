import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-shot-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(2500);
const layout = await page.evaluate(() => {
  const vis = (els) => els.filter(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
  }).map(el => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 200),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    };
  });
  return {
    bodyKids: vis(Array.from(document.body.children)),
    mainContent: vis(Array.from(document.querySelectorAll(".app, .app__body, .app__main, #main-content, main"))),
    asides: vis(Array.from(document.querySelectorAll("aside, [class*='panel']"))),
    candidateRight: vis(Array.from(document.querySelectorAll("[class*='home-overview'], [class*='right-panel'], [class*='right-side'], [class*='side-panel'], [class*='right']"))),
  };
});
console.log(JSON.stringify(layout, null, 2));
await page.screenshot({ path: '/tmp/ob-current.png', fullPage: false });
await app.close();
