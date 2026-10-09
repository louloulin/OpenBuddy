import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cmp-"));
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
await win.evaluate((w) => { w.setContentSize(1728, 1091); });
await page.waitForTimeout(3000);

const out = process.argv[2] || "/Users/louloulin/Downloads/ob-now.png";
await page.screenshot({ path: out });
const m = await page.evaluate(() => {
  const g = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const cs = (s,p) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el)[p]; };
  const cards = [...document.querySelectorAll('.home__practice-card')].map(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});
  return {
    viewport: { w: innerWidth, h: innerHeight },
    sidebar: g('.sidebar'), main: g('.app__main'), home: g('.home'), inner: g('.home__inner'),
    title: g('.home__title'), titleSize: cs('.home__title','fontSize'), titleWeight: cs('.home__title','fontWeight'),
    subtitle: g('.home__subtitle'),
    scenes: g('.home__scenes'), scene: g('.home__scene'),
    sceneH: cs('.home__scene','height'), sceneBg: cs('.home__scene','backgroundColor'), sceneRadius: cs('.home__scene','borderRadius'), sceneFont: cs('.home__scene','fontSize'), scenePad: cs('.home__scene','padding'), sceneGap: cs('.home__scenes','gap'),
    chips: g('.home__chips'), chip: g('.home__chip'), chipBg: cs('.home__chip','backgroundColor'), chipBorder: cs('.home__chip','borderColor'), chipRadius: cs('.home__chip','borderRadius'), chipFont: cs('.home__chip','fontSize'), chipH: cs('.home__chip','height'), chipPad: cs('.home__chip','padding'),
    composer: g('.wb-composer'), composerBorder: cs('.wb-composer','borderColor'), composerRadius: cs('.wb-composer','borderRadius'), composerBg: cs('.wb-composer','backgroundColor'),
    composerWrap: g('.wb-composer-wrap'),
    practices: g('.home__practices'), grid: g('.home__practices-grid'), gridDisplay: cs('.home__practices-grid','display'), gridCols: cs('.home__practices-grid','gridTemplateColumns'), gridGap: cs('.home__practices-grid','gap'),
    cards,
    appBg: cs('.app','backgroundColor'), mainBg: cs('.app__main','backgroundColor'), sidebarBg: cs('.sidebar','backgroundColor'), sidebarW: cs('.sidebar','width'),
    borderDefault: cs(':root','--wb-border-default'),
  };
});
console.log(JSON.stringify(m, null, 1));
await app.close();
// append more queries
