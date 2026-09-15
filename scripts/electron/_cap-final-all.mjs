import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-fa-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.setViewportSize({ width: 1728, height: 1091 });
await page.waitForTimeout(1500);

const results = {};

// 1. Light mode expanded
await page.screenshot({ path: "/Users/louloulin/Downloads/final-light-expanded.png" });
results.light = "captured";

// 2. Light mode collapsed
await page.evaluate(() => document.querySelector('[aria-label="收起侧边栏"]')?.click());
await page.waitForTimeout(1500);
await page.screenshot({ path: "/Users/louloulin/Downloads/final-light-collapsed.png" });
results.collapsed = "captured";

// 3. Dark mode
await page.evaluate(() => document.querySelector('[aria-label="展开侧边栏"]')?.click());
await page.waitForTimeout(800);
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.waitForTimeout(1500);
await page.screenshot({ path: "/Users/louloulin/Downloads/final-dark.png" });
results.dark = "captured";

console.log(JSON.stringify({results, errors: errors.length}, null, 2));
errors.forEach(e => console.log(" ", e));
await app.close();
