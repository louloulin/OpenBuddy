import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ao-"));
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

const out = {};
// dismiss onboarding
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(500);
await page.waitForSelector("[data-testid='onboarding-wizard']", { state: "hidden", timeout: 5000 }).catch(() => {});
await page.waitForTimeout(500);

// 1. Click user button
await page.click(".sidebar__user");
await page.waitForTimeout(1000);
const userClick = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog']");
  return { dialogCls: dialog ? dialog.className.toString().slice(0, 60) : null };
});
out.userClick = userClick;
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// 2. Click theme button
await page.click(".main-topbar [aria-label='切换主题']").catch(() => {});
await page.waitForTimeout(1000);
const themeClick = await page.evaluate(() => {
  const popups = Array.from(document.querySelectorAll("[class*='theme-picker'], [class*='ThemePicker'], [role='listbox'], [role='dialog']")).map(s => ({ cls: s.className.toString().slice(0, 80), text: s.textContent.trim().slice(0, 100) }));
  return { popups };
});
out.themeClick = themeClick;
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// 3. Click settings icon button (bottom-right)
await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1000);
const settingsClick = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog']");
  return { dialogCls: dialog ? dialog.className.toString().slice(0, 60) : null };
});
out.settingsClick = settingsClick;
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

out.pageErrors = await page.evaluate(() => window.__PAGE_ERRORS__ || []);

console.log(JSON.stringify(out, null, 2));
await app.close();
