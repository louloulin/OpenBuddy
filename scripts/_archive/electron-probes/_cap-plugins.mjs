import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-pl-"));
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

await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'light');
});
await page.waitForTimeout(500);

// Try to navigate to plugins
const navItems = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('[class*="nav-item"], [class*="sidebar__nav"], button'));
  return items.filter(i => /插件|plugin|扩展/i.test(i.textContent || i.getAttribute('aria-label') || '')).slice(0, 5).map(i => ({
    text: i.textContent?.slice(0, 30),
    aria: i.getAttribute('aria-label'),
    cls: i.className?.slice(0, 50),
  }));
});
console.log('Nav items with 插件/plugin/扩展:', JSON.stringify(navItems, null, 2));

// Click first match
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('button, [class*="nav-item"], a'));
  const target = items.find(i => /插件|plugin|扩展/i.test(i.textContent || i.getAttribute('aria-label') || ''));
  if (target) target.click();
});
await page.waitForTimeout(2000);

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-plugins.png", fullPage: false });

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    plugins: b('.plugins'),
    pluginList: b('.plugin-list'),
    openBuddyPanel: b('.openbuddy-plugin-panel, [class*="openbuddy-plugin"]'),
    pageClasses: Array.from(document.querySelectorAll('main [class*="panel"], main [class*="page"]')).slice(0,3).map(e => e.className?.slice(0,60)),
    titleText: document.querySelector('h1, h2')?.textContent?.slice(0, 50),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
