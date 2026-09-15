import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-df-"));
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

await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.waitForTimeout(1500);

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
  return {
    userBtn: b('.sidebar__user'),
    notifBtn: b('[aria-label="通知"]'),
    settingsBtn: b('[aria-label="设置"]'),
    userBtnText: document.querySelector('.sidebar__user span')?.textContent,
    userBtnColor: getComputedStyle(document.querySelector('.sidebar__user'))?.color,
    userBtnBg: getComputedStyle(document.querySelector('.sidebar__user'))?.backgroundColor,
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
