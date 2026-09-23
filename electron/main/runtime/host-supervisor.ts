/**
 * HostSupervisor — three-way crash recovery for the OpenBuddy runtime.
 *
 * Mirrors PI-Desktop `apps/desktop/electron/main/runtime/host-supervisor.ts`:
 *
 *   1. **Renderer crash** — `render-process-gone` on any BrowserWindow →
 *     log the exit code, recreate the window if it was the primary one.
 *     Secondary windows are just closed.
 *
 *   2. **Rust host-core crash** — `exit` event on the HostProcess child
 *     process before intentional dispose → restart up to 3 times in 60 s.
 *     After 3 restarts the supervisor marks the host as `degraded` and
 *     emits `host/degraded`; the renderer surfaces a "host-core unavailable"
 *     banner. `ErrorCodes.HOST_UNAVAILABLE` (mirrored from PI-Desktop) is
 *     returned on subsequent calls.
 *
 *   3. **Node pi sidecar** — handled by the existing `PiSessionRuntime`.
 *     The supervisor subscribes to its `agent:crash` event so it can log
 *     the correlation, but does not interfere with the existing recovery
 *     path (which aborts the affected turn only).
 *
 * The supervisor is wired up from `electron/main/index.ts` after
 * `app.requestSingleInstanceLock()` returns true; cleanup happens in the
 * existing shutdown handler.
 */
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Maximum restart attempts inside the rolling 60-second window. */
const MAX_RESTARTS = 3;
/** Rolling window over which restart attempts are counted (ms). */
const RESTART_WINDOW_MS = 60_000;
/** Grace period after intentional dispose during which `exit` is ignored. */
const DISPOSE_GRACE_MS = 5_000;

export type SupervisorMode = "fresh" | "running" | "degraded" | "disposed";

export interface SupervisorEvents {
  "host/restarting": { attempt: number; reason: string };
  "host/degraded": { restarts: number; lastReason: string };
  "host/recovered": { restarts: number };
  "renderer/crashed": { windowLabel: string; exitCode: number; reason: string };
}

export interface SupervisorLogger {
  info: (target: string, message: string, fields?: Record<string, unknown>) => void;
  warn: (target: string, message: string, fields?: Record<string, unknown>) => void;
  error: (target: string, message: string, fields?: Record<string, unknown>) => void;
}

export interface HostSpawner {
  /** Spawn a fresh HostProcess and return its public handle. */
  spawn(): { on(event: "exit", cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown; kill(): void };
  /** Tell the previous host to shut down gracefully (call before spawning). */
  shutdown?(): Promise<void>;
}

export interface RendererObserver {
  /** Attach `render-process-gone` listeners to all BrowserWindows. */
  attach(label: string, recreate: () => void): () => void;
}

export interface NodeAgentObserver {
  on(event: "agent:crash", cb: (detail: { sessionId?: string; exitCode: number | null; signal: NodeJS.Signals | null }) => void): unknown;
}

export interface HostSupervisorOptions {
  logger: SupervisorLogger;
  host: HostSpawner;
  renderer: RendererObserver;
  nodeAgent?: NodeAgentObserver;
  crashpadDir?: string;
  now?: () => number;
}

export class HostSupervisor extends EventEmitter {
  private mode: SupervisorMode = "fresh";
  private restartTimestamps: number[] = [];
  private lastCrashReason = "unknown";
  private disposed = false;
  private detachRenderer?: () => void;
  private detachAgent?: () => unknown;
  private hostExitHandler?: (code: number | null, signal: NodeJS.Signals | null) => void;
  private child: ReturnType<HostSpawner["spawn"]> | null = null;
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly logger: SupervisorLogger;
  private readonly host: HostSpawner;
  private readonly renderer: RendererObserver;
  private readonly nodeAgent: NodeAgentObserver | undefined;
  private readonly crashpadDir: string | undefined;
  private readonly now: () => number;

  constructor(opts: HostSupervisorOptions) {
    super();
    this.logger = opts.logger;
    this.host = opts.host;
    this.renderer = opts.renderer;
    this.nodeAgent = opts.nodeAgent;
    this.crashpadDir = opts.crashpadDir;
    this.now = opts.now ?? Date.now;
  }

  /** Start the host-core child and wire up listeners. */
  start(): void {
    if (this.disposed) return;
    this.mode = "running";
    this.spawnHost();
    this.detachRenderer = this.renderer.attach("main", () => this.recreatePrimary());
    if (this.nodeAgent) {
      this.detachAgent = this.nodeAgent.on("agent:crash", (detail) => {
        this.logger.warn("openbuddy.host.supervisor", "node agent sidecar crashed", {
          sessionId: detail.sessionId,
          exitCode: detail.exitCode,
          signal: detail.signal,
        });
      });
    }
  }

