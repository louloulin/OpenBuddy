import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ea-"));
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

// Create session and check empty state
const ta = await page.locator('.wb-composer textarea').first();
await ta.fill('测试');
await ta.press('Enter');
await page.waitForTimeout(3000);

// Navigate back to home, then create new session to see empty chatview
await page.evaluate(() => {
  const navItems = Array.from(document.querySelectorAll('.sidebar__nav-item'));
  const home = navItems.find(n => /新建任务/.test(n.textContent || ''));
  if (home) home.click();
});
await page.waitForTimeout(1500);

// Inject an empty chatview for testing
await page.evaluate(() => {
  // Try to find chatview timeline container
  const target = document.querySelector('.chatview, [class*="chatview"]');
  // Force empty state by hiding all messages
  document.querySelectorAll('.msg').forEach(el => el.style.display = 'none');
});
await page.waitForTimeout(500);

// Check that --wb-bg-subtle resolves now
const m = await page.evaluate(() => {
  const root = document.documentElement;
  const rootCs = getComputedStyle(root);
  const tags = Array.from(document.querySelectorAll('.chatview__empty-state-tag'));
  return {
    rootBgSubtle: rootCs.getPropertyValue('--wb-bg-subtle'),
    tagCount: tags.length,
    tagBg: tags[0] ? getComputedStyle(tags[0]).backgroundColor : null,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r8-after-empty-fix.png", fullPage: false });
await app.close();
