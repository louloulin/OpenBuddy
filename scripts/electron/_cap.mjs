import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cmp-"));
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
const out = process.argv[2] || "/tmp/ob.png";
await page.screenshot({ path: out });
const m = await page.evaluate(() => {
  const g = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    viewport: { w: innerWidth, h: innerHeight },
    app: g('.app'), appBody: g('.app__body'), main: g('.app__main'),
    home: g('.home'), inner: g('.home__inner'), hero: g('.home__hero'),
    wrap: g('.wb-composer-wrap'), composer: g('.wb-composer'),
    meta: g('.wb-composer-meta'),
    scenes: g('.home__scenes'), chips: g('.home__chips'),
    practices: g('.home__practices'),
  };
});
console.log(JSON.stringify(m, null, 1));
await app.close();
