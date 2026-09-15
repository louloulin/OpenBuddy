import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ea2-"));
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

// Create a session to get chatview
const ta = await page.locator('.wb-composer textarea').first();
await ta.fill('测试');
await ta.press('Enter');
await page.waitForTimeout(2500);

// Inject empty state UI manually (CSS test)
await page.evaluate(() => {
  // Find chatview__main
  const main = document.querySelector('.chatview__main, .chatview');
  if (main) {
    // Hide existing messages
    main.querySelectorAll('.msg, .timeline').forEach(el => el.style.display = 'none');
    // Inject test tags
    const div = document.createElement('div');
    div.className = 'chatview__empty-state';
    div.style.cssText = 'padding: 24px; display: flex; gap: 8px;';
    div.innerHTML = '<span class="chatview__empty-state-tag">测试标签1</span><span class="chatview__empty-state-tag">测试标签2</span>';
    main.insertBefore(div, main.firstChild);
  }
});
await page.waitForTimeout(500);

const m = await page.evaluate(() => {
  const tags = Array.from(document.querySelectorAll('.chatview__empty-state-tag'));
  return {
    tagCount: tags.length,
    tagBg: tags[0] ? getComputedStyle(tags[0]).backgroundColor : null,
    tagColor: tags[0] ? getComputedStyle(tags[0]).color : null,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r8-empty-test.png", fullPage: false });
await app.close();
