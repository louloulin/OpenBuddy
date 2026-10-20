import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TAG = process.argv[2] ?? "before";
const userData = mkdtempSync(join(tmpdir(), "ob-r17v-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

await page.click(".sidebar__user");
await page.waitForTimeout(800);

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
  // visibility chain: walk up from menu and check for clipping ancestors
  let clipping = [];
  let node = menu.parentElement;
  while (node && node !== document.documentElement) {
    const cs = getComputedStyle(node);
    if (cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible") {
      const nr = node.getBoundingClientRect();
      clipping.push({
        sel: `${node.tagName}.${String(node.className).slice(0, 40)}`,
        overflow: `${cs.overflow}/${cs.overflowX}/${cs.overflowY}`,
        rect: { y: Math.round(nr.top), h: Math.round(nr.height) },
        clipsMenuTop: nr.top > mr.top,
      });
    }
    node = node.parentElement;
  }
  return {
    menuMounted: true,
    menuRect: { x: Math.round(mr.left), y: Math.round(mr.top), w: Math.round(mr.width), h: Math.round(mr.height) },
    buttonRect: { x: Math.round(br.left), y: Math.round(br.top), w: Math.round(br.width), h: Math.round(br.height) },
    footerRect: { x: Math.round(fr.left), y: Math.round(fr.top), w: Math.round(fr.width), h: Math.round(fr.height) },
    menuAboveFooter: mr.top < fr.top,
    hitAtMenuCenter: topEl ? `${topEl.tagName}.${String(topEl.className).slice(0, 50)}` : null,
    hitIsInsideMenu: !!(topEl && menu.contains(topEl)),
    items: Array.from(menu.querySelectorAll("[role='menuitem']")).map((b) => b.textContent?.trim()),
    clippingAncestors: clipping,
  };
});
console.log("REPORT:", JSON.stringify(report, null, 2));
await page.screenshot({ path: join(ROOT, "tests/screenshots", `r17-menu-${TAG}.png`) });
await app.close();
process.exit(0);
