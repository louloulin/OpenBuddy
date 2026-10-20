import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-sb-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForFunction(() => window.api?.apiVersion === 1);
await page.waitForTimeout(2500);
const win = await app.browserWindow(page);
await win.evaluate((w) => w.setContentSize(1728, 1091));
await page.waitForTimeout(2500);
const out = process.argv[2] || "/Users/louloulin/Downloads/cur-sidebar.png";
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 264, height: 1091 } });
const m = await page.evaluate(() => {
  const g = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const t = (s) => { const el = document.querySelector(s); return el ? el.textContent.trim().slice(0, 40) : null; };
  const list = (s) => [...document.querySelectorAll(s)].map(el => ({ txt: el.textContent.trim().slice(0, 30), cls: el.className, rect: (() => { const r = el.getBoundingClientRect(); return {y: Math.round(r.y), h: Math.round(r.height)}; })() }));
  return {
    sidebar: g('.sidebar'),
    sidebarBg: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
    navItems: list('.sidebar__nav-item, .sidebar__nav .sidebar__nav-item, [class*="sidebar__nav-item"]'),
    sections: list('.sidebar__section, [class*="sidebar__section"]'),
    sessions: list('.sidebar__session, [class*="sidebar__session"]'),
    workspace: list('.sidebar__workspace, [class*="sidebar__workspace"]'),
    footer: g('.sidebar__footer'),
    header: g('.sidebar__header, .sidebar__brand'),
    version: t('.sidebar__version, [class*="version"]'),
  };
});
console.log(JSON.stringify(m, null, 1));
await app.close();
