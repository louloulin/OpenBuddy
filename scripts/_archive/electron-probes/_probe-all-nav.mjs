import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-nav2-"));
mkdirSync("/tmp/openbuddy-shots", { recursive: true });
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

const navItems = await page.$$eval(".sidebar__nav-item", els => els.map(e => e.textContent.trim()));
console.log("Nav items found:", navItems.length, navItems);
for (let i = 0; i < navItems.length; i++) {
  await page.click(`.sidebar__nav-item >> nth=${i}`);
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    const content = main ? main.children[1] : null;
    return {
      activeNav: document.querySelector(".sidebar__nav-item--act")?.textContent.trim(),
      contentCls: content ? content.className.toString().slice(0, 60) : null,
      contentY: content ? Math.round(content.getBoundingClientRect().y) : null,
      contentH: content ? Math.round(content.getBoundingClientRect().height) : null,
      contentText: content ? content.textContent.trim().slice(0, 80) : null,
    };
  });
  console.log(`[${i + 1}/${navItems.length}] ${navItems[i]}: ${JSON.stringify(r)}`);
}
await app.close();
