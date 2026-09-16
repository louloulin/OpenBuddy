import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r11f-"));
mkdirSync("/tmp/ob-r11f", { recursive: true });

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

// Full home screenshot
await page.screenshot({ path: "/tmp/ob-r11f/home.png" });

// Sidebar footer closeup
const footer = await page.locator(".sidebar__footer").boundingBox();
if (footer) {
  await page.screenshot({
    path: "/tmp/ob-r11f/sidebar-footer.png",
    clip: { x: footer.x, y: footer.y, width: footer.width, height: footer.height }
  });
}

// Wider sidebar test
await win.evaluate((w) => { w.setContentSize(1728, 1031); });
await page.waitForTimeout(500);

// Verify hover state on user button
await page.hover(".sidebar__user");
await page.waitForTimeout(500);
await page.screenshot({
  path: "/tmp/ob-r11f/sidebar-footer-hover.png",
  clip: { x: footer.x, y: footer.y, width: footer.width, height: footer.height }
});

console.log("All screenshots captured.");
await app.close();
