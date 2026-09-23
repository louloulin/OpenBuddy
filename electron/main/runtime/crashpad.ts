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
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
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
export function startCrashpad(opts: CrashpadOptions): { crashpadDir: string } {
  if (started) {
    return { crashpadDir: activeCrashpadDir ?? opts.crashpadDir ?? join(opts.dataDir, "crash-dumps") };
  }
  const crashpadDir = opts.crashpadDir ?? join(opts.dataDir, "crash-dumps");
  if (!existsSync(crashpadDir)) mkdirSync(crashpadDir, { recursive: true });
  // Always local-only — never upload. PI-Desktop reference behaviour.
  const report = opts.crashReport ?? (require("electron")?.crashReport as CrashReportLike | undefined);
  if (report && typeof report.start === "function") {
    report.start({
      uploadToServer: false,
      crashpadDir,
      // `submitURL` is intentionally omitted — local-only.
    });
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
  if (!existsSync(dirname(jsonlPath))) mkdirSync(dirname(jsonlPath), { recursive: true });
  if (!existsSync(crashpadDir)) mkdirSync(crashpadDir, { recursive: true });
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
  if (!existsSync(crashpadDir)) mkdirSync(crashpadDir, { recursive: true });
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
