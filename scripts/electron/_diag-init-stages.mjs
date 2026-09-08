/**
 * _diag-init-stages.mjs — instrument the init pipeline to find where it hangs.
 *
 * Strategy: monkey-patch key bootstrap helpers to log entry/exit timing.
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-diag-init-stages-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });

const electronPath = join(ROOT, "node_modules", ".bin", "electron");

console.log("[diag-stages] launching electron...");
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--enable-logging"],
  executablePath: electronPath,
  timeout: 60_000,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: "1",
    OPENBUDDY_DEBUG_INIT: "1",
    OPENBUDDY_DEBUG_UI: "1",
    // This flag — if present — usually turns on verbose init logging
    DEBUG: "openbuddy:*",
  },
});

const page = await app.firstWindow({ timeout: 60_000 });
console.log("[diag-stages] first window obtained");

const lines = [];
page.on("console", (msg) => lines.push(`[${msg.type()}] ${msg.text().slice(0, 250)}`));

const mainOut = [];
const mainErr = [];
app.process().stdout?.on("data", (d) => mainOut.push(d.toString()));
app.process().stderr?.on("data", (d) => mainErr.push(d.toString()));

await page.waitForTimeout(3000);

console.log("\n[diag-stages] === invoking agent:init ===");
const t0 = Date.now();
try {
  const result = await Promise.race([
    page.evaluate(() => window.api.invoke("agent:init")),
    new Promise((_, reject) => setTimeout(() => reject(new Error("agent:init TIMEOUT 45s")), 45_000)),
  ]);
  console.log("[diag-stages] agent:init OK in", Date.now() - t0, "ms");
  console.log("[diag-stages] result:", JSON.stringify(result, null, 2));
} catch (err) {
  console.log("[diag-stages] agent:init FAILED after", Date.now() - t0, "ms:", err.message);
}

console.log("\n[diag-stages] === LAST 50 MAIN STDOUT LINES ===");
for (const line of mainOut.join("").split("\n").slice(-50)) {
  if (line.trim()) console.log("  ", line.slice(0, 250));
}

console.log("\n[diag-stages] === LAST 50 MAIN STDERR LINES ===");
for (const line of mainErr.join("").split("\n").slice(-50)) {
  if (line.trim()) console.log("  ", line.slice(0, 250));
}

console.log("\n[diag-stages] === RENDERER CONSOLE TAIL ===");
for (const line of lines.slice(-30)) console.log("  ", line.slice(0, 250));

await app.close();
console.log("[diag-stages] done");
process.exit(0);
