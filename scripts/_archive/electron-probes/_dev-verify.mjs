import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-dev-verify-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30000,
});
const page = await app.firstWindow({ timeout: 30000 });
await page.waitForTimeout(8000);

// Try to dismiss onboarding
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// Probe: theme menu button visible?
const tmBtn = await page.locator("[data-testid='theme-menu-button'] button").first();
console.log("ThemeMenuButton:", await tmBtn.count());

// Probe: sidebar visible?
const sidebar = await page.locator(".sidebar, [class*='Sidebar']").first();
console.log("Sidebar:", await sidebar.count());

// Probe: composer visible?
const composer = await page.locator(".wb-composer, [class*='composer']").first();
console.log("Composer:", await composer.count());

// Probe: status bar visible?
const statusBar = await page.locator(".status-bar, footer").first();
console.log("StatusBar:", await statusBar.count());

// Probe: page errors
const errors = await page.evaluate(() => {
  return window.__PAGE_ERRORS__ || [];
});
console.log("Page errors:", errors.length);

await page.screenshot({ path: "/Users/louloulin/appx/OpenBuddy/tests/screenshots/dev-verify-home.png" });
console.log("Screenshot saved");

// Open ThemePicker to verify the new chip-grid layout
if (await tmBtn.count()) {
  await tmBtn.click();
  await page.waitForTimeout(1000);
  const popover = await page.locator("[role='menu']").first();
  if (await popover.count()) {
    await popover.screenshot({ path: "/Users/louloulin/appx/OpenBuddy/tests/screenshots/dev-verify-theme-picker.png" });
    console.log("ThemePicker screenshot saved");
  }
}

await app.close();
process.exit(0);
