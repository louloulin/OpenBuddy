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

// Force dark
await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.waitForTimeout(500);

await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const newBtn = buttons.find(b => /新建|new/i.test(b.textContent || b.getAttribute('aria-label') || ''));
  if (newBtn) newBtn.click();
});
await page.waitForTimeout(2000);

const ta = await page.locator('.wb-composer textarea').first();
await ta.fill('暗色模式测试');
await ta.press('Enter');
await page.waitForTimeout(2000);

await page.evaluate(() => {
  const chatview = document.querySelector('.chatview');
  if (chatview) {
    const inner = chatview.querySelector('[class*="inner"]') || chatview;
    inner.insertAdjacentHTML('beforeend', '<div class="msg msg--assistant"><div class="msg__bubble">暗色模式助理气泡</div></div>');
  }
});
await page.waitForTimeout(500);

const m = await page.evaluate(() => {
  const asst = document.querySelector('.msg--assistant .msg__bubble');
  const user = document.querySelector('.msg--user .msg__bubble');
  const out = { theme: document.documentElement.getAttribute('data-theme') };
  if (asst) {
    const cs = getComputedStyle(asst);
    out.asst = {
      bg: cs.backgroundColor,
      color: cs.color,
      longhand: `${cs.borderTopLeftRadius} ${cs.borderTopRightRadius} ${cs.borderBottomRightRadius} ${cs.borderBottomLeftRadius}`,
    };
  }
  if (user) {
    const cs = getComputedStyle(user);
    out.user = {
      bg: cs.backgroundColor,
      color: cs.color,
      longhand: `${cs.borderTopLeftRadius} ${cs.borderTopRightRadius} ${cs.borderBottomRightRadius} ${cs.borderBottomLeftRadius}`,
    };
  }
  return out;
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-chat-dark-bubbles.png", fullPage: false });
await app.close();
