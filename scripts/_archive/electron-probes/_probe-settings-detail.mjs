import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-sdet-"));
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

const r = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog']");
  if (!dialog) return { error: "no dialog" };
  // 找 dialog 内的 settings-section (主内容区)
  const sections = Array.from(dialog.querySelectorAll("[class*='settings-section'], [class*='settings-tab'], [class*='section-']")).slice(0, 12).map(s => ({
    cls: s.className.toString().slice(0, 50),
    text: s.textContent.trim().slice(0, 80),
  }));
  // 找 dialog 内主内容区 (右侧 panel)
  const main = dialog.querySelector(".settings-modal__content > div, .settings-modal__main, [class*='main']");
  return {
    dialogCls: dialog.className.toString().slice(0, 50),
    sections,
    mainContent: main ? main.textContent.trim().slice(0, 200) : null,
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
