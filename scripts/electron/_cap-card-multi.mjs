import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cm-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30030 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(2500);

// Test multiple viewport sizes
const sizes = [
  { w: 1920, h: 1080, label: "1920" },
  { w: 1728, h: 1091, label: "1728" },
  { w: 1440, h: 900, label: "1440" },
  { w: 1280, h: 800, label: "1280" },
  { w: 1080, h: 720, label: "1080" },
  { w: 860, h: 600, label: "860" },
];

const results = [];
for (const size of sizes) {
  const win = await app.browserWindow(page);
  await win.evaluate((w, sz) => { w.setContentSize(sz.w, sz.h); }, size);
  await page.waitForTimeout(1000);
  
  const m = await page.evaluate(() => {
    const grid = document.querySelector('.home__practices-grid');
    const cards = Array.from(document.querySelectorAll('.home__practice-card'));
    return {
      gridW: grid ? grid.offsetWidth : null,
      cols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      cards: cards.length,
      firstCardW: cards[0]?.offsetWidth,
      firstCardH: cards[0]?.offsetHeight,
    };
  });
  results.push({ size: size.label, ...m });
}
console.log(JSON.stringify(results, null, 2));
await app.close();
