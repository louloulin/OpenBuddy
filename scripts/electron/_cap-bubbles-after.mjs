import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ba-"));
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
await ta.fill('你好测试');
await ta.press('Enter');
await page.waitForTimeout(2000);

// Inject an assistant bubble if none exists
await page.evaluate(() => {
  // Find any element that has class containing 'msg' or 'timeline'
  const candidates = document.querySelectorAll('[class*="timeline"], [class*="msg-list"], [class*="messages"]');
  let target = null;
  for (const el of candidates) {
    if (el.children.length > 0 || el.tagName === 'OL' || el.tagName === 'UL' || el.tagName === 'DIV') {
      target = el;
      break;
    }
  }
  if (!target) {
    // try chatview
    target = document.querySelector('.chatview');
  }
  if (target) {
    // Look at chatview children
    const inner = target.querySelector('[class*="inner"]') || target;
    const html = '<div class="msg msg--assistant" data-injected="true"><div class="msg__bubble">助理回复测试 — 用于验证气泡方向是否对称</div></div>';
    inner.insertAdjacentHTML('beforeend', html);
  }
});
await page.waitForTimeout(500);

const m = await page.evaluate(() => {
  const out = {};
  const asst = document.querySelector('.msg--assistant .msg__bubble');
  const user = document.querySelector('.msg--user .msg__bubble');
  if (asst) {
    const cs = getComputedStyle(asst);
    out.asst = {
      bg: cs.backgroundColor,
      longhand: `${cs.borderTopLeftRadius} ${cs.borderTopRightRadius} ${cs.borderBottomRightRadius} ${cs.borderBottomLeftRadius}`,
    };
  }
  if (user) {
    const cs = getComputedStyle(user);
    out.user = {
      bg: cs.backgroundColor,
      longhand: `${cs.borderTopLeftRadius} ${cs.borderTopRightRadius} ${cs.borderBottomRightRadius} ${cs.borderBottomLeftRadius}`,
    };
  }
  return out;
});
console.log(JSON.stringify(m, null, 2));

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-chat-bubbles.png", fullPage: false });
console.log("ok");
await app.close();
