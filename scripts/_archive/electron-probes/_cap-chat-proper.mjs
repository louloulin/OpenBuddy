import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cp-"));
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

// Force light
await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'light');
});
await page.waitForTimeout(500);

// Take home screenshot
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-light.png", fullPage: false });

// Inspect: theme, msg bubble, sidebar, etc
const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const cs = (s, p) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el)[p]; };
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    sidebar: b('.sidebar'),
    main: b('.app__main'),
    home: b('.home'),
    title: b('.home__title'),
    composer: b('.wb-composer'),
    composerBg: cs('.wb-composer','backgroundColor'),
    composerColor: cs('.wb-composer','color'),
    practiceCards: document.querySelectorAll('.home__practice-card').length,
    onboarding: b('.home__onboarding'),
    bgApp: cs('.app','backgroundColor'),
    bgSidebar: cs('.sidebar','backgroundColor'),
    bgMain: cs('.app__main','backgroundColor'),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
