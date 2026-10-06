import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-sb-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
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
await page.waitForTimeout(2000);

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    sidebar: b('.sidebar'),
    footer: b('.sidebar__footer'),
    user: b('.sidebar__user'),
    userButtons: Array.from(document.querySelectorAll('.sidebar__icon-btn')).map(b => {
      const r = b.getBoundingClientRect();
      return { aria: b.getAttribute('aria-label'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }),
    allIconBtns: Array.from(document.querySelectorAll('button.sidebar__icon-btn')).length,
    footerExists: !!document.querySelector('.sidebar__footer'),
    userExists: !!document.querySelector('.sidebar__user'),
    computedFooterDisplay: document.querySelector('.sidebar__footer') ? getComputedStyle(document.querySelector('.sidebar__footer')).display : null,
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
