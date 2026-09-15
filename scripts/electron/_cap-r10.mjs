import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r10-"));
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
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r10-cardsup.png", fullPage: false });

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    title: b('.home__title'),
    scenes: b('.home__scenes'),
    composer: b('.wb-composer'),
    composerMeta: b('.wb-composer-meta'),
    composerArea: b('.home__composer-area'),
    practicesGrid: b('.home__practices-grid'),
    practices: b('.home__practices'),
    onboarding: b('.home__onboarding'),
    card0: b('.home__practice-card:nth-child(1)'),
    card0Thumb: b('.home__practice-card:nth-child(1) .home__practice-card-thumb'),
    card0Caption: b('.home__practice-card:nth-child(1) .home__practice-card-caption'),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
