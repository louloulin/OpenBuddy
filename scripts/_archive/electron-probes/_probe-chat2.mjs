import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-c2-"));
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
// Try clicking the first session in sidebar
try {
  await page.click('.sidebar__session-row, [class*="session"]', { timeout: 3000 });
  await page.waitForTimeout(2000);
} catch (e) {
  console.log("click session failed:", e.message);
}
await page.screenshot({ path: "/tmp/ob-after-chat.png" });
// Check for right-side elements on chat view
const chat = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('body *'));
  const rightStuff = all.filter(el => {
    const cls = (el.className || '').toString();
    return /right|tool-side|side-panel/.test(cls);
  }).filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  // Just main area structure
  const main = document.querySelector('.app__main');
  const kids = main ? Array.from(main.children).map(el => ({
    cls: (el.className || '').toString().slice(0, 60),
    x: Math.round(el.getBoundingClientRect().x),
    w: Math.round(el.getBoundingClientRect().width),
  })) : [];
  return { rightStuffCount: rightStuff.length, mainKids: kids };
});
console.log(JSON.stringify(chat, null, 2));
await app.close();
