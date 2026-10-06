import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-ct4-"));
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

// Click settings → 个性化 → 深色
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
  if (t) t.click();
});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll(".theme-toggle__btn")).find((b) => (b.textContent ?? "").includes("深色"));
  b?.click();
});
await page.waitForTimeout(1500);
await page.keyboard.press("Escape");
await page.waitForTimeout(1500);

// Inspect composer position
const composerInfo = await page.evaluate(() => {
  const composer = document.querySelector(".wb-composer");
  if (!composer) return { found: false };
  const r = composer.getBoundingClientRect();
  const input = composer.querySelector(".wb-composer__input");
  const ir = input?.getBoundingClientRect();
  const wrap = composer.closest(".wb-composer-wrap");
  const wr = wrap?.getBoundingClientRect();
  const homeEl = document.querySelector(".wb-composer--home");
  const homeR = homeEl?.getBoundingClientRect();
  return {
    composerRect: { x: r.x, y: r.y, width: r.width, height: r.height },
    inputRect: ir ? { x: ir.x, y: ir.y, width: ir.width, height: ir.height } : null,
    wrapRect: wr ? { x: wr.x, y: wr.y, width: wr.width, height: wr.height } : null,
    hasHomeClass: !!homeEl,
    homeRect: homeR ? { x: homeR.x, y: homeR.y, width: homeR.width, height: homeR.height } : null,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    bodyScroll: { x: window.scrollX, y: window.scrollY },
    composerHidden: composer.offsetParent === null,
    composerVisibility: getComputedStyle(composer).visibility,
    composerOpacity: getComputedStyle(composer).opacity,
    composerDisplay: getComputedStyle(composer).display,
  };
});
console.log("COMPOSER:", JSON.stringify(composerInfo, null, 2));

await page.screenshot({ path: join(ROOT, "tests/screenshots/r17c-composer-dark.png"), fullPage: false });
await app.close();
process.exit(0);
