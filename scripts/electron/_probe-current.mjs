import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-current-"));
mkdirSync("/tmp/ob-shots", { recursive: true });

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

// Close any onboarding wizard first
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

// Capture screenshots of sidebar footer + topbar
await page.screenshot({ path: "/tmp/ob-shots/full-home.png" });

const footer = await page.locator(".sidebar__footer").boundingBox();
if (footer) {
  await page.screenshot({
    path: "/tmp/ob-shots/sidebar-footer.png",
    clip: { x: footer.x, y: footer.y, width: footer.width, height: footer.height }
  });
}

const sb = await page.locator(".app__sidebar, aside.sidebar").first().boundingBox();
if (sb) {
  await page.screenshot({
    path: "/tmp/ob-shots/sidebar-full.png",
    clip: { x: sb.x, y: sb.y, width: sb.width, height: sb.height }
  });
}

// Dump all the elements in sidebar footer with bounding rects
const dump = await page.evaluate(() => {
  const footer = document.querySelector(".sidebar__footer");
  if (!footer) return null;
  const all = Array.from(footer.querySelectorAll("*"));
  const items = all.map(el => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className?.toString?.().slice(0, 80),
      aria: el.getAttribute("aria-label"),
      title: el.getAttribute("title"),
      text: el.textContent?.trim().slice(0, 30),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      visible: r.width > 0 && r.height > 0,
    };
  }).filter(i => i.visible);
  return {
    footerRect: (() => { const r = footer.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
    children: items,
  };
});
console.log("=== Sidebar Footer Dump ===");
console.log(JSON.stringify(dump, null, 2));

await app.close();
