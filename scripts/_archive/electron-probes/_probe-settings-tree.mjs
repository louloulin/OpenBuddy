import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-str-"));
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
await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1000);

const r = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog']");
  if (!dialog) return { error: "no dialog" };
  // 找 dialog 整体 DOM 结构
  function dom(el, depth = 0) {
    if (depth > 3) return null;
    const r = el.getBoundingClientRect();
    const children = Array.from(el.children).map(c => ({
      tag: c.tagName,
      cls: c.className.toString().slice(0, 40),
      x: Math.round(c.getBoundingClientRect().x),
      w: Math.round(c.getBoundingClientRect().width),
      child: dom(c, depth + 1),
    }));
    return { tag: el.tagName, cls: el.className.toString().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), kids: children };
  }
  // 找最外层 modal
  const modal = dialog.querySelector(".settings-modal") || dialog;
  return { tree: dom(modal) };
});
console.log(JSON.stringify(r, null, 2).slice(0, 3000));
await app.close();
