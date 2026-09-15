import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cs2-"));
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

// Collapse sidebar
await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="收起侧边栏"]');
  if (btn) btn.click();
});
await page.waitForTimeout(1500);

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
  // Find all sidebar-related elements
  const allSidebars = Array.from(document.querySelectorAll('[class*="sidebar"]')).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className?.toString().slice(0, 60),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    };
  });
  return {
    bodyClass: document.body.className,
    appClass: document.querySelector('.app')?.className,
    sidebarExists: !!document.querySelector('.sidebar'),
    mainExists: !!document.querySelector('.app__main'),
    mainClass: document.querySelector('.app__main')?.className,
    homeWidth: document.querySelector('.home')?.getBoundingClientRect().width,
    allSidebars,
    expandBtn: b('[aria-label="展开侧边栏"]'),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
