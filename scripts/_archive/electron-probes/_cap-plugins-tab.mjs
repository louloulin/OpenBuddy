import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-plm-"));
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

const btn = page.locator('.sidebar__nav-item:has-text("专家")');
await btn.first().click();
await page.waitForTimeout(3000);

// Click 插件·市场 tab (4th)
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const market = tabs.find(t => /市场|plugin|market/i.test(t.textContent || ''));
  if (market) market.click();
});
await page.waitForTimeout(2000);

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-plugin-market.png", fullPage: false });

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    title: document.querySelector('h1, .um-market-title, [class*="market-title"]')?.textContent?.slice(0, 50),
    cards: Array.from(document.querySelectorAll('[class*="card"]')).slice(0, 5).map(c => ({
      cls: c.className?.slice(0, 60),
    })),
    rows: document.querySelectorAll('.plugin-list__row').length,
    umPillSelected: document.querySelector('.um-pill--active')?.textContent?.trim().slice(0, 30),
    listClasses: Array.from(document.querySelectorAll('[class*="list"], [class*="grid"], [class*="items"]')).slice(0,5).map(e => e.className?.slice(0, 60)),
    // Try to find any plugin-card-like elements
    cardsByTag: Array.from(document.querySelectorAll('main *')).filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 100 && r.width < 500 && r.height > 80 && r.height < 250 && /card|plugin|item/i.test(e.className || '');
    }).slice(0, 5).map(e => e.className?.slice(0, 60)),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
