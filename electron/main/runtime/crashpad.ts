/**
 * Crashpad local-only integration for Electron main.
 *
 * Mirrors PI-Desktop `apps/desktop/electron/main/runtime/crashpad.ts`:
 *
 *   - `crashReport.start({ uploadToServer: false, crashpadDir })` — captures
 *     native + JS renderer crashes into `<data_dir>/crash-dumps/` and never
 *     uploads. The renderer process uses the same directory via the
 *     preload's IPC.
 *   - The directory layout follows the convention established by the
 *     host-supervisor (`<kind>-<ISO-timestamp>.json` for structured metadata
 *     + Electron's native minidump files alongside).
 *   - `submitFromRenderer` is the IPC entry point renderer code can call
 *     via the existing crash-reporter preload bridge; payloads are appended
 *     to `renderer-crashes.jsonl` for post-mortem correlation.
 *
 * The module is intentionally import-only (no top-level side effects) so
 * tests can drive it without touching Electron's globals. Tests use a
 * stub for `electron.crashReport.start` to assert the parameters we pass.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";

/** Subset of `Electron.CrashReport` we depend on. Tests can stub this. */
export interface CrashReportLike {
  start(options: { uploadToServer: boolean; crashpadDir: string; submitURL?: string }): void;
  getLastCrashReport(): Electron.CrashReport | null;
  getUploadedReports(): Electron.CrashReport[];
}

let started = false;
let activeCrashpadDir: string | null = null;

export interface CrashpadOptions {
  dataDir: string;
  crashReport?: CrashReportLike;
  /** Override the crashpad directory (defaults to `<dataDir>/crash-dumps`). */
  crashpadDir?: string;
}

/**
 * Initialise Electron's Crashpad subsystem in local-only mode.
 *
 * Must be called once, before `app.whenReady()`. Idempotent: a second call
 * with a different directory is ignored.
 */
/** 启动时裁剪崩溃目录(有界保留;失败静默,不能挡住启动)。 */
function pruneCrashpadDir(crashpadDir: string): void {
  try {
    const jsonlPath = join(crashpadDir, "renderer-crashes.jsonl");
    // No existsSync pre-check: the check-then-read pair is a file-system race
    // (CodeQL js/file-system-race). The read is already inside a try/catch,
    // so a missing file is handled the same way.
    try {
      const lines = readFileSync(jsonlPath, "utf8").split("\n").filter((line) => line.trim().length > 0);
      if (lines.length > 200) {
        writeFileSync(jsonlPath, `${lines.slice(-200).join("\n")}\n`);
      }
    } catch {
      /* no crash log yet */
    }
    const dumps = readdirSync(crashpadDir)
      .filter((name) => /^renderer-.*\.json$/.test(name))
      .map((name) => {
        const full = join(crashpadDir, name);
        try { return { full, mtime: statSync(full).mtimeMs }; } catch { return null; }
      })
      .filter((entry): entry is { full: string; mtime: number } => entry !== null)
      .sort((a, b) => b.mtime - a.mtime);
    for (const stale of dumps.slice(100)) {
      try { rmSync(stale.full, { force: true }); } catch { /* best-effort */ }
    }
  } catch {
    /* 裁剪失败不影响崩溃捕获 */
  }
}

