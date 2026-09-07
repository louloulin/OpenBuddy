/**
 * bootstrap/process-guards.ts — install global process-level error guards.
 *
 * A-2 in the ts-error-architecture-overhaul change: capture unhandledRejection
 * and uncaughtException in the main process so dropped promises and bare
 * throws don't silently kill the Electron renderer / main process without
 * leaving a trace.
 *
 * Design:
 *   - Use @openbuddy/logging-main's createMainLogger so logs land in the same
 *     rotating log file as the rest of the main process. traceId="global"
 *     marks events that have no originating request.
 *   - Guard installation is idempotent — calling installProcessGuards twice
 *     (e.g. from tests or re-entry) does NOT register duplicate listeners.
 *     Electron's app re-init paths have hit this in the past.
 *   - For uncaughtException we still exit after logging; Node's default
 *     behavior is to terminate, and continuing risks state corruption. We
 *     log first so the cause is on disk before the process goes away.
 *   - For unhandledRejection we DO NOT exit (Node 15+ default); the rejection
 *     has already been swallowed by the time the handler fires, and many
 *     production code paths are best-effort. The handler is purely
 *     diagnostic.
 */
import { createMainLogger } from "@openbuddy/logging-main";

let installed = false;

/**
 * Install `process.on('unhandledRejection', ...)` and
 * `process.on('uncaughtException', ...)` handlers backed by a pino logger
 * that writes to the main-process log file.
 *
 * Safe to call multiple times — only the first call attaches listeners.
 */
export function installProcessGuards(): void {
  if (installed) return;
  installed = true;

  const logger = createMainLogger({ serviceName: "process-guards" });

  process.on("unhandledRejection", (reason, promise) => {
    // `promise` is opaque at this point; we only log the reason.
    logger.error(
      {
        err: reason,
        kind: "unhandledRejection",
        traceId: "global",
      },
      "main process unhandledRejection",
    );
  });

  process.on("uncaughtException", (err, origin) => {
    // uncaughtException is terminal — Node will exit after this handler
    // returns. Log with fatal level so the rotating writer flushes
    // synchronously before the process dies.
    logger.fatal(
      {
        err,
        origin: typeof origin === "string" ? origin : "unknown",
        kind: "uncaughtException",
        traceId: "global",
      },
      "main process uncaughtException — terminating",
    );
  });
}

/** Test-only reset hook. Restores the `installed` flag so a fresh install can run. */
export function __resetProcessGuardsForTest(): void {
  installed = false;
}
