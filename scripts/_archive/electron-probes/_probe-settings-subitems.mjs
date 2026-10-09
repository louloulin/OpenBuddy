import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ssub-"));
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

// Get full nav structure
const nav = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog']");
  const nav = dialog.querySelector(".settings-modal__nav");
  return Array.from(nav.querySelectorAll("button")).map(b => ({
    text: b.textContent.trim().slice(0, 30),
    cls: b.className.toString().slice(0, 60),
  }));
});
console.log("All nav buttons:");
nav.forEach(n => console.log("  ", n.cls, "|", n.text));

// Click "快捷键"
const sc = await page.$(".settings-modal__nav button:has-text('快捷键')");
if (sc) {
  await sc.click();
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog']");
    const main = dialog.querySelector(".settings-modal__content > div");
    return {
      mainText: main ? main.textContent.trim().slice(0, 200) : null,
    };
  });
  console.log("After 快捷键:", JSON.stringify(r));
}

await app.close();
