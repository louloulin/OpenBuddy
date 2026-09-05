// Real Electron + chat-resilience verification (no GUI window required).
// Boots a real Electron main process via Playwright, then validates:
//   1. main process boots cleanly
//   2. pino file logger actually wrote JSON log lines to the platform log dir
//      (traceId + ISO timestamp + main.started event)
//   3. preload bundle includes listenSafe + getElectronBridgeStatus +
//      electron-bridge-status event channel — the three guards that prevent
//      chat from hanging when the Electron bridge becomes unavailable
//   4. chat IPC handlers actually run end-to-end (verified via captured main
//      console output: agent:init / agent:prompt / agent:new-session received)

import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "openbuddy-chat-smoke-"));
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "pi-env.json"), JSON.stringify({ model: "smoke" }, null, 2));
const electronBin = join(root, "node_modules", ".bin", "electron");

// Both directories need to be checked because Electron's app.getPath("logs")
// returns ~/Library/Logs/OpenBuddy on macOS by default (capital O), while our
// smoke was originally looking for ~/Library/Logs/openbuddy (lowercase).
const candidateLogDirs = [
  join(homedir(), "Library", "Logs", "OpenBuddy"),
  join(homedir(), "Library", "Logs", "openbuddy"),
];

function log(label, value) { console.log(`[smoke:${label}]`, value); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function readMergedLog() {
  let merged = "";
  let files = [];
  let largest = 0;
  for (const dir of candidateLogDirs) {
    if (!existsSync(dir)) continue;
    const here = readdirSync(dir).filter((f) => f.endsWith(".log")).sort();
    for (const f of here) {
      const full = join(dir, f);
      const size = statSync(full).size;
      largest = Math.max(largest, size);
      merged += readFileSync(full, "utf8");
      files.push(`${dir}/${f}`);
    }
  }
  return { merged, files, largest };
}

async function main() {
  let exitCode = 0;
  const failures = [];
  const record = (label, ok, info) => {
    log(label, ok ? "ok" : `FAIL — ${info ?? ""}`);
    if (!ok) { exitCode = 1; failures.push(`${label}: ${info ?? ""}`); }
  };

  log("boot", `userData=${userData}`);

  const app = await electron.launch({
    args: [".", `--user-data-dir=${userData}`],
    cwd: root,
    executablePath: electronBin,
    env: { ...process.env, NODE_ENV: "production", OPENBUDDY_LOG_LEVEL: "debug" },
    timeout: 60_000,
  });

  const mainLines = [];
  app.process().stdout?.on("data", (d) => {
    const s = d.toString();
    mainLines.push(s);
    process.stdout.write(`[main] ${s}`);
  });
  app.process().stderr?.on("data", (d) => {
    const s = d.toString();
    mainLines.push(s);
    process.stderr.write(`[main-err] ${s}`);
  });

  try {
    // give main process time to initialize (app.whenReady, registerIpc, ensureMainLogger)
    await sleep(6000);

    // ---- Phase 1: process readiness ----
    const mainStatus = await app.evaluate(async ({ app }) => ({
      isReady: app.isReady(),
      electronVersion: process.versions.electron,
      pid: process.pid,
      logsPath: (() => { try { return app.getPath("logs"); } catch { return ""; } })(),
    }));
    record("main.app.ready", mainStatus.isReady === true, JSON.stringify(mainStatus));

    // ---- Phase 2: pino file logger actually wrote JSON lines ----
    // ensureMainLogger() in electron/main/index.ts emits "main.started" the first
    // time it's called inside app.whenReady().then(...). So we expect at least
    // one JSON line on disk shortly after launch.
    const logSnapshot = await readMergedLog();
    record("logs.dir.exists", logSnapshot.files.length > 0, JSON.stringify(logSnapshot.files));
    record("logs.files.count>0", logSnapshot.files.length > 0, JSON.stringify(logSnapshot.files));
    record("logs.files.size>0", logSnapshot.largest > 0, `largest=${logSnapshot.largest}B totalChars=${logSnapshot.merged.length}`);

    const jsonLines = logSnapshot.merged.split("\n").filter((l) => l.trim().startsWith("{"));
    record("logs.json.line-count>0", jsonLines.length > 0, `lines=${jsonLines.length}`);

    const hasMainStarted = /"msg":"main\.started"/.test(logSnapshot.merged);
    record("logs.contains.main-started", hasMainStarted, "ensureMainLogger emitted the startup line");

    const hasTraceId = /"traceId":"[a-f0-9-]{8,}/.test(logSnapshot.merged);
    record("logs.contains.trace-id", hasTraceId, "traceId emitted into log file");

    const hasIsoTimestamp = /"time":"\d{4}-\d{2}-\d{2}T/.test(logSnapshot.merged);
    record("logs.contains.iso-timestamp", hasIsoTimestamp, "pino ISO timestamp present");

    // ---- Phase 3: chat IPC handlers actually executed ----
    // ipcMain.handle() channels aren't enumerable via ipcMain.eventNames(), so we
    // verify the chat surface by inspecting captured main-process console output.
    // The agent-host logger emits `ipc.received` lines for every IPC call.
    const chatIpcRegex = /"channel":"(agent:init|agent:prompt|agent:abort|agent:steer|agent:follow-up|agent:set-model)"/;
    const chatIpcLines = mainLines.filter((l) => chatIpcRegex.test(l));
    record(
      "ipc.chat-handlers.executed",
      chatIpcLines.length > 0,
      `${chatIpcLines.length} lines captured (auto-runs because app starts + auto-inits)`,
    );

    // ---- Phase 4: preload bridge resilience hooks ----
    const preloadPath = join(root, "out", "preload", "index.cjs");
    let preloadSrc = "";
    try { preloadSrc = readFileSync(preloadPath, "utf8"); }
    catch (e) { record("preload.read", false, String(e?.message ?? e)); }

    if (preloadSrc) {
      record(
        "preload.listenSafe-wrapper",
        /listenSafe/.test(preloadSrc),
        "listenSafe top-level API exposed",
      );
      record(
        "preload.getElectronBridgeStatus",
        /getElectronBridgeStatus/.test(preloadSrc),
        "bridge status probe API",
      );
      record(
        "preload.isElectronBridgeUnavailable",
        /isElectronBridgeUnavailable/.test(preloadSrc),
        "bridge unavailable classifier",
      );
      record(
        "preload.bridge-status-event-channel",
        /electron-bridge-status/.test(preloadSrc),
        "preload exposes electron-bridge-status event channel",
      );
    }

    // ---- Phase 5: dump samples for the operator ----
    log("logs.sample", `${Math.min(5, jsonLines.length)} first lines`);
    jsonLines.slice(0, 5).forEach((l) => process.stdout.write("  " + l + "\n"));

    const ipcSamples = chatIpcLines.slice(0, 3);
    if (ipcSamples.length > 0) {
      log("ipc.samples", `${ipcSamples.length} chat IPC lines`);
      ipcSamples.forEach((l) => process.stdout.write("  " + l));
    }
  } finally {
    try { await app.close(); } catch (e) { log("close", String(e?.message ?? e)); }
  }

  if (failures.length) {
    console.error("\nFAILURES:"); failures.forEach((f) => console.error("  -", f));
  }
  console.log(`\nsmoke exit: ${exitCode}`);
  process.exit(exitCode);
}

main().catch((e) => { console.error("smoke crashed:", e); process.exit(2); });
