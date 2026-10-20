import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r13-"));
mkdirSync("/tmp/ob-r13", { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, projectRoot],
  executablePath: join(projectRoot, "node_modules", ".bin", "electron"),
  cwd: projectRoot, timeout: 40000,
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

const errs = await page.evaluate(() => window.__PAGE_ERRORS__ || []);
console.log("PAGE ERRORS:", errs.length, errs.length > 0 ? errs.slice(0, 3) : "none");

// Audit: home page elements
const home = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    title: r(".home__title"),
    subtitle: r(".home__subtitle"),
    subtitleText: document.querySelector(".home__subtitle")?.textContent,
    scenes: Array.from(document.querySelectorAll(".home__scene, [role='tab']")).map(t => ({ text: t.textContent?.trim().slice(0, 20), selected: t.getAttribute("aria-selected") })),
    chips: document.querySelectorAll(".home__chip").length,
    composer: r(".composer-shell, [data-composer]"),
  };
});
console.log("\nHome audit:", JSON.stringify(home, null, 2));

// Audit: topbar
const topbar = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    bar: r(".main-topbar"),
    title: r(".main-topbar__title"),
    themeBtn: r(".main-topbar [aria-label='切换主题']"),
    leftBtns: Array.from(document.querySelectorAll(".main-topbar__left button")).map(b => ({ aria: b.getAttribute("aria-label"), tip: b.getAttribute("data-tip") })),
  };
});
console.log("\nTopbar audit:", JSON.stringify(topbar, null, 2));

// Audit: sidebar
const sidebar = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    sidebar: r(".sidebar, aside.sidebar"),
    footer: r(".sidebar__footer"),
    userBtn: r(".sidebar__user"),
    notif: r(".sidebar__icon-btn[aria-label='通知']"),
    settings: r(".sidebar__icon-btn[aria-label='设置']"),
    statusInd: r(".status-indicator"),
    statusText: document.querySelector(".status-indicator")?.textContent?.trim().slice(0, 30),
    dataTips: {
      user: document.querySelector(".sidebar__user")?.getAttribute("data-tip"),
      notif: document.querySelector(".sidebar__icon-btn[aria-label='通知']")?.getAttribute("data-tip"),
      settings: document.querySelector(".sidebar__icon-btn[aria-label='设置']")?.getAttribute("data-tip"),
    },
  };
});
console.log("\nSidebar audit:", JSON.stringify(sidebar, null, 2));

// Audit: status bar
const statusBar = await page.evaluate(() => {
  const sb = document.querySelector("[data-testid='status-bar']");
  if (!sb) return null;
  return { text: sb.textContent?.trim().slice(0, 80) };
});
console.log("\nStatus bar:", JSON.stringify(statusBar, null, 2));

// Switch to dark theme and verify
console.log("\n=== Theme switch test ===");
const beforeTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
await page.click(".main-topbar [aria-label='切换主题']");
await page.waitForTimeout(500);
// Pick a dark theme from the menu
const themes = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("[role='menuitem'], button")).filter(b => b.textContent?.match(/Black|Midnight|openbuddy/i)).map(b => b.textContent?.trim().slice(0, 30)).slice(0, 5);
});
console.log("Available themes:", themes);

await app.close();
