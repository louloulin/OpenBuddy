import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-tp-"));
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

// Dismiss onboarding
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(500);
await page.waitForSelector("[data-testid='onboarding-wizard']", { state: "hidden", timeout: 5000 }).catch(() => {});
await page.waitForTimeout(500);

const out = {};
await page.click(".main-topbar [aria-label='切换主题']");
await page.waitForTimeout(1000);
const r = await page.evaluate(() => {
  const menu = document.querySelector("[role='menu']");
  const allButtons = menu ? Array.from(menu.querySelectorAll("button")).slice(0, 25).map(b => ({ aria: b.getAttribute("aria-label") || "", text: b.textContent.trim().slice(0, 30) })) : [];
  const sectionHeaders = menu ? Array.from(menu.querySelectorAll("div")).filter(d => d.className && d.className.toString().includes("sectionHeader")).map(d => d.textContent.trim()) : [];
  return { menuPresent: !!menu, buttonCount: allButtons.length, buttons: allButtons.slice(0, 20), sectionHeaders };
});
out.themeMenu = r;
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
out.pageErrors = await page.evaluate(() => window.__PAGE_ERRORS__ || []);
console.log(JSON.stringify(out, null, 2));
await app.close();
