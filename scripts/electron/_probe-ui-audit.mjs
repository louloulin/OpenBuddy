import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-audit-"));
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
await win.evaluate((w) => { w.setContentSize(1728, 1091); });
await page.waitForTimeout(2500);

const r = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cs = (s, p) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el)[p]; };
  const text = (s) => { const el = document.querySelector(s); return el ? el.textContent.trim().slice(0, 80) : null; };
  // 收集 sidebar footer 所有按钮 + sidebar__user 状态
  const sb = document.querySelector(".sidebar");
  const sbFooter = sb ? Array.from(sb.querySelectorAll(".sidebar__footer > *, .sidebar__footer *")).slice(-10).map((el) => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: el.className, text: (el.textContent||"").trim().slice(0, 40), aria: el.getAttribute("aria-label") || "", x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }) : [];
  // Topbar
  const tb = document.querySelector(".topbar, [class*='topbar']");
  const tbItems = tb ? Array.from(tb.querySelectorAll("button, [role='button']")).slice(0, 12).map((el) => {
    const r = el.getBoundingClientRect();
    return { cls: el.className, text: (el.textContent||"").trim().slice(0, 30), aria: el.getAttribute("aria-label") || "", x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }) : [];
  // Status bar (if exists)
  const status = document.querySelector(".status-bar, [class*='StatusBar']");
  // Footer area
  const footer = document.querySelector(".sidebar__footer");
  const fRect = footer ? (() => { const r = footer.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() : null;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    sidebar: b(".sidebar"),
    topbar: tb ? (() => { const r = tb.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
    sbFooter: fRect,
    sbFooterItems: sbFooter,
    topbarItems: tbItems,
    statusBar: status ? (() => { const r = status.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: status.textContent.trim().slice(0, 200) }; })() : null,
    userBtn: b(".sidebar__user"),
    userText: text(".sidebar__user-name"),
    userSub: text(".sidebar__user-sub"),
    sessionList: b(".sidebar__session-list, .sidebar__sessions, [class*='session-list']"),
    sidebarContent: b(".sidebar__content, .sidebar__scroll"),
    onboardingVisible: !!document.querySelector("[class*='onboarding'], [data-onboarding]"),
    pageErrors: window.__PAGE_ERRORS__ || [],
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
