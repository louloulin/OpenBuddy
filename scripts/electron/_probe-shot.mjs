import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-shot-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1728, 1031); });
await page.waitForTimeout(14_000);
try {
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 }).catch(() => {});
} catch {}
await page.waitForTimeout(2000);
const out = join(ROOT, "tests/screenshots", "ui-current.png");
await page.screenshot({ path: out, fullPage: false });
console.log("saved", out);
// Detailed audit of what's wrong
const audit = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const q = (s) => Array.from(document.querySelectorAll(s));
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    window: { w: innerWidth, h: innerHeight },
    topbar: {
      rect: r(".main-topbar"),
      // Get all visible items in topbar
      allBtns: q(".main-topbar button, .main-topbar [role=button]").map((b) => {
        const rect = b.getBoundingClientRect();
        return { label: b.getAttribute("aria-label") || b.textContent?.trim().slice(0, 20), w: Math.round(rect.width), h: Math.round(rect.height) };
      }),
      // Find what's in main-topbar__left vs __right
      leftChildren: q(".main-topbar__left > *").map((el) => {
        const rect = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 40), label: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20), w: Math.round(rect.width) };
      }),
      rightChildren: q(".main-topbar__right > *, .main-topbar > *:not(.main-topbar__left):not(.main-topbar__right)").map((el) => {
        const rect = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 40), label: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20), w: Math.round(rect.width) };
      }),
    },
    sidebarSessions: (() => {
      const el = document.querySelector(".sidebar__content");
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        scrollbarWidth: el.offsetWidth - el.clientWidth,
        overflowY: cs.overflowY,
        childrenCount: el.children.length,
      };
    })(),
    sidebarFooter: (() => {
      const el = document.querySelector(".sidebar__footer");
      if (!el) return null;
      const children = Array.from(el.children).map((c) => {
        const r = c.getBoundingClientRect();
        return { cls: c.className.toString().slice(0, 40), label: c.getAttribute("aria-label") || c.textContent?.trim().slice(0, 20), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
      });
      return { rect: r(el), children };
    })(),
  };
});
console.log(JSON.stringify(audit, null, 2));
await app.close();
process.exit(0);
