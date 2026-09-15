import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-current-"));
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
await page.screenshot({ path: "/tmp/ob-current-home.png" });
// 验证微内核
const report = await page.evaluate(() => {
  const r = window.__ob_builtin_report ?? [];
  return {
    total: r.length,
    ok: r.filter(x => x.ok).length,
    pkgs: r.map(x => `${x.pkg}=${x.ok ? "ok" : "FAIL"}(${x.slotsRegistered})`),
  };
});
console.log(JSON.stringify(report, null, 2));
await app.close();
