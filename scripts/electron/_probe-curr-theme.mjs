import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-curr-theme-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30000,
});
const page = await app.firstWindow({ timeout: 30000 });
await page.waitForTimeout(8000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1000);

const tmBtn = await page.locator("[data-testid='theme-menu-button'] button").first();
if (await tmBtn.count()) {
  await tmBtn.click({ timeout: 2000 });
  await page.waitForTimeout(1000);
  // Crop to popover area
  const popover = await page.locator("[role='menu']").first();
  if (await popover.count()) {
    await popover.screenshot({ path: "/Users/louloulin/appx/OpenBuddy/tests/screenshots/popover-focused.png" });
    console.log("Popover focused screenshot saved");
  }
  await page.screenshot({ path: "/Users/louloulin/appx/OpenBuddy/tests/screenshots/curr-theme-picker.png" });
}

await app.close();
process.exit(0);
