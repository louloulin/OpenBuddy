import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-mr-"));
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
await page.waitForTimeout(4000);

// Find 更多 button
const moreButton = await page.$(".sidebar__more-wrap, [class*='more-wrap'], [class*='MoreDropdown']");
if (!moreButton) {
  console.log("More button not found");
} else {
  // Hover over 更多
  await moreButton.hover();
  await page.waitForTimeout(500);
  const menuState = await page.evaluate(() => {
    const menu = document.querySelector("[class*='sidebar__more-popover'], [role='menu']");
    if (!menu) return null;
    return {
      visible: menu.getBoundingClientRect().width > 0,
      items: Array.from(menu.querySelectorAll("[role='menuitem'], button, a")).map(el => el.textContent?.trim().slice(0, 30)),
    };
  });
  console.log("More dropdown state:", JSON.stringify(menuState, null, 2));
}

await app.close();
