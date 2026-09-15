import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-bg-"));
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

// Click new session
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const newBtn = buttons.find(b => /新建|new/i.test(b.textContent || b.getAttribute('aria-label') || ''));
  if (newBtn) newBtn.click();
});
await page.waitForTimeout(2000);

// Send a message
const ta = await page.locator('.wb-composer textarea').first();
await ta.fill('你好测试');
await ta.press('Enter');
await page.waitForTimeout(2000);

// Now check: get all bubble info, all computed styles
const m = await page.evaluate(() => {
  const bubbles = Array.from(document.querySelectorAll('.msg__bubble'));
  return bubbles.map((el, i) => {
    const cs = getComputedStyle(el);
    const msg = el.closest('.msg');
    return {
      idx: i,
      msgClass: msg ? msg.className : '',
      bg: cs.backgroundColor,
      color: cs.color,
      borderRadius: cs.borderRadius,
      padding: cs.padding,
      marginLeft: cs.marginLeft,
      marginRight: cs.marginRight,
      width: el.offsetWidth,
      height: el.offsetHeight,
      // Check where it comes from by looking at matching rules
      inlineStyle: el.getAttribute('style') || '',
      parentClass: el.parentElement?.className || '',
    };
  });
});
console.log(JSON.stringify(m, null, 2));
await app.close();
