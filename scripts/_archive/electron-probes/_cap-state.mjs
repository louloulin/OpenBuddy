import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-st-"));
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
await page.setViewportSize({ width: 1728, height: 1091 });
await page.waitForTimeout(1500);

// Check what pages are reachable / current state
const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
  return {
    home: b('.home'),
    chatView: b('[class*="chat-view"], [class*="ChatView"]'),
    composer: b('.wb-composer-wrap'),
    sidebarVisible: !!document.querySelector('.sidebar'),
    sidebarWidth: document.querySelector('.sidebar')?.getBoundingClientRect().width,
    hasSettings: !!document.querySelector('[class*="settings-panel"], [class*="SettingsPanel"]'),
    hasSidebarUser: !!document.querySelector('.sidebar__user'),
    hasNotificationBtn: !!document.querySelector('[aria-label="通知"]'),
    hasSettingsBtn: !!document.querySelector('[aria-label="设置"]'),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
