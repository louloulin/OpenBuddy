import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-tv-"));
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

const firstSession = await page.$(".sidebar__conv");
if (firstSession) {
  await firstSession.click();
  await page.waitForTimeout(1500);
}

const r = await page.evaluate(() => {
  const pill = document.querySelector(".main-topbar__version-pill");
  const statusChip = document.querySelector(".main-topbar [class*='status'], .main-topbar [class*='chip']");
  return {
    versionPill: pill ? { text: pill.textContent.trim(), cls: pill.className, rect: { x: Math.round(pill.getBoundingClientRect().x), y: Math.round(pill.getBoundingClientRect().y), w: Math.round(pill.getBoundingClientRect().width), h: Math.round(pill.getBoundingClientRect().height) } } : null,
    statusChip: statusChip ? { text: statusChip.textContent.trim().slice(0, 30), cls: statusChip.className } : null,
  };
});
console.log("Topbar version+status:", JSON.stringify(r, null, 2));
await app.close();
