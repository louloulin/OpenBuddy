import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-fs-"));
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
await win.evaluate((w) => { w.setContentSize(1728, 1031); });
await page.waitForTimeout(2500);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

// Check the various topbar buttons and other UI elements
const out = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const t = (s) => { const el = document.querySelector(s); if (!el) return null; return el.textContent.trim().slice(0, 60); };
  return {
    // Topbar status pill / version
    versionPill: b(".main-topbar__version-pill"),
    versionText: t(".main-topbar__version-pill"),
    // StatusBar items
    statusBar: b("[data-testid='status-bar']"),
    statusBarText: t("[data-testid='status-bar']"),
    // 通知 button - is there a notification badge or anything?
    notifBtn: b(".sidebar__footer .sidebar__icon-btn[aria-label='通知']"),
    notifText: t(".sidebar__footer .sidebar__icon-btn[aria-label='通知']"),
    // Check if 通知 has any badge/counter
    notifBadge: b(".sidebar__footer .sidebar__icon-btn[aria-label='通知'] .badge, .sidebar__footer .sidebar__icon-btn[aria-label='通知'] [class*='badge']"),
    // Main topbar — left side collapse button
    collapseBtn: b(".main-topbar__left .main-topbar__btn"),
    // Search button - is there one?
    searchBtn: b("[aria-label*='搜索']"),
    // Page errors
    pageErrors: window.__PAGE_ERRORS__ || [],
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
