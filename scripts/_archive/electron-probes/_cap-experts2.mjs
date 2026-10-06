import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ex2-"));
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

// Get tab labels
const tabs = await page.evaluate(() => {
  const tablist = document.querySelector('.um-pills, [role="tablist"]');
  const tabs = Array.from(tablist?.querySelectorAll('[role="tab"]') || []);
  return tabs.map(t => ({
    label: t.textContent?.trim().slice(0, 30),
    active: t.getAttribute('aria-selected') === 'true',
  }));
});
console.log('Tabs:', JSON.stringify(tabs, null, 2));

// Click second tab if exists
if (tabs.length > 1) {
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    if (tabs[1]) tabs[1].click();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-experts-tab2.png", fullPage: false });
  
  const m = await page.evaluate(() => {
    const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
    return {
      pluginList: b('.plugin-list'),
      openbuddyPanel: b('.openbuddy-plugin-panel'),
      umMarket: b('.um-market'),
      pluginsCount: document.querySelectorAll('.plugin-list__row, .plugin-card').length,
      cards: Array.from(document.querySelectorAll('[class*="card"]')).slice(0, 5).map(c => ({
        cls: c.className?.slice(0, 50),
      })),
    };
  });
  console.log('After tab2:', JSON.stringify(m, null, 2));
}

await app.close();
