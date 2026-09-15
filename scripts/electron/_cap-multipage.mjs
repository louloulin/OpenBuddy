import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-mp-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.setViewportSize({ width: 1728, height: 1091 });
await page.waitForTimeout(1500);

// 1. Home page (default)
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-page-home.png" });

// 2. Click sidebar settings to open settings panel
await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="设置"]');
  if (btn) btn.click();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-page-settings.png" });

// 3. Close settings, open search
await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="搜索"]');
  if (btn) btn.click();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-page-search.png" });

// 4. Close search, open shortcuts
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.keyboard.press('?');
await page.waitForTimeout(1500);
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-page-shortcuts.png" });

// 5. Close shortcuts, collapse sidebar
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="收起侧边栏"]');
  if (btn) btn.click();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-page-collapsed.png" });

await app.close();
console.log("done");
