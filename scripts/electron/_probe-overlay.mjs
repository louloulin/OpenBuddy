import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-overlay-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({ args: [`--user-data-dir=${userData}`, root], executablePath: join(root, "node_modules", ".bin", "electron"), cwd: root, timeout: 40_000, env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" } });
const page = await app.firstWindow();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push("[pageerror] " + e.message));
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Array.isArray(window.__ob_builtin_report), undefined, { timeout: 20_000 });
const out = await page.evaluate(() => {
  const report = window.__ob_builtin_report ?? [];
  return {
    automation: report.find((r) => r.pkg === "@openbuddy/ui-automation"),
    settings: report.find((r) => r.pkg === "@openbuddy/ui-settings"),
    dialogs: report.find((r) => r.pkg === "@openbuddy/ui-dialogs"),
    workbench: report.find((r) => r.pkg === "@openbuddy/ui-workbench"),
  };
});
console.log(JSON.stringify(out, null, 2));
console.log("=== console ===");
console.log(logs.join("\n") || "(none)");
await app.close();
