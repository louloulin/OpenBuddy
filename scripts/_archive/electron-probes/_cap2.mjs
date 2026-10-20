import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-m-"));
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
await page.waitForTimeout(2500);
const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1728, 1091); });
await page.waitForTimeout(2500);

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const cs = (s,p) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el)[p]; };
  return {
    viewport: { w: innerWidth, h: innerHeight },
    sidebar: b('.sidebar'),
    main: b('.app__main'),
    home: b('.home'),
    inner: b('.home__inner'),
    title: b('.home__title'),
    titleSize: cs('.home__title','fontSize'),
    titleWeight: cs('.home__title','fontWeight'),
    subtitle: b('.home__subtitle'),
    subtitleSize: cs('.home__subtitle','fontSize'),
    scenes: b('.home__scenes'),
    sceneTab: b('.home__scene'),
    sceneTabH: cs('.home__scene','height'),
    sceneTabRadius: cs('.home__scene','borderRadius'),
    sceneTabBg: cs('.home__scene','backgroundColor'),
    sceneTabFont: cs('.home__scene','fontSize'),
    sceneTabPadding: cs('.home__scene','padding'),
    chips: b('.home__chips'),
    chip: b('.home__chip'),
    chipBg: cs('.home__chip','backgroundColor'),
    chipBorderColor: cs('.home__chip','borderColor'),
    chipBorderWidth: cs('.home__chip','borderWidth'),
    chipRadius: cs('.home__chip','borderRadius'),
    chipFont: cs('.home__chip','fontSize'),
    chipColor: cs('.home__chip','color'),
    composerWrap: b('.wb-composer-wrap'),
    composer: b('.wb-composer'),
    composerBg: cs('.wb-composer','backgroundColor'),
    composerBorder: cs('.wb-composer','borderColor'),
    composerRadius: cs('.wb-composer','borderRadius'),
    practices: b('.home__practices'),
    practicesGrid: b('.home__practices-grid'),
    practiceCard: b('.home__practice-card'),
    appBg: cs('.app','backgroundColor'),
    mainBg: cs('.app__main','backgroundColor'),
    sidebarBg: cs('.sidebar','backgroundColor'),
    borderDefault: cs(':root','--wb-border-default'),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
