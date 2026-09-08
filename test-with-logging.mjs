import { _electron as electron } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = "/Users/louloulin/appx/OpenBuddy";
const electronPath = join(root, "node_modules", ".bin", "electron");

const app = await electron.launch({
  args: [`--user-data-dir=/tmp/openbuddy-test`, root],
  executablePath: electronPath,
  cwd: root,
  timeout: 30000,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
});

const page = await app.firstWindow();
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
console.log("[test] window loaded");

// Wait for pi init
await page.waitForTimeout(3000);

// Get the api
const result = await page.evaluate(async () => {
  try {
    const init = await window.api.invoke("agent:init");
    return { ok: true, init };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
});
console.log("[test] agent:init result:", JSON.stringify(result, null, 2));

// Try new-session
const ns = await page.evaluate(async () => {
  try {
    const r = await window.api.invoke("agent:new-session", { cwd: "/tmp/openbuddy-test", modelId: "openbuddy-e2e-echo-model" });
    return { ok: true, value: r };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
});
console.log("[test] agent:new-session result:", JSON.stringify(ns, null, 2));

await app.close();
process.exit(0);
