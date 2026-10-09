import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-c3-"));
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
const d = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.home__practice-card'));
  const grid = document.querySelector('.home__practices-grid');
  const gcs = grid ? getComputedStyle(grid) : null;
  const inner = document.querySelector('.home__inner');
  const home = document.querySelector('.home');
  return {
    cardCount: cards.length,
    cardRects: cards.map(c => { const r = c.getBoundingClientRect(); return {x:Math.round(r.x), w:Math.round(r.width), h:Math.round(r.height)}; }),
    gridCols: gcs?.gridTemplateColumns,
    gridDisplay: gcs?.display,
    homeMaxW: home ? getComputedStyle(home).maxWidth : null,
    homePad: home ? getComputedStyle(home).padding : null,
    innerW: inner ? Math.round(inner.getBoundingClientRect().width) : null,
    chipsCount: document.querySelectorAll('.home__chip').length,
    scenesCount: document.querySelectorAll('.home__scene').length,
  };
});
console.log(JSON.stringify(d, null, 2));
await app.close();
