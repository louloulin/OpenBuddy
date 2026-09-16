import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-snav-"));
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

// Test each nav item
const results = [];
const navTexts = ["通用", "快捷键", "个性化", "助理设置", "智能体", "模型", "数据与安全", "关于 OpenBuddy"];
for (const t of navTexts) {
  const btn = await page.$(`[role='dialog'] button:has-text("${t}")`);
  if (btn) {
    await btn.click();
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const dialog = document.querySelector("[role='dialog']");
      if (!dialog) return { error: "no dialog" };
      // 找 dialog 的主内容区
      const main = dialog.querySelector("[class*='content'], [class*='panel'], main, .settings-section, [class*='section']");
      return {
        mainCls: main ? main.className.toString().slice(0, 50) : null,
        mainText: dialog.textContent.trim().slice(0, 100),
        pageErrors: window.__PAGE_ERRORS__ || [],
      };
    });
    results.push({ tab: t, ...r });
  } else {
    results.push({ tab: t, error: "button not found" });
  }
}
console.log(JSON.stringify(results, null, 2));
await app.close();
