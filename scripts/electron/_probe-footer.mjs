import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-foot-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(2500);
const footer = await page.evaluate(() => {
  const f = document.querySelector('.sidebar__footer');
  if (!f) return { error: 'no footer' };
  const r = f.getBoundingClientRect();
  const items = Array.from(f.children).map(el => {
    const cr = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 80),
      text: (el.textContent || '').trim().slice(0, 60),
      aria: el.getAttribute('aria-label') || '',
      x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height),
      display: cs.display, opacity: cs.opacity, visibility: cs.visibility,
    };
  });
  return {
    footerRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    items,
  };
});
console.log(JSON.stringify(footer, null, 2));
await app.close();
