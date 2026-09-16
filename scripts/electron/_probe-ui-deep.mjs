import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-deep-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });

// Install error capture EARLY (before any script)
await page.addInitScript(() => {
  window.__PAGE_ERRORS__ = [];
  window.__CONSOLE_ERRORS__ = [];
  window.addEventListener("error", (e) => window.__PAGE_ERRORS__.push({ msg: String(e.error?.message ?? e.message), stack: String(e.error?.stack ?? "").slice(0, 800) }));
  window.addEventListener("unhandledrejection", (e) => window.__PAGE_ERRORS__.push({ msg: "UnhandledRejection: " + String(e.reason?.message ?? e.reason), stack: String(e.reason?.stack ?? "").slice(0, 800) }));
  const origError = console.error;
  console.error = (...a) => { window.__CONSOLE_ERRORS__.push(a.map((x) => typeof x === "string" ? x : (x?.message ?? String(x))).join(" ").slice(0, 600)); origError.apply(console, a); };
});

await page.waitForTimeout(14_000);

const out = await page.evaluate(() => {
  const r = (s) => { const el = typeof s === "string" ? document.querySelector(s) : s; if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const q = (s) => Array.from(document.querySelectorAll(s));
  // Topbar children detail
  const topbarEl = document.querySelector(".main-topbar");
  const topbarRect = topbarEl ? topbarEl.getBoundingClientRect() : null;
  const topbarChildren = topbarEl ? Array.from(topbarEl.children).map((c) => {
    const rect = c.getBoundingClientRect();
    return { tag: c.tagName.toLowerCase(), cls: (c.className || "").toString().slice(0, 40), label: c.getAttribute("aria-label") || c.textContent?.trim().slice(0, 30), w: Math.round(rect.width), h: Math.round(rect.height) };
  }) : [];
  // Session list scrollbar
  const sessionListEl = document.querySelector(".sidebar__content");
  const sessionListRect = sessionListEl ? sessionListEl.getBoundingClientRect() : null;
  const sessionScrollbarStyle = sessionListEl ? (() => {
    const cs = getComputedStyle(sessionListEl);
    const hasVisibleScrollbar = sessionListEl.scrollHeight > sessionListEl.clientHeight;
    return {
        scrollH: sessionListEl.scrollHeight,
        clientH: sessionListEl.clientHeight,
        overflowY: cs.overflowY,
        overflowX: cs.overflowX,
        children: sessionListEl.children.length,
        canScroll: hasVisibleScrollbar,
        scrollbarWidth: sessionListEl.offsetWidth - sessionListEl.clientWidth,
        cssScrollbarColor: cs.scrollbarColor,
        cssScrollbarWidth: cs.scrollbarWidth,
        cssScrollbarGutter: cs.scrollbarGutter,
      };
  })() : null;
  // Footer details
  const footerEl = document.querySelector(".sidebar__footer");
  const footerChildren = footerEl ? Array.from(footerEl.children).map((c) => {
    const rect = c.getBoundingClientRect();
    return { cls: (c.className || "").toString().slice(0, 40), label: c.getAttribute("aria-label") || c.textContent?.trim().slice(0, 30), w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) };
  }) : [];
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    consoleErrors: window.__CONSOLE_ERRORS__ || [],
    window: { w: innerWidth, h: innerHeight },
    topbar: topbarRect ? { rect: { x: Math.round(topbarRect.x), y: Math.round(topbarRect.y), w: Math.round(topbarRect.width), h: Math.round(topbarRect.height) }, children: topbarChildren } : null,
    sidebarSessions: sessionScrollbarStyle,
    sidebarFooter: footerEl ? { rect: r(footerEl), children: footerChildren } : null,
    sidebarFooterWidth: footerEl ? footerEl.getBoundingClientRect().width : null,
    topbarEmptySpace: topbarEl ? (() => {
      const left = document.querySelector(".main-topbar__left");
      const right = document.querySelector(".main-topbar__right");
      const lr = left ? left.getBoundingClientRect() : null;
      const rr = right ? right.getBoundingClientRect() : null;
      return {
        leftEnd: lr ? Math.round(lr.x + lr.width) : null,
        rightStart: rr ? Math.round(rr.x) : null,
        gap: lr && rr ? Math.round(rr.x - (lr.x + lr.width)) : null,
        topbarWidth: Math.round(topbarRect.width),
      };
    })() : null,
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
