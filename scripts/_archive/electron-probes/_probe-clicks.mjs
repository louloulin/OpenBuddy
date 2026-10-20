import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cl-"));
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

// 1. Click user button → expect settings panel
await page.click(".sidebar__user");
await page.waitForTimeout(1000);
const userClick = await page.evaluate(() => {
  const overlay = document.querySelector("[class*='settings']");
  const allOverlays = Array.from(document.querySelectorAll("[role='dialog'], .overlay, [class*='Overlay'], [class*='overlay']")).map(s => s.className.toString().slice(0, 40));
  return { overlayClass: overlay ? overlay.className.toString().slice(0, 60) : null, allOverlays };
});
out.userClick = userClick;
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// 2. Click theme button
await page.click(".main-topbar [aria-label='切换主题']");
await page.waitForTimeout(1000);
const themeClick = await page.evaluate(() => {
  const popups = Array.from(document.querySelectorAll("[role='listbox'], [role='dialog'], [class*='popup'], [class*='menu']")).map(s => ({ cls: s.className.toString().slice(0, 60), text: s.textContent.trim().slice(0, 60) }));
  return { popups };
});
out.themeClick = themeClick;
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// 3. Page errors check
const errs = await page.evaluate(() => window.__PAGE_ERRORS__ || []);
out.pageErrors = errs;

console.log(JSON.stringify(out, null, 2));
await app.close();
