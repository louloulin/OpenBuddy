import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ts-"));
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

// 打开设置,点 个性化 (Theme Studio 在那里)
await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1000);
const settingsTabs = await page.$$(".settings-modal__nav button");
console.log("Settings tabs count:", settingsTabs.length);
// 找 个性化
const personalize = await page.$(".settings-modal__nav button:has-text('个性化')");
if (personalize) {
  await personalize.click();
  await page.waitForTimeout(800);
}

const r = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog']");
  if (!dialog) return { error: "no dialog" };
  // 找 ThemeStudio / 主题相关
  const studio = dialog.querySelector("[class*='theme-studio'], [class*='ThemeStudio'], [class*='theme-studio__']");
  const allClasses = (sel) => Array.from(dialog.querySelectorAll(sel)).slice(0, 5).map(el => ({ cls: el.className.toString().slice(0, 50), text: el.textContent.trim().slice(0, 30) }));
  return {
    hasStudio: !!studio,
    studioText: studio ? studio.textContent.trim().slice(0, 100) : null,
    contentText: dialog.querySelector(".settings-modal__content")?.textContent.trim().slice(0, 200),
    buttons: allClasses("button"),
    inputs: allClasses("input, [role='slider']"),
  };
});
console.log("Settings (个性化):", JSON.stringify(r, null, 2));
await app.close();
