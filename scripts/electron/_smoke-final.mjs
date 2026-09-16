import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-smoke-final-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30000,
});
const page = await app.firstWindow({ timeout: 30000 });
await page.waitForTimeout(8000);

// Capture page errors
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push("CONSOLE: " + msg.text());
});

// Dismiss onboarding
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 }).catch(() => {});
await page.waitForTimeout(1500);

// Probe DOM presence
const probes = await page.evaluate(() => {
  const result = {};
  result.titlebar = !!document.querySelector(".titlebar, [data-testid='titlebar']");
  result.sidebar = !!document.querySelector(".sidebar, [class*='Sidebar'], [class*='sidebar']");
  result.composer = !!document.querySelector(".wb-composer, [class*='composer']");
  result.composerInput = !!document.querySelector(".wb-composer__input");
  result.topbar = !!document.querySelector(".main-topbar, [class*='topbar']");
  result.themeMenuButton = !!document.querySelector("[data-testid='theme-menu-button']");
  result.statusBar = !!document.querySelector(".status-bar, [class*='status-bar']");
  result.dataTheme = document.documentElement.getAttribute("data-theme");
  result.dataThemeName = document.documentElement.getAttribute("data-theme-name");
  result.bodyClass = document.body.className;
  return result;
});
console.log("DOM probes:", JSON.stringify(probes, null, 2));

// Open ThemePicker to verify cabinet-style grid
const tmBtn = await page.locator("[data-testid='theme-menu-button'] button").first();
if (await tmBtn.count()) {
  await tmBtn.click();
  await page.waitForTimeout(800);
  const popover = await page.locator("[role='menu']").first();
  if (await popover.count()) {
    const popoverInfo = await popover.evaluate((el) => {
      const cs = getComputedStyle(el);
      const grid = el.querySelector("[class*='grid']");
      return {
        width: cs.width,
        themeButtons: el.querySelectorAll("button[data-theme-name]").length,
        hasGrid: !!grid,
        gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      };
    });
    console.log("ThemePicker:", JSON.stringify(popoverInfo, null, 2));
    await popover.screenshot({ path: "/Users/louloulin/appx/OpenBuddy/tests/screenshots/smoke-final-theme-picker.png" });
  } else {
    console.log("ThemePicker: NOT FOUND");
  }
  // Close popover
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

// Take final home screenshot
await page.screenshot({ path: "/Users/louloulin/appx/OpenBuddy/tests/screenshots/smoke-final-home.png" });

console.log("\nPage errors during run:", errors.length);
errors.slice(0, 5).forEach((e) => console.log("  -", e));

await app.close();
process.exit(0);
