import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-htxt-"));
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
await win.evaluate((w) => { w.setContentSize(1728, 1031); });
await page.waitForTimeout(2500);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  const allH1 = document.querySelectorAll("h1");
  const h1s = Array.from(allH1).map(h => {
    const r = h.getBoundingClientRect();
    return { text: h.textContent.trim().slice(0, 50), y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) };
  });
  const h2s = Array.from(document.querySelectorAll("h2")).map(h => ({ text: h.textContent.trim().slice(0, 30), y: Math.round(h.getBoundingClientRect().y) }));
  // Find the hero text
  const heroText = document.querySelector(".home__hero")?.textContent.trim().slice(0, 200);
  return { h1s, h2s, heroText };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
