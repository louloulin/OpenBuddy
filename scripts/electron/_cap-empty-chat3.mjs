import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ec3-"));
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

// Send a message which creates a session, then verify the chatview appears
const ta = await page.locator('.wb-composer textarea').first();
await ta.fill('测试会话创建');
await ta.press('Enter');
await page.waitForTimeout(3000);

// Now check
const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    chatView: b('.chatview'),
    emptyState: b('.chatview__empty-state'),
    home: b('.home'),
    timelineCount: document.querySelectorAll('.msg').length,
    mainChildren: Array.from(document.querySelector('main')?.children || []).map(c => c.className?.slice(0, 60)),
  };
});
console.log(JSON.stringify(m, null, 2));

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r8-after-send.png", fullPage: false });
await app.close();
