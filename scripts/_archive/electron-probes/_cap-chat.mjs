import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-chat-"));
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

// Try to start a new session via the new-chat button
const newSession = await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="新建任务"], [aria-label="新建会话"], [class*="new-chat"], [class*="new-session"]');
  if (btn) { btn.click(); return "clicked: " + (btn.className || ""); }
  return "not found";
});
console.log("newSession:", newSession);
await page.waitForTimeout(2500);

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
  return {
    home: b('.home'),
    chatView: b('.chat-view, [class*="chat-view"], .conversation'),
    composer: b('.wb-composer-wrap, .composer'),
    messagesArea: b('[class*="messages"], [class*="chat-messages"]'),
    topbar: b('.main-topbar, [class*="topbar"]'),
    placeholder: b('[class*="placeholder"]'),
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-after-new-chat.png" });
await app.close();
