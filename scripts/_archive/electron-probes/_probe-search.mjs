import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-srch-"));
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
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  // Find search button or kbd shortcut hint
  const searchBtn = document.querySelector(".sidebar__icon-btn[aria-label='搜索']");
  const kbd = document.querySelector("[class*='kbd']");
  const topbar = document.querySelector(".main-topbar");
  return {
    searchBtn: searchBtn ? { y: Math.round(searchBtn.getBoundingClientRect().y), x: Math.round(searchBtn.getBoundingClientRect().x) } : null,
    kbd: kbd ? kbd.textContent.trim() : null,
    topbarSearch: topbar ? topbar.querySelector("[aria-label*='搜索']")?.outerHTML.slice(0, 100) : null,
    // 搜索 button 在 sidebar, 不在 topbar. Check if kbd hint shows
    topbarKbdHint: topbar ? Array.from(topbar.querySelectorAll("kbd, [class*='shortcut']")).map(el => el.textContent.trim()).join(" | ") : null,
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
