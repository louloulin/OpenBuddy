import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-stab-"));
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
await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1000);

// 点击「通用」
await page.click("[role='dialog'] button:has-text('通用')");
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog']");
  if (!dialog) return { error: "no dialog" };
  const main = dialog.querySelector(".settings-modal__content > div, .settings-modal__main, [class*='main']");
  // 检查 active tab
  const allBtns = Array.from(dialog.querySelectorAll("button"));
  const active = allBtns.find(b => b.className.includes("active") || b.getAttribute("aria-selected") === "true");
  return {
    activeTab: active ? active.textContent.trim() : null,
    mainContent: main ? main.textContent.trim().slice(0, 200) : null,
    allHeaders: Array.from(dialog.querySelectorAll("h1, h2, h3, h4, [class*='title']")).slice(0, 5).map(h => h.textContent.trim().slice(0, 40)),
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
