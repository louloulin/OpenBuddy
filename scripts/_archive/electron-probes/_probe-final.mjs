import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-final-"));
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
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/ob-final.png" });
// Check no right side issue
const result = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('body *'));
  const rightStuff = all.filter(el => {
    const cls = (el.className || '').toString();
    return /home__topbar|home__points-chip|home__activity-banner|app__right-panel|right-panel|rightPanel|StatusBar|status-bar|statusbar/.test(cls);
  });
  return {
    rightIssuesFound: rightStuff.length,
    samples: rightStuff.slice(0, 3).map(el => el.className.toString()),
  };
});
console.log(JSON.stringify(result, null, 2));
await app.close();
