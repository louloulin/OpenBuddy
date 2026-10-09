import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-nt-"));
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

const before = await page.evaluate(() => ({
  activeNav: document.querySelector(".sidebar__nav-item--act")?.textContent.trim(),
  hasSession: !!document.querySelector(".main-topbar__title-edit"),
}));
console.log("Before:", JSON.stringify(before));

await page.click(".main-topbar__btn[aria-label='新建任务']");
await page.waitForTimeout(1500);

const after = await page.evaluate(() => ({
  activeNav: document.querySelector(".sidebar__nav-item--act")?.textContent.trim(),
  hasSession: !!document.querySelector(".main-topbar__title-edit"),
  title: document.querySelector(".main-topbar__title")?.textContent.trim().slice(0, 30),
  pageErrors: window.__PAGE_ERRORS__ || [],
}));
console.log("After click 新建任务:", JSON.stringify(after));
await app.close();
