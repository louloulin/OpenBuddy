import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-pl2-"));
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

await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'light');
});
await page.waitForTimeout(500);

// Click "专家·技能·连接器" nav item
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.sidebar__nav-item'));
  const target = btns.find(b => /专家|技能|连接器/i.test(b.textContent || ''));
  if (target) target.click();
});
await page.waitForTimeout(2000);

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-experts.png", fullPage: false });

// Check page
const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    title: document.querySelector('h1')?.textContent,
    pageHeading: document.querySelector('main h1, main h2')?.textContent?.slice(0,50),
    tabLabels: Array.from(document.querySelectorAll('[role="tab"], button')).filter(b => b.offsetParent).slice(0, 8).map(b => b.textContent?.trim().slice(0, 20)),
    // Plugin UI elements
    pluginList: !!document.querySelector('.plugin-list'),
    openbuddyPanel: !!document.querySelector('.openbuddy-plugin-panel'),
    experts: !!document.querySelector('[class*="experts"]'),
  };
});
console.log(JSON.stringify(m, null, 2));

await app.close();
