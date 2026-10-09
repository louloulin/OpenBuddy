import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cc-"));
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

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    homeExpanded: b('.home'),
    homeCollapsed: null,  // not yet
    homeInnerExpanded: b('.home__inner'),
    grid: b('.home__practices-grid'),
    cards: Array.from(document.querySelectorAll('.home__practice-card')).slice(0, 5).map((c, i) => {
      const r = c.getBoundingClientRect();
      return { idx: i, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }),
    onboarding: b('.home__onboarding'),
  };
});
console.log('EXPANDED:', JSON.stringify(m, null, 2));

// Click collapse
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const collapseBtn = btns.find(b => b.getAttribute('aria-label') === '收起侧边栏');
  if (collapseBtn) collapseBtn.click();
});
await page.waitForTimeout(1500);

const m2 = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    homeCollapsed: b('.home'),
    grid: b('.home__practices-grid'),
    cards: Array.from(document.querySelectorAll('.home__practice-card')).slice(0, 5).map((c, i) => {
      const r = c.getBoundingClientRect();
      return { idx: i, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }),
    onboarding: b('.home__onboarding'),
  };
});
console.log('COLLAPSED:', JSON.stringify(m2, null, 2));
await app.close();
