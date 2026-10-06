import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-qs-"));
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

const out = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const c = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 8).map(el => ({ cls: el.className.toString().slice(0, 40), text: (el.textContent||"").trim().slice(0, 30), y: Math.round(el.getBoundingClientRect().y) }));
  // 检查 sidebar 顶部的 logo 区 + 折叠按钮
  return {
    sidebarTop: b(".sidebar__logo-col"),
    logoText: document.querySelector(".sidebar__logo")?.textContent.trim(),
    version: document.querySelector(".sidebar__version")?.textContent.trim(),
    collapseBtn: b(".sidebar__icon-btn[aria-label='收起侧边栏']"),
    mainTopbarLeft: b(".main-topbar__left"),
    mainTopbarBtns: c(".main-topbar__left .main-topbar__btn"),
    mainTopbarRight: b(".main-topbar__right"),
    mainTopbarRightBtns: c(".main-topbar__right button, .main-topbar__right [role='button']"),
    // 状态栏内容
    statusBarLeft: document.querySelector("[data-testid='status-bar'] > div:first-child")?.textContent.trim().slice(0, 100),
    statusBarRight: document.querySelector("[data-testid='status-bar'] > div:last-child")?.textContent.trim().slice(0, 100),
    pageErrors: window.__PAGE_ERRORS__ || [],
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
