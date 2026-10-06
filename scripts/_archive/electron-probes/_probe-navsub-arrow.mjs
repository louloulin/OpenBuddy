import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-arrow-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, projectRoot],
  executablePath: join(projectRoot, "node_modules", ".bin", "electron"),
  cwd: projectRoot, timeout: 40000,
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

const arrow = await page.evaluate(() => {
  const el = document.querySelector(".sidebar__nav-sub");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el, "::after");
  return {
    elRect: { w: Math.round(r.width), h: Math.round(r.height) },
    elDisplay: getComputedStyle(el).display,
    elPosition: getComputedStyle(el).position,
    afterContent: cs.content,
    afterDisplay: cs.display,
    afterColor: cs.color,
    afterPosition: cs.position,
  };
});
console.log("nav-sub arrow state:", JSON.stringify(arrow, null, 2));

// Take focused screenshot of the "更多" item
const more = await page.locator(".sidebar__more-wrap").first().boundingBox();
if (more) {
  await page.screenshot({
    path: "/tmp/more-item.png",
    clip: { x: more.x, y: more.y - 5, width: more.width + 10, height: more.height + 10 }
  });
  console.log("Saved /tmp/more-item.png");
}

await app.close();