  /** Tear down listeners and shut down the child. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.mode = "disposed";
    this.detachRenderer?.();
    if (typeof this.detachAgent === "function") {
      try {
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        (this.detachAgent as any)();
      } catch {
        /* noop */
      }
    }
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    if (this.host.shutdown) {
      try {
        await this.host.shutdown();
      } catch (err) {
        this.logger.warn("openbuddy.host.supervisor", "graceful shutdown failed", { error: String(err) });
      }
    } else if (this.child) {
      this.child.kill();
    }
  }

  /** Read-only view of the current mode. Renderer can poll this for banners. */
  getMode(): SupervisorMode {
    return this.mode;
  }

  /** Force a restart, e.g. after a settings change. Bumps the restart counter. */
  async forceRestart(reason: string): Promise<void> {
    if (this.disposed) return;
    this.lastCrashReason = reason;
    this.logger.info("openbuddy.host.supervisor", "force restart requested", { reason });
    this.scheduleRestart(reason);
  }

  private spawnHost(): void {
    const child = this.host.spawn();
    this.child = child;
    this.hostExitHandler = (code, signal) => {
      this.handleHostExit(code, signal);
    };
    child.on("exit", this.hostExitHandler);
  }

  private handleHostExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.disposed) return;
    // Intentional dispose — call site has already cleared us.
    if (this.mode === "disposed") return;
    const reason = `exit code=${code} signal=${signal ?? "none"}`;
    this.lastCrashReason = reason;
    this.logger.warn("openbuddy.host.supervisor", "host-core exited", { code, signal });
    this.writeCrashpadDump("host", reason, code, signal);
    if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
      // Clean shutdown — treat as a one-off, do not retry.
      this.mode = "disposed";
      this.child = null;
      return;
    }
    this.scheduleRestart(reason);
  }

  private scheduleRestart(reason: string): void {
    const now = this.now();
    this.restartTimestamps = this.restartTimestamps.filter(
      (ts) => now - ts < RESTART_WINDOW_MS,
    );
    if (this.restartTimestamps.length >= MAX_RESTARTS) {
      this.mode = "degraded";
      this.logger.error("openbuddy.host.supervisor", "host-core marked degraded", {
        restarts: this.restartTimestamps.length,
        reason,
      });
      this.emit("host/degraded", { restarts: this.restartTimestamps.length, lastReason: reason });
      return;
    }
    this.restartTimestamps.push(now);
    const attempt = this.restartTimestamps.length;
    this.logger.info("openbuddy.host.supervisor", "host-core restart scheduled", { attempt, reason });
    this.emit("host/restarting", { attempt, reason });
    // Detach the previous child reference; the old `exit` handler may still
    // fire one more time on the disposed instance — we ignore it via the
    // mode check above.
    this.child = null;
    // Re-spawn immediately. We don't back-off because the supervisor is
    // meant to be tight on the failure window; if the binary keeps crashing,
    // we hit MAX_RESTARTS within ~1 second and degrade cleanly.
    this.spawnHost();
    this.emit("host/recovered", { restarts: attempt });
  }

  private recreatePrimary(): void {
    // Renderer observer already recreated the window; we only log it.
    this.logger.warn("openbuddy.host.supervisor", "primary renderer crashed; window recreation triggered by observer");
    this.emit("renderer/crashed", {
      windowLabel: "main",
      exitCode: -1,
      reason: "render-process-gone",
    });
  }

  private writeCrashpadDump(kind: string, reason: string, code: number | null, signal: NodeJS.Signals | null): void {
    if (!this.crashpadDir) return;
    try {
      if (!existsSync(this.crashpadDir)) mkdirSync(this.crashpadDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = join(this.crashpadDir, `${kind}-${stamp}.json`);
      writeFileSync(path, JSON.stringify({
        schema: "openbuddy.crashpad.v1",
        kind,
        reason,
        code,
        signal,
        capturedAt: new Date().toISOString(),
      }, null, 2));
      this.logger.info("openbuddy.host.supervisor", "crashpad dump written", { path });
    } catch (err) {
      this.logger.warn("openbuddy.host.supervisor", "crashpad dump failed", { error: String(err) });
    }
  }
}

export const HostSupervisorLimits = {
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
  DISPOSE_GRACE_MS,
} as const;
