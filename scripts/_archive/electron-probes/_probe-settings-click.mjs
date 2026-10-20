import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-sclk-"));
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
await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1000);

// Find tab buttons
const tabsInfo = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog']");
  // group-header is a top-level button
  const headers = Array.from(dialog.querySelectorAll(".settings-navigation__group-header"));
  return headers.map(h => ({ text: h.textContent.trim().slice(0, 20), ariaSelected: h.getAttribute("aria-selected"), cls: h.className.toString().slice(0, 50) }));
});
console.log("Group headers:", JSON.stringify(tabsInfo, null, 2));

// Click 通用 group header
const firstHeader = await page.$(".settings-navigation__group-header:has-text('通用')");
if (firstHeader) {
  await firstHeader.click();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog']");
    const main = dialog.querySelector(".settings-modal__content > div, .settings-modal__main");
    const active = dialog.querySelector("[class*='active'], [aria-selected='true']");
    return {
      activeTab: active?.textContent.trim().slice(0, 30),
      mainText: main ? main.textContent.trim().slice(0, 200) : null,
    };
  });
  console.log("After 通用 group click:", JSON.stringify(after, null, 2));
}

await app.close();
