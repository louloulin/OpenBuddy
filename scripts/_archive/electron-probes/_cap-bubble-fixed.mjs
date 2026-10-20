import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-bf-"));
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

await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const newBtn = buttons.find(b => /新建|new/i.test(b.textContent || b.getAttribute('aria-label') || ''));
  if (newBtn) newBtn.click();
});
await page.waitForTimeout(2000);

// Insert user bubble + assistant bubble side by side for visual comparison
await page.evaluate(() => {
  const candidates = ['.timeline', '.messages', '.chatview__messages', '.chatview__timeline', '[class*="msg-list"]'];
  let target = null;
  for (const sel of candidates) {
    target = document.querySelector(sel);
    if (target) break;
  }
  if (target) {
    target.insertAdjacentHTML('beforeend', `
      <div class="msg msg--assistant" style="margin-bottom: 12px;">
        <div class="msg__bubble" data-testid="assistant-bubble">我是助理回复气泡</div>
      </div>
      <div class="msg msg--user" style="margin-bottom: 12px;">
        <div><div class="msg__bubble" data-testid="user-bubble">我是用户发送气泡</div></div>
      </div>
    `);
  }
});
await page.waitForTimeout(500);

// Now read details
const m = await page.evaluate(() => {
  const asst = document.querySelector('.msg--assistant .msg__bubble');
  const user = document.querySelector('.msg--user .msg__bubble');
  return {
    asst: asst ? {
      bg: getComputedStyle(asst).backgroundColor,
      radius: getComputedStyle(asst).borderRadius,
      longhand: `${getComputedStyle(asst).borderTopLeftRadius} ${getComputedStyle(asst).borderTopRightRadius} ${getComputedStyle(asst).borderBottomRightRadius} ${getComputedStyle(asst).borderBottomLeftRadius}`,
    } : null,
    user: user ? {
      bg: getComputedStyle(user).backgroundColor,
      radius: getComputedStyle(user).borderRadius,
      longhand: `${getComputedStyle(user).borderTopLeftRadius} ${getComputedStyle(user).borderTopRightRadius} ${getComputedStyle(user).borderBottomRightRadius} ${getComputedStyle(user).borderBottomLeftRadius}`,
    } : null,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-bubbles.png", fullPage: false });
await app.close();
