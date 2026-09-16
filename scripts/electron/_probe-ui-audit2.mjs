/** 全面 UI 现状探针 — 检查 React #185 + session 滚动 + menu bar + footer 三件套 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-audit-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });

// Install error capture EARLY
await page.addInitScript(() => {
  window.__PAGE_ERRORS__ = [];
  window.__CONSOLE_ERRORS__ = [];
  window.addEventListener("error", (e) => window.__PAGE_ERRORS__.push({ msg: String(e.error?.message ?? e.message), stack: String(e.error?.stack ?? "").slice(0, 600) }));
  window.addEventListener("unhandledrejection", (e) => window.__PAGE_ERRORS__.push({ msg: "UnhandledRejection: " + String(e.reason?.message ?? e.reason), stack: String(e.reason?.stack ?? "").slice(0, 600) }));
  const origError = console.error;
  console.error = (...a) => { window.__CONSOLE_ERRORS__.push(a.map(String).join(" ")); origError.apply(console, a); };
});

await page.waitForTimeout(14_000);

// Click on a few things to trigger navigation/rerenders
try {
  await page.evaluate(() => {
    const btns = ["新建任务", "展开侧边栏", "切换主题", "设置", "通知", "OpenBuddy"];
    for (const label of btns) {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.getAttribute("aria-label") || x.textContent || "").includes(label));
      if (b) b.click();
    }
  });
} catch {}
await page.waitForTimeout(4000);

const out = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const q = (s) => Array.from(document.querySelectorAll(s));
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    consoleErrors: window.__CONSOLE_ERRORS__ || [],
    window: { w: innerWidth, h: innerHeight },
    sidebar: {
      visible: !!document.querySelector(".sidebar")?.offsetParent,
      rect: r(".sidebar"),
      footerRect: r(".sidebar__footer"),
      userRect: r(".sidebar__user"),
      userText: document.querySelector(".sidebar__user")?.textContent?.replace(/\s+/g, " ").trim(),
      userVisible: !!document.querySelector(".sidebar__user")?.offsetParent,
      bellRect: r(".sidebar__icon-btn[aria-label='通知']"),
      setRect: r(".sidebar__icon-btn[aria-label='设置']"),
      statusIndicator: r(".status-indicator, .sidebar__footer .sidebar__status"),
      sessionListScrollable: (() => {
        const el = document.querySelector(".sidebar__content");
        if (!el) return null;
        return { scrollH: el.scrollHeight, clientH: el.clientHeight, canScroll: el.scrollHeight > el.clientHeight, overflowY: getComputedStyle(el).overflowY };
      })(),
      sessionListChildren: document.querySelector(".sidebar__content")?.children.length,
    },
    topbar: {
      rect: r(".main-topbar"),
      items: q(".main-topbar__btn").map(b => b.getAttribute("aria-label")),
      titleText: document.querySelector(".main-topbar__title")?.textContent?.trim(),
      themeBtnRect: r(".main-topbar__right, .theme-menu-button"),
      hasRight: !!document.querySelector(".main-topbar__right"),
    },
    statusBar: r(".status-bar, .app__statusbar, footer[role='status']"),
    errorBoundary: q(".error-boundary, [class*='error']").map(e => e.textContent?.trim().slice(0, 80)),
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
