import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-more-"));
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

// Hover over the 7th nav item (更多) to open popover
const seventh = await page.$$(".sidebar__nav-item");
console.log("Total nav items:", seventh.length);
await seventh[6].hover();
await page.waitForTimeout(500);
const popover = await page.evaluate(() => {
  const pop = document.querySelector(".sidebar__more-popover");
  if (!pop) return null;
  const r = pop.getBoundingClientRect();
  const items = Array.from(pop.querySelectorAll("button, [role='menuitem'], a")).map(b => ({
    tag: b.tagName,
    text: b.textContent.trim().slice(0, 30),
    aria: b.getAttribute("aria-label") || "",
  }));
  return { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width), items };
});
console.log("Popover:", JSON.stringify(popover, null, 2));
await app.close();
