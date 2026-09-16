import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-uwide-"));
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
  const allAriaBtns = (scope) => Array.from(scope.querySelectorAll("button, [role='button']")).map(el => ({ aria: el.getAttribute("aria-label") || "", text: (el.textContent||"").trim().slice(0, 25), visible: el.getBoundingClientRect().width > 0 }));
  return {
    // 顶栏按钮全集
    topbar: b(".main-topbar"),
    topbarAllBtns: allAriaBtns(document.querySelector(".main-topbar")),
    // 侧栏顶部按钮
    sidebarHeader: b(".sidebar__top, .sidebar > div:first-child"),
    sidebarTopBtns: allAriaBtns(document.querySelector(".sidebar__top") || document.querySelector(".sidebar > div:first-child") || document.body),
    // sidebar 滚动条 — 用户要求常驻
    sidebarContent: b(".sidebar__content, .sidebar__scroll, .sidebar__nav"),
    sidebarContentScrollbar: (() => {
      const el = document.querySelector(".sidebar__content, .sidebar__scroll, .sidebar__nav");
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        overflow: cs.overflow,
        overflowY: cs.overflowY,
        scrollbarColor: cs.scrollbarColor,
        scrollbarWidth: cs.scrollbarWidth,
      };
    })(),
    // session 列表
    sessionList: b(".sidebar__session-list, .sidebar__sessions, [class*='session']"),
    sidebarAllText: (document.querySelector(".sidebar__content, .sidebar__scroll") || document.querySelector(".sidebar")).textContent.trim().slice(0, 200),
    // 主题切换实际生效
    documentTheme: document.documentElement.getAttribute("data-theme"),
    documentThemeName: document.documentElement.getAttribute("data-theme-name"),
    bodyClass: document.body.className,
    pageErrors: window.__PAGE_ERRORS__ || [],
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
