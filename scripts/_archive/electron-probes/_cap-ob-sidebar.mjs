import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-sb2-"));
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
await page.screenshot({ path: "/tmp/ob-sidebar-full.png", fullPage: false });

// Get full sidebar structure
const m = await page.evaluate(() => {
  const walk = (el, depth = 0) => {
    if (depth > 3) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      cls: el.className?.toString().slice(0, 50),
      y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width),
      text: el.children.length === 0 ? (el.textContent?.slice(0, 40) || '') : '',
      icon: el.tagName === 'svg' ? 'svg' : undefined,
      children: depth < 3 ? Array.from(el.children).map(c => walk(c, depth+1)).filter(Boolean) : []
    };
  };
  const sidebar = document.querySelector('.sidebar');
  return sidebar ? walk(sidebar, 0) : null;
});
console.log(JSON.stringify(m, null, 2));
await app.close();
