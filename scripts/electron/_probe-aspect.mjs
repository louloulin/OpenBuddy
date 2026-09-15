import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-aspect-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(3000);

// Match WorkBuddy aspect ratio: resize browser content area to 1728x1080 (CSS pixels)
try {
  const win = await app.browserWindow(page);
  await win.evaluate((w) => {
    w.setContentSize(1728, 1080);
  });
} catch (e) {
  console.log("setContentSize failed:", e.message);
}
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/ob-1728.png" });
console.log("Screenshot saved at 1728x1080");
await app.close();
