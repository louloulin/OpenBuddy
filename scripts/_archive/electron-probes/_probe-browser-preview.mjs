import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-bp-"));
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

const browserPreview = await page.$(".main-topbar button[aria-label='网页预览']");
if (browserPreview) {
  await browserPreview.click();
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const browser = document.querySelector("[class*='browser'], [class*='Browser'], iframe");
    const all = Array.from(document.querySelectorAll("[class*='overlay'], [class*='modal']")).slice(0, 5).map(el => ({
      cls: el.className.toString().slice(0, 50),
      text: el.textContent.trim().slice(0, 80),
      visible: el.getBoundingClientRect().width > 0,
    }));
    return { all };
  });
  console.log("After 网页预览 click:", JSON.stringify(r));
}
await app.close();
