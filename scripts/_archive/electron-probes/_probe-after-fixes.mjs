import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-fix-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);

// First close onboarding
try { await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {}); } catch {}
await page.waitForTimeout(2000);

// Take screenshot of home
await page.screenshot({ path: join(ROOT, "tests/screenshots", "ui-fixed-home.png") });

// Click search button to verify overlay opens
await page.click(".main-topbar__search");
await page.waitForTimeout(2000);
await page.screenshot({ path: join(ROOT, "tests/screenshots", "ui-fixed-search-open.png") });

// Press Escape to close
await page.keyboard.press("Escape");
await page.waitForTimeout(1000);

const out = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    consoleErrors: window.__CONSOLE_ERRORS__ || [],
    topbar: r(".main-topbar"),
    topbarSearch: r(".main-topbar__search"),
    sidebarFooter: r(".sidebar__footer"),
    sidebarFooterLogoSpacer: (() => {
      const el = document.querySelector(".sidebar__footer > .sidebar__logo-spacer");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
