import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r12-"));
mkdirSync("/tmp/ob-r12", { recursive: true });

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

await page.screenshot({ path: "/tmp/ob-r12/home.png" });

// Check subtitle is now visible on home
const subtitle = await page.evaluate(() => {
  const el = document.querySelector(".home__subtitle");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    text: el.textContent,
    visible: r.width > 0 && r.height > 0,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    display: cs.display,
    color: cs.color,
    fontSize: cs.fontSize,
  };
});
console.log("Home subtitle:", JSON.stringify(subtitle, null, 2));

// Check sidebar "更多" sub-label
const navSub = await page.evaluate(() => {
  const el = document.querySelector(".sidebar__nav-sub");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    text: el.textContent,
    textLength: el.textContent.length,
    visible: r.width > 0 && r.height > 0,
    rect: { w: Math.round(r.width), h: Math.round(r.height) },
  };
});
console.log("Sidebar nav-sub (更多 hint):", JSON.stringify(navSub, null, 2));

// Click "更多" to open dropdown, then check for 灵感
await page.hover(".sidebar__more-wrap");
await page.waitForTimeout(600);
const dropdownInfo = await page.evaluate(() => {
  const all = document.querySelectorAll("*");
  const matches = [];
  for (const el of Array.from(all)) {
    if (el.textContent === "灵感" && el.children.length === 0) {
      const r = el.getBoundingClientRect();
      matches.push({
        tag: el.tagName,
        cls: (el.className?.toString() || "").slice(0, 60),
        visible: r.width > 0 && r.height > 0,
        aria: el.getAttribute("aria-hidden"),
      });
    }
  }
  return matches;
});
console.log("\n灵感 elements when 更多 dropdown open:", JSON.stringify(dropdownInfo, null, 2));

await page.screenshot({ path: "/tmp/ob-r12/home-with-dropdown.png" });

// Test tab switching
await page.mouse.move(0, 0);
await page.waitForTimeout(400);
await page.click("[role='tab']:has-text('代码开发')");
await page.waitForTimeout(500);
const subtitle2 = await page.evaluate(() => document.querySelector(".home__subtitle")?.textContent);
console.log("Subtitle after switching to code tab:", subtitle2);

await page.screenshot({ path: "/tmp/ob-r12/home-code-tab.png" });

await app.close();
