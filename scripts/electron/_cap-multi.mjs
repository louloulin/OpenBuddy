import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-multi-"));
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
const sizes = [
  [1728, 1091],
  [1280, 800],
  [1024, 720],
  [860, 720],
  [560, 720],
];
const out = [];
for (const [w, h] of sizes) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
    const cs = (s, p) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el)[p]; };
    return {
      vw: innerWidth, vh: innerHeight,
      heroPadTop: cs('.home__hero', 'paddingTop'),
      titleFont: cs('.home__title', 'fontSize'),
      practicesMT: cs('.home__practices', 'marginTop'),
      grid: b('.home__practices-grid'),
      card: b('.home__practice-card'),
      cards: Array.from(document.querySelectorAll('.home__practice-card')).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), w: Math.round(r.width) };
      }),
    };
  });
  out.push({ size: [w, h], m });
}
console.log(JSON.stringify(out, null, 2));
await app.close();
