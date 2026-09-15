// Launch WorkBuddy via its app.asar at a specific size and capture screens
import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const userData = mkdtempSync(join(tmpdir(), "wb-cap-"));
const app = await electron.launch({
  args: [
    `--user-data-dir=${userData}`,
    "/Applications/WorkBuddy.app/Contents/Resources/app.asar",
  ],
  executablePath: "/Applications/WorkBuddy.app/Contents/MacOS/Electron",
  timeout: 40000,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForTimeout(5000);
const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1728, 1091); });
await page.waitForTimeout(2500);

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
  return {
    title: document.title,
    url: location.href,
    vw: innerWidth, vh: innerHeight,
    bodyClass: document.body.className,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/tmp/wb-home.png" });
console.log("captured /tmp/wb-home.png");
await app.close();
