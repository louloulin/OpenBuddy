import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cf-"));
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

// Test expanded state
const m_expanded = await page.evaluate(() => {
  const grid = document.querySelector('.home__practices-grid');
  const cards = Array.from(document.querySelectorAll('.home__practice-card'));
  return {
    gridW: grid.offsetWidth,
    gridCols: getComputedStyle(grid).gridTemplateColumns,
    cards: cards.map((c, i) => ({ idx: i, w: c.offsetWidth, h: c.offsetHeight })),
  };
});
console.log('EXPANDED:', JSON.stringify(m_expanded, null, 2));

// Take screenshot
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r8-cards-expanded.png", fullPage: false });

// Collapse sidebar
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const collapseBtn = btns.find(b => b.getAttribute('aria-label') === '收起侧边栏');
  if (collapseBtn) collapseBtn.click();
});
await page.waitForTimeout(1500);

const m_collapsed = await page.evaluate(() => {
  const grid = document.querySelector('.home__practices-grid');
  const cards = Array.from(document.querySelectorAll('.home__practice-card'));
  return {
    gridW: grid.offsetWidth,
    gridCols: getComputedStyle(grid).gridTemplateColumns,
    cards: cards.map((c, i) => ({ idx: i, w: c.offsetWidth, h: c.offsetHeight })),
  };
});
console.log('COLLAPSED:', JSON.stringify(m_collapsed, null, 2));

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r8-cards-collapsed.png", fullPage: false });
await app.close();
