import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-chat-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(2500);
// Click on first session to enter chat view
try {
  await page.click('text="OpenBuddy"', { timeout: 3000 });
  await page.waitForTimeout(1500);
} catch {}
await page.screenshot({ path: "/tmp/ob-chat.png" });
const result = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('body *'));
  const rightStuff = all.filter(el => {
    const cls = (el.className || '').toString();
    return /home__topbar|home__points-chip|home__activity-banner|app__right-panel|right-panel|rightPanel|StatusBar|status-bar|statusbar/.test(cls);
  });
  const visible = rightStuff.filter(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
  });
  // Show structure of main content area
  const mainKids = Array.from(document.querySelector('.app__main')?.children || []).map(el => ({
    cls: (el.className || '').toString().slice(0, 80),
    text: (el.textContent || '').slice(0, 80).replace(/\s+/g, ' '),
    x: Math.round(el.getBoundingClientRect().x),
    y: Math.round(el.getBoundingClientRect().y),
    w: Math.round(el.getBoundingClientRect().width),
  }));
  return {
    rightIssuesVisible: visible.length,
    mainChildren: mainKids,
  };
});
console.log(JSON.stringify(result, null, 2));
await app.close();
