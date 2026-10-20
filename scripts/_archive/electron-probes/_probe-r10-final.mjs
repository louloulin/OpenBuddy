import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r10-"));
mkdirSync("/tmp/openbuddy-shots", { recursive: true });
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

// Final state probe
const out = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const t = (s) => { const el = document.querySelector(s); return el ? el.textContent.trim().slice(0, 80) : null; };
  // R10 verification: topbar + user button
  return {
    topbar: b(".main-topbar"),
    topbarTitle: t(".main-topbar__title"),
    topbarEditVisible: !!document.querySelector(".main-topbar__title-edit"),
    topbarThemeBtn: b(".main-topbar [aria-label='切换主题']"),
    topbarSearchBtn: b(".main-topbar [aria-label*='搜索']"),
    userBtn: b(".sidebar__user"),
    userName: t(".sidebar__user-name"),
    userSub: t(".sidebar__user-sub"),
    userNameOverflow: (() => {
      const n = document.querySelector(".sidebar__user-name");
      return n ? n.scrollWidth > n.clientWidth : null;
    })(),
    userSubOverflow: (() => {
      const n = document.querySelector(".sidebar__user-sub");
      return n ? n.scrollWidth > n.clientWidth : null;
    })(),
    notifBtn: b(".sidebar__footer .sidebar__icon-btn[aria-label='通知']"),
    settingsBtn: b(".sidebar__footer .sidebar__icon-btn[aria-label='设置']"),
    statusBar: b("[data-testid='status-bar']"),
    statusBarText: t("[data-testid='status-bar']"),
    sbFooter: b(".sidebar__footer"),
    pageErrors: window.__PAGE_ERRORS__ || [],
  };
});
console.log("=== R10 Final State ===");
console.log(JSON.stringify(out, null, 2));

// Test 1: Click user button → settings
await page.click(".sidebar__user");
await page.waitForTimeout(800);
const settingsResult = await page.evaluate(() => ({
  dialog: document.querySelector("[role='dialog']")?.className.toString().slice(0, 60),
  dialogText: document.querySelector("[role='dialog']")?.textContent.trim().slice(0, 80),
}));
console.log("\n=== Click .sidebar__user ===");
console.log(JSON.stringify(settingsResult, null, 2));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// Test 2: Click 通知 button
await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='通知']");
await page.waitForTimeout(800);
const notifResult = await page.evaluate(() => ({
  dialog: document.querySelector("[role='dialog']")?.className.toString().slice(0, 60),
  dialogText: document.querySelector("[role='dialog']")?.textContent.trim().slice(0, 80),
}));
console.log("\n=== Click 通知 ===");
console.log(JSON.stringify(notifResult, null, 2));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// Test 3: Click 设置 button (sidebar footer)
await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(800);
const settings2 = await page.evaluate(() => ({
  dialog: document.querySelector("[role='dialog']")?.className.toString().slice(0, 60),
  dialogText: document.querySelector("[role='dialog']")?.textContent.trim().slice(0, 80),
}));
console.log("\n=== Click 设置 (sidebar footer) ===");
console.log(JSON.stringify(settings2, null, 2));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// Test 4: Click theme picker
await page.click(".main-topbar [aria-label='切换主题']");
await page.waitForTimeout(800);
const themeResult = await page.evaluate(() => ({
  menuVisible: !!document.querySelector("[role='menu']"),
  buttonCount: document.querySelectorAll("[role='menu'] button").length,
  themes: Array.from(document.querySelectorAll("[role='menu'] button")).slice(0, 5).map(b => b.textContent.trim().slice(0, 30)),
}));
console.log("\n=== Click theme picker ===");
console.log(JSON.stringify(themeResult, null, 2));
await page.keyboard.press("Escape");

await app.close();
