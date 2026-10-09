import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-bd-"));
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

const ta = await page.locator('.wb-composer textarea').first();
await ta.fill('测试气泡边框');
await ta.press('Enter');
await page.waitForTimeout(2000);

// Inject an assistant message too
await page.evaluate(() => {
  // Find the timeline
  const candidates = ['.timeline', '.messages', '.chatview__messages', '.chatview__timeline', '[class*="msg-list"]'];
  let target = null;
  for (const sel of candidates) {
    target = document.querySelector(sel);
    if (target) break;
  }
  if (target) {
    target.insertAdjacentHTML('beforeend', '<div class="msg msg--assistant"><div class="msg__bubble" data-testid="assistant-bubble">助理测试回复</div></div>');
  }
});
await page.waitForTimeout(500);

const m = await page.evaluate(() => {
  const out = {};
  const userBubble = document.querySelector('.msg--user .msg__bubble');
  const asstBubble = document.querySelector('.msg--assistant .msg__bubble');
  if (userBubble) {
    const cs = getComputedStyle(userBubble);
    out.user = {
      bg: cs.backgroundColor,
      radius: cs.borderRadius,
      longhand: `${cs.borderTopLeftRadius} ${cs.borderTopRightRadius} ${cs.borderBottomRightRadius} ${cs.borderBottomLeftRadius}`,
      width: userBubble.offsetWidth,
      parentAlign: getComputedStyle(userBubble.parentElement).textAlign,
      msgAlign: getComputedStyle(userBubble.closest('.msg')).textAlign,
    };
  }
  if (asstBubble) {
    const cs = getComputedStyle(asstBubble);
    out.assistant = {
      bg: cs.backgroundColor,
      radius: cs.borderRadius,
      longhand: `${cs.borderTopLeftRadius} ${cs.borderTopRightRadius} ${cs.borderBottomRightRadius} ${cs.borderBottomLeftRadius}`,
      width: asstBubble.offsetWidth,
    };
  }
  return out;
});
console.log(JSON.stringify(m, null, 2));
await app.close();
