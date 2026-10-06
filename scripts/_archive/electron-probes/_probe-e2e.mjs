import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-e2e-"));
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
const errors = [];

// 1. 关闭引导
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

// 2. 验证首页 UI 完整
const home = await page.evaluate(() => ({
  sidebar: !!document.querySelector(".sidebar"),
  topbar: !!document.querySelector(".main-topbar"),
  topbarBtns: document.querySelectorAll(".main-topbar button").length,
  userBtn: !!document.querySelector(".sidebar__user"),
  sceneTabs: document.querySelectorAll(".home__scene").length,
  composer: !!document.querySelector(".wb-composer"),
  statusBar: !!document.querySelector("[data-testid='status-bar']"),
}));
console.log("Home UI:", JSON.stringify(home));

// 3. 点击 session
await page.click(".sidebar__conv");
await page.waitForTimeout(1200);
const session = await page.evaluate(() => ({
  topbarBtns: document.querySelectorAll(".main-topbar button").length,
  chatview: !!document.querySelector(".chatview"),
  composer: !!document.querySelector(".wb-composer"),
}));
console.log("Session UI:", JSON.stringify(session));

// 4. 切换主题 (light → Claude dark)
await page.click(".main-topbar [aria-label='切换主题']");
await page.waitForTimeout(600);
await page.click("[role='menu'] button:has-text('Claude')");
await page.waitForTimeout(1000);
const theme = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute("data-theme"),
  themeName: document.documentElement.getAttribute("data-theme-name"),
}));
console.log("After Claude theme:", JSON.stringify(theme));

// 5. 切换回 openbuddy
await page.click(".main-topbar [aria-label='切换主题']");
await page.waitForTimeout(500);
const obBtn = await page.$("[role='menu'] button:has-text('OpenBuddy')");
if (obBtn) {
  await obBtn.click();
  await page.waitForTimeout(800);
}

// 6. 打开设置
await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(800);
const settings = await page.evaluate(() => !!document.querySelector(".settings-modal"));
console.log("Settings opens:", settings);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// 7. 回到首页
await page.click(".sidebar__nav-item:nth-child(1)"); // 新建任务
await page.waitForTimeout(800);
const backHome = await page.evaluate(() => !!document.querySelector(".home"));
console.log("Back to home:", backHome);

// 8. 错误检查
const errs = await page.evaluate(() => window.__PAGE_ERRORS__ || []);
console.log("Page errors:", errs.length, errs.slice(0, 3));

await app.close();
