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
await page.waitForTimeout(2500);
const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1728, 1031); });
await page.waitForTimeout(2500);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

const tabs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll(".home__scene")).map(el => ({ text: el.textContent.trim().slice(0, 20), active: el.className.includes("active"), aria: el.getAttribute("aria-selected") }));
});
console.log("Scene tabs:", JSON.stringify(tabs));

// Click "代码开发"
const code = await page.$(".home__scene:has-text('代码开发')");
if (code) {
  await code.click();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll(".home__scene")).map(el => ({ text: el.textContent.trim().slice(0, 20), active: el.className.includes("active") }));
    const practiceCards = Array.from(document.querySelectorAll(".home__practice-card")).map(el => el.textContent.trim().slice(0, 30));
    return { tabs, practiceCards: practiceCards.slice(0, 5) };
  });
  console.log("After code click:", JSON.stringify(after, null, 2));
}

await app.close();
