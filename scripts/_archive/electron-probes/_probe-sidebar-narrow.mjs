/** 最小窗口尺寸(960px)下加宽后的侧栏是否挤压主区/产生横向溢出。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-narrow-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15000);
await page.evaluate(() => { for (const el of [...document.querySelectorAll("*")]) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== "none") el.remove(); } });
const win = await app.browserWindow(page);
await win.evaluate((w) => w.setSize(960, 700));
await page.waitForTimeout(1200);
const info = await page.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), y: Math.round(b.y), h: Math.round(b.height) }; };
  const main = document.querySelector(".app__main");
  const body = document.body;
  return {
    viewport: { w: innerWidth, h: innerHeight },
    sidebar: r(".sidebar"),
    main: r(".app__main"),
    footer: r(".sidebar__footer"),
    mainOverflowX: main ? main.scrollWidth - main.clientWidth : null,
    bodyOverflowX: body.scrollWidth - body.clientWidth,
    navItem: r(".sidebar__nav-item"),
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "/tmp/ob-narrow.png" });
await app.close();
process.exit(0);
