import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-asstd-"));
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
await page.click(".sidebar__nav-item:nth-child(2)");
await page.waitForTimeout(1200);

const r = await page.evaluate(() => {
  const all = document.querySelectorAll("span, div, p");
  const matches = Array.from(all).filter(el => el.textContent.includes("始终询问") || el.textContent.includes("本地助理已连接")).slice(0, 5);
  return matches.map(el => {
    const r = el.getBoundingClientRect();
    const parent = el.parentElement;
    const grandparent = parent?.parentElement;
    return {
      tag: el.tagName,
      cls: el.className.toString().slice(0, 60),
      text: el.textContent.trim().slice(0, 100),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      overflow: el.scrollWidth > el.clientWidth,
      parentCls: parent?.className.toString().slice(0, 60),
      gpCls: grandparent?.className.toString().slice(0, 60),
    };
  });
});
console.log(JSON.stringify(r, null, 2));
await app.close();
