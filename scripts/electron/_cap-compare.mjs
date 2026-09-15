import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cmp-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(3000);

// Take screenshots at the same viewport as WB ref (1728x1091)
await page.setViewportSize({ width: 1728, height: 1091 });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/ob-final.png" });

// And at 1280x800 (smaller)
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/ob-1280.png" });

console.log("done");
await app.close();
