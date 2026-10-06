import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ec-"));
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

// Click new session
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const newBtn = btns.find(b => /新建|new/i.test(b.textContent || b.getAttribute('aria-label') || ''));
  if (newBtn) newBtn.click();
});
await page.waitForTimeout(2000);

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r8-chat-empty.png", fullPage: false });

const m = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return {
    chatView: b('.chatview'),
    emptyState: b('.chatview__empty-state'),
    title: document.querySelector('.chatview__empty-state-title')?.textContent?.slice(0, 50),
    subtitle: document.querySelector('.chatview__empty-state-subtitle')?.textContent?.slice(0, 100),
    icon: document.querySelector('.chatview__empty-state-icon')?.textContent?.slice(0, 5),
    tags: Array.from(document.querySelectorAll('.chatview__empty-state-tag')).map(t => t.textContent?.trim()),
    hint: document.querySelector('.chatview__empty-state-hint')?.textContent?.slice(0, 100),
    composer: b('.wb-composer'),
    composerPosition: b('.wb-composer-wrap, .home__composer-area, [class*="composer"]'),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
