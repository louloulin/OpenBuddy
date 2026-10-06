import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ex-"));
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

// Try click via Playwright selector
const btn = page.locator('.sidebar__nav-item:has-text("专家")');
const exists = await btn.count();
console.log('button count:', exists);
if (exists > 0) {
  await btn.first().click();
  await page.waitForTimeout(3000);
}

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-experts.png", fullPage: false });

const m = await page.evaluate(() => {
  return {
    mainContent: document.querySelector('main')?.innerHTML?.slice(0, 500),
    pageClass: document.querySelector('main > div')?.className,
    pageId: document.querySelector('main > div')?.id,
    headings: Array.from(document.querySelectorAll('main h1, main h2')).slice(0, 3).map(h => h.textContent?.slice(0,30)),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
