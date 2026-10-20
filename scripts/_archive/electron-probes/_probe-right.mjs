import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-layout-"));
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
await page.waitForTimeout(3000);
const layout = await page.evaluate(() => {
  const vis = (els) => els.filter(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 50 && r.height > 30 && cs.display !== 'none' && cs.visibility !== 'hidden';
  }).map(el => ({
    cls: (el.className || '').toString().slice(0, 100),
    text: (el.innerText || '').slice(0, 80).replace(/\n/g, ' '),
    x: Math.round(el.getBoundingClientRect().x),
    y: Math.round(el.getBoundingClientRect().y),
    w: Math.round(el.getBoundingClientRect().width),
  }));
  const all = Array.from(document.querySelectorAll('*'));
  const rightEls = all.filter(el => {
    const r = el.getBoundingClientRect();
    return r.x > 700 && r.width > 50 && r.height > 30;
  });
  return vis(rightEls).slice(0, 30);
});
console.log(JSON.stringify(layout, null, 2));
await app.close();
