import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-tt-"));
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
await page.click(".sidebar__conv");
await page.waitForTimeout(1500);

// 找 工作区文件树 button
const fileTree = await page.$(".main-topbar button[aria-label='工作区文件树']");
if (fileTree) {
  await fileTree.click();
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("[class*='file-tree'], [class*='FileTree'], [class*='sidebar__right'], [class*='right-panel']")).map(el => ({
      cls: el.className.toString().slice(0, 50),
      text: el.textContent.trim().slice(0, 80),
      visible: el.getBoundingClientRect().width > 0,
    }));
    return all.slice(0, 5);
  });
  console.log("After 工作区文件树 click:", JSON.stringify(r));
}
await app.close();
