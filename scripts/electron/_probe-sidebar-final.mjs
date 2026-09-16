import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-sbf-"));
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
  const sc = document.querySelector(".sidebar__content");
  const sb = document.querySelector(".sidebar");
  if (!sc || !sb) return { error: "missing" };
  // 33 sessions — measure if scrollbar would show
  const items = Array.from(sc.querySelectorAll("button[class*='conv'], [class*='sidebar__item'], .sidebar__section-item, button")).slice(0, 5).map(el => {
    const r = el.getBoundingClientRect();
    return { cls: el.className.toString().slice(0, 50), h: Math.round(r.height) };
  });
  const totalContentHeight = sc.scrollHeight;
  const visibleHeight = sc.clientHeight;
  return {
    sidebarH: sb.getBoundingClientRect().height,
    contentH: sc.getBoundingClientRect().height,
    contentClientH: sc.clientHeight,
    contentScrollH: totalContentHeight,
    wouldScroll: totalContentHeight > visibleHeight,
    sampleItems: items,
    scrollbarComputed: (() => {
      const cs = getComputedStyle(sc);
      return { scrollbarColor: cs.scrollbarColor, scrollbarWidth: cs.scrollbarWidth };
    })(),
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
