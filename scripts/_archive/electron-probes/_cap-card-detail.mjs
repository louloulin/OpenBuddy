import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cd-"));
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

// Collapse sidebar
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const collapseBtn = btns.find(b => b.getAttribute('aria-label') === '收起侧边栏');
  if (collapseBtn) collapseBtn.click();
});
await page.waitForTimeout(1500);

// Inspect grid + cards in detail
const m = await page.evaluate(() => {
  const grid = document.querySelector('.home__practices-grid');
  const card = document.querySelector('.home__practice-card');
  const thumb = document.querySelector('.home__practice-card-thumb');
  return {
    grid: grid ? {
      width: grid.offsetWidth,
      gridTemplateColumns: getComputedStyle(grid).gridTemplateColumns,
      columnGap: getComputedStyle(grid).columnGap,
      rowGap: getComputedStyle(grid).rowGap,
    } : null,
    card: card ? {
      width: card.offsetWidth,
      minWidth: getComputedStyle(card).minWidth,
      height: card.offsetHeight,
    } : null,
    thumb: thumb ? {
      width: thumb.offsetWidth,
      height: thumb.offsetHeight,
      aspectRatio: getComputedStyle(thumb).aspectRatio,
      maxHeight: getComputedStyle(thumb).maxHeight,
      minHeight: getComputedStyle(thumb).minHeight,
    } : null,
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
