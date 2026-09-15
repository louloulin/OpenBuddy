import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-send-"));
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

// Click on composer textarea
const ta = await page.$('textarea, [contenteditable="true"]');
if (ta) {
  await ta.click();
  await ta.type('测试');
  await page.waitForTimeout(500);
  // Press Cmd+Enter to send
  await page.keyboard.press('Meta+Enter');
  await page.waitForTimeout(3000);
}

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
  return {
    home: b('.home'),
    chatShell: b('.chat-shell, [class*="chat-shell"]'),
    messages: b('[class*="message-list"], [class*="messages-"]'),
    topbar: b('.main-topbar'),
    composer: b('.wb-composer-wrap'),
    messageCount: document.querySelectorAll('[class*="message-"]:not([class*="messages"])').length,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-after-send.png" });
await app.close();
