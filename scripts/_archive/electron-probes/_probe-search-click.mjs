import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-search-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);

// Click the search button
const before = await page.evaluate(() => {
  return {
    searchBtn: !!document.querySelector(".main-topbar__search"),
    searchBtnRect: (() => {
      const el = document.querySelector(".main-topbar__search");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
  };
});
console.log('BEFORE CLICK:', JSON.stringify(before, null, 2));

try {
  await page.click(".main-topbar__search");
  await page.waitForTimeout(2000);
} catch (e) {
  console.log('click failed:', String(e).slice(0, 200));
}

const after = await page.evaluate(() => {
  return {
    overlayVisible: !!document.querySelector(".search-overlay, [data-search-overlay], [class*='SearchOverlay']"),
    pageErrors: window.__PAGE_ERRORS__ || [],
    consoleErrors: window.__CONSOLE_ERRORS__ || [],
  };
});
console.log('AFTER CLICK:', JSON.stringify(after, null, 2));
await app.close();
process.exit(0);