export function startCrashpad(opts: CrashpadOptions): { crashpadDir: string } {
  if (started) {
    return { crashpadDir: activeCrashpadDir ?? opts.crashpadDir ?? join(opts.dataDir, "crash-dumps") };
  }
  const crashpadDir = opts.crashpadDir ?? join(opts.dataDir, "crash-dumps");
  // 数据§6(2026-10-19 生产评审):启动可因只读/满盘 userData 硬崩 —— 这里
  // 在 app.whenReady 之前、模块路径上执行,mkdir 失败不能炸掉整个启动。
  try {
    // `recursive: true` already treats an existing directory as success, so
    // there is no need for an existsSync pre-check (and no TOCTOU window).
    mkdirSync(crashpadDir, { recursive: true });
    // 数据§8:崩溃转储此前无上限。启动时保留最新:jsonl 截到最后 200 行,
    // 单个 dump 文件按 mtime 保留最新 100 个。
    pruneCrashpadDir(crashpadDir);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[crashpad] directory unavailable; crash capture disabled:", error);
    started = true;
    activeCrashpadDir = crashpadDir;
    return { crashpadDir };
  }
  // Always local-only — never upload. PI-Desktop reference behaviour.
  const report = opts.crashReport ?? (require("electron")?.crashReport as CrashReportLike | undefined);
  if (report && typeof report.start === "function") {
    try {
      report.start({
        uploadToServer: false,
        crashpadDir,
        // `submitURL` is intentionally omitted — local-only.
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[crashpad] start failed; continuing without crash capture:", error);
    }
  }
  started = true;
  activeCrashpadDir = crashpadDir;
  return { crashpadDir };
}

/** Returns the crashpad directory used by the previous `startCrashpad` call. */
export function getCrashpadDir(): string | null {
  return activeCrashpadDir;
}

/**
 * Renderer-reported crash path. The preload bridge can forward an ErrorEvent
 * from a renderer window to this; we persist it alongside native dumps so
 * post-mortem tooling has a unified timeline.
 */
export interface RendererCrashEntry {
  schema: "openbuddy.crashpad.renderer.v1";
  windowLabel: string;
  exitCode: number;
  reason: string;
  capturedAt: string;
  rendererVersion?: string;
}

export function recordRendererCrash(
  crashpadDir: string,
  entry: Omit<RendererCrashEntry, "schema" | "capturedAt"> & { capturedAt?: string },
): RendererCrashEntry {
  const full: RendererCrashEntry = {
    schema: "openbuddy.crashpad.renderer.v1",
    capturedAt: entry.capturedAt ?? new Date().toISOString(),
    windowLabel: entry.windowLabel,
    exitCode: entry.exitCode,
    reason: entry.reason,
    rendererVersion: entry.rendererVersion,
  };
  const jsonlPath = join(crashpadDir, "renderer-crashes.jsonl");
  mkdirSync(dirname(jsonlPath), { recursive: true });
  mkdirSync(crashpadDir, { recursive: true });
  appendFileSync(jsonlPath, JSON.stringify(full) + "\n");
  // Also drop a structured dump file so each renderer crash has a discoverable
  // filename pattern (consistent with the host-supervisor's host-*.json files).
  const stamp = full.capturedAt.replace(/[:.]/g, "-");
  writeFileSync(
    join(crashpadDir, `renderer-${full.windowLabel}-${stamp}.json`),
    JSON.stringify(full, null, 2),
  );
  return full;
}

/**
 * Main-process crash recorder.
 *
 * Used by the uncaughtException / unhandledRejection handlers installed in
 * `electron/main/index.ts`. Captures a structured JSON dump in the same
 * crashpad directory that Electron's native minidumps land in, so a
 * post-mortem tool can correlate JS-level main crashes with native ones.
 *
 * The main process is single-instance — if an uncaughtException fires, the
 * process is already dying. We don't try to recover; we just persist the
 * state so the next launch can surface what happened.
 */
export interface MainCrashEntry {
  schema: "openbuddy.crashpad.main.v1";
  kind: "uncaughtException" | "unhandledRejection";
  name?: string;
  message: string;
  stack?: string;
  capturedAt: string;
  electronVersion?: string;
  nodeVersion?: string;
  pid?: number;
}

export function recordMainCrash(
  crashpadDir: string,
  entry: Omit<MainCrashEntry, "schema" | "capturedAt"> & { capturedAt?: string },
): MainCrashEntry {
  const full: MainCrashEntry = {
    schema: "openbuddy.crashpad.main.v1",
    capturedAt: entry.capturedAt ?? new Date().toISOString(),
    kind: entry.kind,
    name: entry.name,
    message: entry.message,
    stack: entry.stack,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    pid: process.pid,
  };
  mkdirSync(crashpadDir, { recursive: true });
  // Mirror the renderer pattern: JSONL stream + per-event dump file so each
  // crash has a discoverable filename for tooling (sorted lexicographically
  // by ISO timestamp).
  const jsonlPath = join(crashpadDir, "main-crashes.jsonl");
  appendFileSync(jsonlPath, JSON.stringify(full) + "\n");
  const stamp = full.capturedAt.replace(/[:.]/g, "-");
  writeFileSync(
    join(crashpadDir, `main-${full.kind}-${stamp}.json`),
    JSON.stringify(full, null, 2),
  );
  return full;
}

/** Convenience used by the test harness. */
export function _resetForTests(): void {
  started = false;
  activeCrashpadDir = null;
}

/**
 * Exit code the main process uses when an uncaughtException is fatal.
 * Distinct from the `0` used by the second-instance bail-out so a crash-loop
 * supervisor can tell "another instance owned the lock" from "we crashed".
 */
export const MAIN_CRASH_EXIT_CODE = 1;

export interface MainCrashHandlerDeps {
  crashpadDir: string;
  /** Injectable so tests can assert the exit without killing the runner. */
  exit?: (code: number) => void;
  log?: (...args: unknown[]) => void;
}

/**
 * Install the main-process `uncaughtException` / `unhandledRejection`
 * handlers that pair with `recordMainCrash`.
 *
 * The asymmetry is deliberate and load-bearing:
 *
 *   - `uncaughtException` **terminates**. Node's default behaviour is to exit
 *     on an uncaught exception, but registering *any* `uncaughtException`
 *     listener suppresses that default — so a handler that merely logs turns a
 *     fatal main-process crash into a silently limping process whose Electron
 *     state (window handles, host-core IPC, SQLite cursors) is now undefined.
 *     We dump synchronously (`recordMainCrash` uses `writeFileSync`, so the
 *     bytes are on disk before we return) and then exit.
 *   - `unhandledRejection` does **not** terminate. The rejection has already
 *     been swallowed by the time the handler fires and many code paths are
 *     best-effort by design; Node 15+ agrees by not exiting either.
 *
 * Returns a disposer that removes both listeners (tests; also lets a future
 * shutdown path hand control back to Node's default handling).
 */
export function installMainCrashHandlers(deps: MainCrashHandlerDeps): () => void {
  const exit = deps.exit ?? ((code: number): void => process.exit(code));
  const log = deps.log ?? ((...args: unknown[]): void => console.error(...args));

  const dump = (kind: MainCrashEntry["kind"], err: unknown): void => {
    try {
      recordMainCrash(deps.crashpadDir, {
        kind,
        name: err instanceof Error ? err.name : undefined,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    } catch (dumpErr) {
      // Never let the recorder itself re-crash the process; stderr is the
      // last resort so the original failure is not buried under a second one.
      log("[openbuddy-crashpad] failed to persist dump:", dumpErr);
    }
    log(`[openbuddy-crashpad] main ${kind}:`, err);
  };

  const onUncaught = (err: unknown): void => {
    dump("uncaughtException", err);
    exit(MAIN_CRASH_EXIT_CODE);
  };
  const onRejection = (reason: unknown): void => {
    dump("unhandledRejection", reason);
  };

  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onRejection);
  return () => {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onRejection);
  };
}
