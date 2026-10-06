import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-tour2-"));
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

// Don't close wizard - just wait
await page.waitForTimeout(3000);
const wizard = await page.evaluate(() => ({
  wizardExists: !!document.querySelector("[data-testid='onboarding-wizard']"),
  tourSpotExists: !!document.querySelector("[data-testid='tour-spotlight']"),
}));
console.log("Initial state:", JSON.stringify(wizard));

// Walk through wizard normally (next → next → done)
const nextBtn = await page.$("[data-testid='onboarding-wizard'] button:has-text('下一步')");
if (nextBtn) {
  await nextBtn.click();
  await page.waitForTimeout(800);
  await nextBtn.click();
  await page.waitForTimeout(800);
  // Step 3 - might be "完成" or "开始使用"
  const done = await page.$("[data-testid='onboarding-wizard'] button:has-text('完成'), [data-testid='onboarding-wizard'] button:has-text('开始')");
  if (done) await done.click();
  await page.waitForTimeout(2000);
}

const afterWalk = await page.evaluate(() => ({
  wizardExists: !!document.querySelector("[data-testid='onboarding-wizard']"),
  tourSpotExists: !!document.querySelector("[data-testid='tour-spotlight']"),
  tourStorage: window.localStorage.getItem("openbuddy.onboarding.tour"),
}));
console.log("After walk-through:", JSON.stringify(afterWalk));

await app.close();
