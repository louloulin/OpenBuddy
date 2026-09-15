import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cm-"));
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

// Force light
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
await ta.fill('你好');
await ta.press('Enter');
await page.waitForTimeout(500);

// Wait for assistant response (likely won't come but add a fake one)
await page.evaluate(() => {
  // Force an assistant message in DOM for inspection
  const timeline = document.querySelector('.timeline, .messages, .chatview__messages, [class*="msg-list"], [class*="timeline"]');
  if (timeline) {
    const html = '<div class="msg msg--assistant"><div class="msg__bubble" style="background:red;color:white">测试回复</div></div>';
    timeline.insertAdjacentHTML('beforeend', html);
  }
});
await page.waitForTimeout(500);

// Now capture
const m = await page.evaluate(() => {
  const cs = (s, p) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el)[p]; };
  // Find all msg-related bubbles
  const bubbles = Array.from(document.querySelectorAll('.msg__bubble'));
  return {
    bubbleCount: bubbles.length,
    bubbles: bubbles.map((el, i) => {
      const c = getComputedStyle(el);
      const msg = el.closest('.msg');
      return {
        idx: i,
        msgClass: msg ? msg.className : '',
        bg: c.backgroundColor,
        color: c.color,
        radius: c.borderRadius,
        borderColor: c.borderColor,
        padding: c.padding,
      };
    }),
  };
});
console.log(JSON.stringify(m, null, 2));

// Test dark theme - what happens to user bubble?
await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.waitForTimeout(500);
const dm = await page.evaluate(() => {
  const bubbles = Array.from(document.querySelectorAll('.msg__bubble'));
  return bubbles.map((el, i) => {
    const c = getComputedStyle(el);
    const msg = el.closest('.msg');
    return {
      idx: i,
      msgClass: msg ? msg.className : '',
      bg: c.backgroundColor,
      color: c.color,
    };
  });
});
console.log('DARK:', JSON.stringify(dm, null, 2));

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-chat-dark.png", fullPage: false });
await app.close();
