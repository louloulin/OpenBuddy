import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-msg-"));
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

// Send a message
const ta = await page.$('textarea');
await ta.click();
await ta.type('分析一下本季度销售数据');
await page.keyboard.press('Meta+Enter');
await page.waitForTimeout(3000);

// Wait for AI response (max 30s)
const startTime = Date.now();
let aiResponded = false;
while (Date.now() - startTime < 20000) {
  const msgCount = await page.evaluate(() => document.querySelectorAll('.msg').length);
  if (msgCount >= 2) {
    aiResponded = true;
    break;
  }
  await page.waitForTimeout(500);
}

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
  const cs = (s, p) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el)[p]; };
  const userMsg = document.querySelector('.msg--user');
  const aiMsg = document.querySelector('.msg--assistant, .msg--ai, .msg:not(.msg--user)');
  return {
    msgCount: document.querySelectorAll('.msg').length,
    userMsgRect: b('.msg--user'),
    aiMsgRect: b('.msg--assistant, .msg:not(.msg--user)'),
    userBubbleBg: cs('.msg--user .msg__bubble', 'backgroundColor'),
    aiBubbleBg: cs('.msg--assistant .msg__bubble, .msg:not(.msg--user) .msg__bubble', 'backgroundColor'),
    userBubbleColor: cs('.msg--user .msg__bubble', 'color'),
    aiBubbleColor: cs('.msg--assistant .msg__bubble, .msg:not(.msg--user) .msg__bubble', 'color'),
    aiResponded: !!aiMsg,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-msg.png" });
await app.close();
