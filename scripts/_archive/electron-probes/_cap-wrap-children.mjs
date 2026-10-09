import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-wc-"));
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
  const wrap = document.querySelector('.wb-composer-wrap');
  if (!wrap) return { error: 'no wrap' };
  const children = Array.from(wrap.children);
  return {
    wrapChildren: children.map((c, i) => {
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      return {
        idx: i,
        cls: c.className?.slice(0, 50),
        tag: c.tagName,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        display: cs.display,
        visibility: cs.visibility,
        position: cs.position,
      };
    }),
    wrapHeight: wrap.offsetHeight,
    wrapStyle: {
      paddingTop: getComputedStyle(wrap).paddingTop,
      paddingBottom: getComputedStyle(wrap).paddingBottom,
      gap: getComputedStyle(wrap).gap,
    },
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
