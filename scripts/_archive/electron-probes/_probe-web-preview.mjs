import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-wp-"));
mkdirSync("/tmp/ob-wp", { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, projectRoot],
  executablePath: join(projectRoot, "node_modules", ".bin", "electron"),
  cwd: projectRoot, timeout: 40000,
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

// Hover 更多 to open dropdown
await page.hover(".sidebar__more-wrap");
await page.waitForTimeout(600);

// Click "网页预览"
await page.click("text=网页预览");
await page.waitForTimeout(1000);

// Take screenshot
await page.screenshot({ path: "/tmp/ob-wp/after-web-preview.png" });

// Inspect what's rendered
const viewState = await page.evaluate(() => {
  const bp = document.querySelector(".browser-preview");
  const ph = document.querySelector(".placeholder-page, [class*='placeholder']");
  const input = document.querySelector(".browser-preview__input");
  const empty = document.querySelector(".browser-preview__empty");
  const main = document.querySelector(".app__main, main");
  return {
    hasBrowserPreview: !!bp,
    hasPlaceholder: !!ph,
    hasInput: !!input,
    inputPlaceholder: input?.getAttribute("placeholder"),
    inputValue: input?.getAttribute("value"),
    hasEmpty: !!empty,
    emptyText: empty?.textContent,
    mainContent: (main?.textContent || "").replace(/\s+/g, " ").slice(0, 200),
  };
});
console.log("After click 网页预览:", JSON.stringify(viewState, null, 2));

await app.close();
