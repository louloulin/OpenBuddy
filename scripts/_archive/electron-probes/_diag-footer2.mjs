import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ft2-"));
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

const m = await page.evaluate(() => {
  const footer = document.querySelector('.sidebar__footer');
  const r = footer.getBoundingClientRect();
  const buttons = Array.from(footer.querySelectorAll('button')).map(b => {
    const br = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return { aria: b.getAttribute('aria-label'), cls: b.className.toString().slice(0, 40), x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height), display: cs.display, visibility: cs.visibility, opacity: cs.opacity };
  });
  const cs = getComputedStyle(footer);
  return {
    footerRect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)},
    footerStyle: { display: cs.display, gap: cs.gap, padding: cs.padding, justifyContent: cs.justifyContent, alignItems: cs.alignItems, overflow: cs.overflow },
    buttons,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
