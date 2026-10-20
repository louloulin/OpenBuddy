import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-now-"));
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
await page.screenshot({ path: "/tmp/home-now.png", fullPage: false });
const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {y: Math.round(r.y), h: Math.round(r.height)}; };
  return {
    vh: innerHeight,
    hero: b('.home__hero'),
    composerWrap: b('.wb-composer-wrap'),
    composer: b('.wb-composer'),
    practices: b('.home__practices'),
    practicesGrid: b('.home__practices-grid'),
    practiceCard: b('.home__practice-card'),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
