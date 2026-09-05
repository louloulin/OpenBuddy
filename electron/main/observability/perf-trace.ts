/**
 * `perfTrace` records startup-phase timestamps to a per-session JSONL file
 * under `app.getPath('userData')`. The marks let us pinpoint where the cold
 * start spends its time without needing to instrument the renderer or pay
 * for synchronous I/O on the hot path.
 *
 * Hot-path safety:
 *  - `perfTraceMark` uses a single in-process buffer that is flushed on each
 *    call (the file write is synchronous but small, and we never block longer
 *    than a single line of JSON).
 *  - All writes are wrapped in try/catch. A write failure (EACCES, ENOSPC,
 *    read-only volume) only logs a warning and never propagates to the main
 *    flow. The instrumentation must not be able to break the app.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

let sessionId: string | null = null;
let filePath: string | null = null;
let lastMarkMs: number | null = null;

function resolveFilePath(): string | null {
  if (filePath !== null) return filePath;
  try {
    if (!app.isReady()) return null;
    const userData = app.getPath("userData");
    const dir = join(userData, "perf-trace");
    mkdirSync(dir, { recursive: true });
    if (sessionId === null) sessionId = `${Date.now().toString(36)}-${process.hrtime.bigint().toString(36).slice(-6)}`;
    filePath = join(dir, `perf-trace-${sessionId}.jsonl`);
  } catch (error) {
    console.warn("[openbuddy-perf-trace] failed to resolve path", error);
    return null;
  }
  return filePath;
}

export interface PerfTraceMark {
  ts: number;
  name: string;
  deltaMs?: number;
  [key: string]: unknown;
}

export function perfTraceMark(name: string, payload?: Record<string, unknown>): void {
  try {
    const path = resolveFilePath();
    if (!path) return;
    const now = Date.now();
    const deltaMs = lastMarkMs === null ? undefined : now - lastMarkMs;
    lastMarkMs = now;
    const entry: PerfTraceMark = { ts: now, name, ...(deltaMs !== undefined ? { deltaMs } : {}), ...(payload ?? {}) };
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
  } catch (error) {
    console.warn("[openbuddy-perf-trace] mark failed", name, error);
  }
}

/** Reset the per-session counter. Used by tests. */
export function perfTraceResetForTests(): void {
  sessionId = null;
  filePath = null;
  lastMarkMs = null;
}

/** Returns the resolved file path (or null if app isn't ready). Used by tests. */
export function perfTraceFilePath(): string | null {
  return resolveFilePath();
}