import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-lc-"));
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

const m = await page.evaluate(() => {
  const cs = (s, p) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el)[p]; };
  return {
    theme: document.documentElement.getAttribute('data-theme') || 'light',
    bodyBg: cs('body', 'backgroundColor'),
    appBg: cs('.app', 'backgroundColor'),
    mainBg: cs('.app__main', 'backgroundColor'),
    sidebarBg: cs('.sidebar', 'backgroundColor'),
    composerBg: cs('.wb-composer', 'backgroundColor'),
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/light-home-check.png" });
await app.close();
