import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cap-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(3000);
const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1000, 640); });
await page.waitForTimeout(2500);
await page.screenshot({ path: process.argv[2] || "/tmp/shot.png" });

const info = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => el ? (() => { const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; })() : null;
  const cs = (s, p) => { const el = q(s); return el ? getComputedStyle(el)[p] : null; };
  return {
    sidebar: box(q('.sidebar')),
    main: box(q('.app__main')),
    home: box(q('.home')),
    inner: box(q('.home__inner')),
    title: box(q('.home__title')),
    scenes: box(q('.home__scenes')),
    chips: box(q('.home__chips')),
    composer: box(q('.wb-composer--home')),
    practices: box(q('.home__practices')),
    mainBg: cs('.app__main', 'backgroundColor'),
    appBg: cs('.app', 'backgroundColor'),
    sidebarBg: cs('.sidebar', 'backgroundColor'),
    homeBg: cs('.home', 'backgroundColor'),
    bodyFont: cs('body', 'fontFamily'),
    titleFont: cs('.home__title', 'fontFamily'),
    titleSize: cs('.home__title', 'fontSize'),
    sceneTabBg: cs('.home__scene', 'backgroundColor'),
    sceneTabColor: cs('.home__scene', 'color'),
    chipBg: cs('.home__chip', 'backgroundColor'),
    chipBorder: cs('.home__chip', 'border'),
    chipH: box(q('.home__chip'))?.h,
  };
});
console.log(JSON.stringify(info, null, 2));
await app.close();
