import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-comp-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.setViewportSize({ width: 1728, height: 1091 });
await page.waitForTimeout(1500);

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
  const meta = document.querySelector('.wb-composer-meta');
  return {
    composerWrap: b('.wb-composer-wrap'),
    composer: b('.wb-composer'),
    composerMeta: b('.wb-composer-meta'),
    metaBtns: Array.from(document.querySelectorAll('.wb-composer-meta__btn, [class*="composer-tool"]')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        cls: el.className?.toString().slice(0, 40),
        text: el.textContent?.trim().slice(0, 30),
        title: el.title || el.getAttribute('aria-label'),
        x: Math.round(r.x), w: Math.round(r.width),
      };
    }),
    composerInput: b('.wb-composer__input, textarea'),
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-composer-area.png" });
await app.close();
