import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TAG = process.argv[2] ?? "before";
const userData = mkdtempSync(join(tmpdir(), "ob-r17-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1200);

// click the bottom-left user button
await page.click(".sidebar__user", { force: true });
await page.waitForTimeout(900);

const report = await page.evaluate(() => {
  const menu = document.querySelector(".sidebar__account-menu");
  const btn = document.querySelector(".sidebar__user");
  const footer = document.querySelector(".sidebar__footer");
  if (!menu) return { menuMounted: false };
  const mr = menu.getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  const fr = footer.getBoundingClientRect();
  const cx = mr.left + mr.width / 2;
  const cy = mr.top + mr.height / 2;
  const topEl = document.elementFromPoint(cx, cy);
  return {
    menuMounted: true,
    menuRect: { x: Math.round(mr.left), y: Math.round(mr.top), w: Math.round(mr.width), h: Math.round(mr.height) },
    buttonRect: { x: Math.round(br.left), y: Math.round(br.top), w: Math.round(br.width), h: Math.round(br.height) },
    footerRect: { x: Math.round(fr.left), y: Math.round(fr.top), w: Math.round(fr.width), h: Math.round(fr.height) },
    menuOutsideFooter: mr.top < fr.top,
    hitTestAtMenuCenter: topEl ? `${topEl.tagName}.${String(topEl.className).slice(0, 60)}` : null,
    hitIsInsideMenu: !!(topEl && menu.contains(topEl)),
    menuOverflowHidden: getComputedStyle(menu).position,
    footerOverflow: getComputedStyle(footer).overflow,
    sidebarOverflow: getComputedStyle(document.querySelector(".sidebar")).overflow,
  };
});
console.log("REPORT:", JSON.stringify(report, null, 2));
await page.screenshot({ path: join(ROOT, "tests/screenshots", `r17-account-menu-${TAG}.png`) });
await app.close();
process.exit(0);
