import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ed-"));
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
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.waitForTimeout(500);

const ta = await page.locator('.wb-composer textarea').first();
await ta.fill('x');
await ta.press('Enter');
await page.waitForTimeout(2000);

await page.evaluate(() => {
  const main = document.querySelector('.chatview__main, .chatview');
  if (main) {
    main.querySelectorAll('.msg, .timeline').forEach(el => el.style.display = 'none');
    const div = document.createElement('div');
    div.className = 'chatview__empty-state';
    div.style.cssText = 'padding: 24px; display: flex; gap: 8px;';
    div.innerHTML = '<span class="chatview__empty-state-tag">暗色Test</span>';
    main.insertBefore(div, main.firstChild);
  }
});
await page.waitForTimeout(300);

const m = await page.evaluate(() => {
  const tag = document.querySelector('.chatview__empty-state-tag');
  const cs = getComputedStyle(tag);
  const htmlCs = getComputedStyle(document.documentElement);
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    tagBg: cs.backgroundColor,
    htmlBgSubtle: htmlCs.getPropertyValue('--wb-bg-subtle'),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
