/** 走一遍所有侧栏入口，确认每个都能正常渲染 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ct-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(4000);

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const results = {};

// Click each nav item
const navItems = await page.$$(".sidebar__nav-item");
console.log(`Found ${navItems.length} nav items`);

for (let i = 0; i < navItems.length; i++) {
  const items = await page.$$(".sidebar__nav-item");
  if (!items[i]) break;
  const label = await items[i].textContent();
  await items[i].click();
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => ({
    mainText: document.querySelector(".app__main")?.textContent?.trim().slice(0, 100),
    hasError: !!document.querySelector("[class*='error'], [data-error]"),
    homeVisible: !!document.querySelector(".home"),
    placeholderText: document.querySelector("[class*='placeholder']")?.textContent?.trim().slice(0, 50),
  }));
  results[label?.trim().slice(0, 20) || `item_${i}`] = state;
}

console.log(JSON.stringify(results, null, 2));
console.log("\nPage errors:", errors.length);
for (const e of errors.slice(0, 5)) console.log("  -", e.slice(0, 150));

await app.close();
