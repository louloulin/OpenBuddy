import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cv-"));
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
// Take 4 screenshots: light expanded, light collapsed, dark, chat view
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-light.png", fullPage: false });

// Now try dark mode
await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.waitForTimeout(800);
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-dark.png", fullPage: false });

// Navigate to a chat (create empty one)
await page.evaluate(() => {
  // Click "new" or similar
  const newBtn = document.querySelector('[aria-label*="新建"], button[aria-label*="新对话"]');
  if (newBtn) newBtn.click();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-chat-light.png", fullPage: false });

// Check what's on the chat page
const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    chatView: b('.chatview'),
    composer: b('.wb-composer'),
    emptyState: b('.chatview__empty-state'),
    msgBubbles: Array.from(document.querySelectorAll('.msg__bubble')).slice(0,3).map(e => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }),
    theme: document.documentElement.getAttribute('data-theme'),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
