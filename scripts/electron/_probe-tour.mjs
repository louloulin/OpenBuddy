import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-tour-"));
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

// Close wizard if open
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(2000);  // wait for tour to auto-open

const tourVisible = await page.evaluate(() => {
  const spot = document.querySelector("[data-testid='tour-spotlight']");
  return {
    spotExists: !!spot,
    hasHole: spot?.dataset.hasHole,
    zIndex: spot?.style.zIndex,
  };
});
console.log("After onboarding closed, tour state:", JSON.stringify(tourVisible));

// Try Escape
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const afterEsc = await page.evaluate(() => ({
  spotExists: !!document.querySelector("[data-testid='tour-spotlight']"),
  tourCard: document.querySelector("[data-testid='tour-card']")?.textContent.trim().slice(0, 80),
}));
console.log("After Escape:", JSON.stringify(afterEsc));

// Try clicking the scrim (outside the hole)
await page.mouse.click(100, 500);
await page.waitForTimeout(500);
const afterClick = await page.evaluate(() => ({
  spotExists: !!document.querySelector("[data-testid='tour-spotlight']"),
}));
console.log("After scrim click:", JSON.stringify(afterClick));

await app.close();
