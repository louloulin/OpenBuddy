import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url).replace('/tmp/', '/Users/louloulin/appx/OpenBuddy/scripts/'))));
const userData = mkdtempSync(join(tmpdir(), "ob-curr-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);
const out = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const q = (s) => Array.from(document.querySelectorAll(s));
  // Capture page errors
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    consoleErrors: window.__CONSOLE_ERRORS__ || [],
    sidebar: {
      rect: r(".sidebar, aside"),
      footerRect: r(".sidebar__footer"),
      userRect: r(".sidebar__user"),
      userText: document.querySelector(".sidebar__user")?.textContent?.replace(/\s+/g, " ").trim(),
      bellRect: r(".sidebar__icon-btn[aria-label='通知']"),
      setRect: r(".sidebar__icon-btn[aria-label='设置']"),
      visible: document.querySelector(".sidebar")?.offsetParent !== null,
    },
    sessions: {
      listRect: r(".sidebar__list, .sidebar__content"),
      items: q(".sidebar__item, .session-item, [data-session-id]").length,
      scrollH: document.querySelector(".sidebar__content")?.scrollHeight,
      clientH: document.querySelector(".sidebar__content")?.clientHeight,
    },
    menubar: {
      rect: r(".main-topbar, .title-bar, [class*='topbar']"),
      items: q(".main-topbar__title, .main-topbar__action, .main-topbar__item").map((el) => el.textContent?.trim().slice(0, 30)),
    },
    window: { w: innerWidth, h: innerHeight },
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
