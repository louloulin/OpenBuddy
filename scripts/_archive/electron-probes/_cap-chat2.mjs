import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-chat2-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.setViewportSize({ width: 1728, height: 1091 });
await page.waitForTimeout(1500);

// Click on the "新建任务" sidebar nav item
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('.sidebar__nav-item'));
  const newItem = items.find(el => el.textContent?.includes('新建任务'));
  if (newItem) newItem.click();
});
await page.waitForTimeout(3000);

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
  return {
    home: b('.home'),
    chatView: b('[class*="chat-view"], [class*="ChatView"], .conversation'),
    composer: b('.wb-composer-wrap'),
    messages: b('[class*="messages-list"], [class*="message-list"]'),
    topbar: b('.main-topbar'),
    placeholder: b('[class*="placeholder"]'),
    activeView: document.querySelector('.sidebar__nav-item--active')?.textContent?.trim(),
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-chat-empty.png" });
await app.close();
