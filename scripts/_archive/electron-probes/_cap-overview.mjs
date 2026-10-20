import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ov-"));
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
await page.waitForTimeout(2000);

await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'light');
});
await page.waitForTimeout(500);

// Comprehensive UI state
const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    sidebar: b('.sidebar'),
    main: b('.app__main'),
    home: b('.home'),
    title: b('.home__title'),
    scenes: b('.home__scenes'),
    chips: b('.home__chips'),
    composer: b('.wb-composer'),
    practiceGrid: b('.home__practices-grid'),
    firstCard: b('.home__practice-card'),
    onboarding: b('.home__onboarding'),
    sidebarFooter: b('.sidebar__footer'),
    userAvatar: b('.sidebar__user-avatar'),
    userName: b('.sidebar__user-name'),
  };
});
console.log(JSON.stringify(m, null, 2));

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r9-overview.png", fullPage: false });
await app.close();
