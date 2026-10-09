/**
 * _diag-init.mjs — minimal diagnostic to check whether agent:init returns.
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-diag-init-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });

console.log("[diag] launching electron...");
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--enable-logging"],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 60_000,
});

const page = await app.firstWindow({ timeout: 60_000 });
console.log("[diag] first window obtained");

const consoleLines = [];
page.on("console", (msg) => {
  consoleLines.push(`[${msg.type()}] ${msg.text().slice(0, 200)}`);
});

await page.waitForTimeout(3000);

console.log("\n[diag] invoking agent:init...");
const t0 = Date.now();
try {
  const result = await Promise.race([
    page.evaluate(() => window.api.invoke("agent:init")),
    new Promise((_, reject) => setTimeout(() => reject(new Error("agent:init TIMEOUT 45s")), 45_000)),
  ]);
  console.log("[diag] agent:init returned in", Date.now() - t0, "ms");
  console.log("[diag] result:", JSON.stringify(result, null, 2));
} catch (err) {
  console.log("[diag] agent:init FAILED after", Date.now() - t0, "ms:", err.message);
}

console.log("\n[diag] ===== CONSOLE TAIL =====");
for (const line of consoleLines.slice(-30)) console.log(line);

await app.close();
console.log("[diag] done");
process.exit(0);
