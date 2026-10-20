/**
 * _diag-main.mjs — Launch Electron directly (not via Playwright) and capture
 * ALL stdout/stderr from the main process during a user-triggered init.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-diag-main-"));
const electronPath = join(ROOT, "node_modules", ".bin", "electron");

console.log("[main-diag] launching electron from", electronPath);
console.log("[main-diag] user data:", userData);

const child = spawn(electronPath, [ROOT, `--user-data-dir=${userData}`], {
  cwd: ROOT,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: "1",
    OPENBUDDY_DEBUG_INIT: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    console.log("[main-stdout]", line);
  }
});

child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    console.log("[main-stderr]", line);
  }
});

child.on("exit", (code, signal) => {
  console.log(`[main-diag] electron exited: code=${code} signal=${signal}`);
  process.exit(code ?? 1);
});

setTimeout(() => {
  console.log("[main-diag] killing electron after 30s");
  child.kill("SIGTERM");
}, 30_000);
