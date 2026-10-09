import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-more2-"));
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

// Hover 更多 (sidebar 7th nav)
const navItems = await page.$$(".sidebar__nav-item");
await navItems[6].hover();
await page.waitForTimeout(500);

const popoverItems = await page.evaluate(() => {
  const pop = document.querySelector(".sidebar__more-popover");
  if (!pop) return null;
  return Array.from(pop.querySelectorAll("button")).slice(0, 12).map(b => b.textContent.trim().slice(0, 30));
});
console.log("Popover items:", JSON.stringify(popoverItems));

// Click "灵感" (inspiration) item
const inspirationBtn = await page.$(".sidebar__more-popover button:has-text('灵感')");
if (inspirationBtn) {
  await inspirationBtn.click();
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    return {
      activeNav: document.querySelector(".sidebar__nav-item--act")?.textContent.trim(),
      mainKids: main ? Array.from(main.children).map(c => c.tagName + "." + c.className.toString().slice(0, 60)) : [],
      pageErrors: window.__PAGE_ERRORS__ || [],
    };
  });
  console.log("After 灵感 click:", JSON.stringify(after));
}

// Click "网页预览" (browser preview)
await navItems[6].hover();
await page.waitForTimeout(500);
const browserBtn = await page.$(".sidebar__more-popover button:has-text('网页预览')");
if (browserBtn) {
  await browserBtn.click();
  await page.waitForTimeout(1000);
  const after2 = await page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    return {
      mainKids: main ? Array.from(main.children).map(c => c.tagName + "." + c.className.toString().slice(0, 60)) : [],
      pageErrors: window.__PAGE_ERRORS__ || [],
    };
  });
  console.log("After 网页预览 click:", JSON.stringify(after2));
}

await app.close();
