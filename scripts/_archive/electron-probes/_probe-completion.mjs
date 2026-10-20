import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-completion-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30000,
});
const page = await app.firstWindow({ timeout: 30000 });
await page.waitForTimeout(8000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(800);

// Set dark theme
await page.evaluate(() => {
  localStorage.setItem("openbuddy.theme", "dark");
  localStorage.setItem("openbuddy.theme.name", "openbuddy-dark");
  localStorage.setItem("openbuddy.theme.mode", "manual");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(800);

// Try to type into the composer textarea
const ta = await page.locator("textarea.wb-composer__input").first();
console.log("Textarea count:", await ta.count());
if (await ta.count()) {
  await ta.click();
  await page.waitForTimeout(300);
  // Type "/" to trigger slash command menu
  await ta.fill("/");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/Users/louloulin/appx/OpenBuddy/tests/screenshots/dark-slash.png" });
  console.log("Dark slash screenshot saved");
  
  // Now type "@" to trigger mention picker  
  await ta.fill("");
  await ta.fill("@");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/Users/louloulin/appx/OpenBuddy/tests/screenshots/dark-mention.png" });
  console.log("Dark mention screenshot saved");
}

// Switch to light theme
await page.evaluate(() => {
  localStorage.setItem("openbuddy.theme", "light");
  localStorage.setItem("openbuddy.theme.name", "openbuddy");
  localStorage.setItem("openbuddy.theme.mode", "manual");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(800);

const ta2 = await page.locator("textarea.wb-composer__input").first();
if (await ta2.count()) {
  await ta2.click();
  await page.waitForTimeout(300);
  await ta2.fill("/");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/Users/louloulin/appx/OpenBuddy/tests/screenshots/light-slash.png" });
  console.log("Light slash screenshot saved");
  
  await ta2.fill("");
  await ta2.fill("@");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/Users/louloulin/appx/OpenBuddy/tests/screenshots/light-mention.png" });
  console.log("Light mention screenshot saved");
}

await app.close();
process.exit(0);
