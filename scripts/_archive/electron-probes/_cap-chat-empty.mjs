import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ce-"));
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

// Click "new session" button
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const newBtn = buttons.find(b => /新建|new/i.test(b.textContent || b.getAttribute('aria-label') || ''));
  if (newBtn) newBtn.click();
});
await page.waitForTimeout(2000);

// Now we should be in chat view
const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const cs = (s, p) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el)[p]; };
  return {
    chatView: b('.chatview'),
    emptyState: b('.chatview__empty-state'),
    composer: b('.wb-composer'),
    timeline: document.querySelectorAll('.msg').length,
    pageUrl: location.href,
    hasMsgBubble: !!document.querySelector('.msg__bubble'),
    bodyClasses: document.body.className,
  };
});
console.log('initial:', JSON.stringify(m, null, 2));

// Try clicking somewhere to focus composer
const ta = await page.locator('.wb-composer textarea').first();
if (await ta.count() > 0) {
  await ta.fill('测试消息');
  await page.waitForTimeout(500);
  // Try to send (depends on key handler)
  await ta.press('Enter');
  await page.waitForTimeout(3000);
  
  const m2 = await page.evaluate(() => {
    return {
      timeline: document.querySelectorAll('.msg').length,
      msgBubbleStyles: Array.from(document.querySelectorAll('.msg__bubble')).slice(0, 3).map(el => {
        const cs = getComputedStyle(el);
        return {
          bg: cs.backgroundColor,
          color: cs.color,
          radius: cs.borderRadius,
        };
      }),
      msgItems: Array.from(document.querySelectorAll('.msg')).slice(0, 3).map(el => ({
        classes: el.className,
        msgRole: el.closest('[data-role]')?.getAttribute('data-role') || '',
      })),
    };
  });
  console.log('after msg:', JSON.stringify(m2, null, 2));
}

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-chat-with-msg.png", fullPage: false });
console.log('screenshot ok');
await app.close();
