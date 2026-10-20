import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-sbc-"));
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
  if (!sc) return { error: "no .sidebar__content" };
  const ancestors = [];
  let el = sc.parentElement;
  while (el && ancestors.length < 8) {
    ancestors.push({ tag: el.tagName, cls: el.className.toString().slice(0, 60) });
    el = el.parentElement;
  }
  const cs = getComputedStyle(sc);
  return {
    scClass: sc.className,
    scParentClass: sc.parentElement?.className.toString().slice(0, 60),
    ancestors,
    computedFlex: cs.flex,
    computedMinHeight: cs.minHeight,
    computedOverflow: cs.overflow,
    computedOverflowY: cs.overflowY,
    computedHeight: sc.getBoundingClientRect().height,
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
