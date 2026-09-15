import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ad-"));
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
const results = [];
for (const sz of [[1728, 1091], [1280, 800], [1024, 720], [800, 600]]) {
  await win.setContentSize(sz[0], sz[1]);
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const grid = document.querySelector('.home__practices-grid');
    const cs = grid ? getComputedStyle(grid) : null;
    const cards = [...document.querySelectorAll('.home__practice-card')];
    return {
      gridCols: cs?.gridTemplateColumns,
      gridDisplay: cs?.display,
      gridGap: cs?.gap,
      cardCount: cards.length,
      cards: cards.map(c => { const r = c.getBoundingClientRect(); return {x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)}; }),
    };
  });
  const out = `/Users/louloulin/Downloads/adaptive-${sz[0]}x${sz[1]}.png`;
  try {
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: sz[0], height: sz[1] } });
  } catch (e) { console.log("screenshot failed", sz, e.message); }
  results.push({ vp: `${sz[0]}x${sz[1]}`, gridCols: m.gridCols, gap: m.gridGap, cardCount: m.cardCount, cards: m.cards });
}
console.log(JSON.stringify(results, null, 1));
await app.close();
