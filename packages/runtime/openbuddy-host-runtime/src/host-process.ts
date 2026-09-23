/**
 * `HostProcess` — wraps the Rust `openbuddy-host-core` sidecar.
 *
 * Mirrors PI-Desktop's `@pi-desktop/host-runtime` `HostProcess` class:
 *  - `spawn` + `call` / `notify` / `dispose`
 *  - Stdio NDJSON framing over stdout/stderr
 *  - `HOST_OVERLOADED` retry with backoff `[50, 100, 200, 400] ms` × 4
 *  - Generation counter so callers can mark older calls as stale
 *  - Graceful shutdown (3 s SIGTERM, then 1 s SIGKILL)
 *
 * Phase 0 only exposes `call` + `notify` + `dispose`; Phase 1 will add
 * typed wrappers per capability (`secrets.set`, etc.) at the package
 * consumers (storage / permission / etc.).
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_RPC_TIMEOUT_MS,
  HOST_OVERLOAD_RETRY_DELAYS_MS,
  PROTOCOL_VERSION,
  RpcCallError,
  StableErrorCodeNames,
  stripProxyEnv,
} from "@openbuddy/shared-error-codes";

import { resolveHostBinary } from "./resolve-binary.js";
import {
  formatRequest,
  readNdjsonFrames,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js";

const HOST_DISPOSE_GRACE_MS = 3_000;
const HOST_FORCE_KILL_GRACE_MS = 1_000;

export type HostNotificationHandler = (method: string, params: unknown) => void;
export type ProcessExitHandler = (info: {
  code: number | null;
  signal: NodeJS.Signals | null;
  intentional: boolean;
}) => void;
export type StderrHandler = (text: string) => void;

export interface HandshakeResult {
  protocolVersion: number;
  hostVersion: string;
  supports: string[];
  dataDir: string;
  capabilities: string[];
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface HostProcessOptions {
  /** Absolute path of the `openbuddy-host-core` binary to spawn. */
  binaryPath?: string;
  /** Data directory handed to host-core as `PI_OPENBUDDY_DATA_DIR`. */
  dataDir?: string;
  /** Optional environment override (merged on top of the stripped parent env). */
  env?: Record<string, string | undefined>;
  /** Receives raw stderr text as it arrives; the embedding host owns redaction and logging. */
  onStderr?: StderrHandler;
  /** Optional handshake timeout in ms. */
  handshakeTimeoutMs?: number;
}

/**
 * The Rust host-core child over stdio NDJSON JSON-RPC. Spawns the binary,
 * drives the `app.handshake`, and exposes `call` / `notify` / `dispose`.
 */
export class HostProcess {
  readonly binaryPath: string;
  readonly dataDir: string;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string | number, PendingCall>();
  private readonly handlers = new Set<HostNotificationHandler>();
  private readonly exitHandlers = new Set<ProcessExitHandler>();
  private readonly stderrHandlers = new Set<StderrHandler>();
  private disposed = false;
  private available = false;
  private handshake: Promise<HandshakeResult> | null = null;

  constructor(options: HostProcessOptions = {}) {
    this.binaryPath = options.binaryPath ?? resolveHostBinary();
    this.dataDir = options.dataDir ?? process.env.PI_OPENBUDDY_DATA_DIR ?? "";

    const stderrHandler = options.onStderr ?? defaultStderrLogger;
    this.stderrHandlers.add(stderrHandler);

    const env: NodeJS.ProcessEnv = {
      ...stripProxyEnv(process.env),
      ...(options.dataDir ? { PI_OPENBUDDY_DATA_DIR: options.dataDir } : {}),
      ...options.env,
    };

    this.child = spawn(this.binaryPath, [], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.handshake = this.driveHandshake(options.handshakeTimeoutMs);

    void this.drainStdout();
    this.child.stderr?.setEncoding("utf-8");
    this.child.stderr?.on("data", (chunk: string) => {
      for (const h of this.stderrHandlers) h(chunk);
    });
    this.child.on("exit", (code, signal) => this.handleExit(code, signal, true));
  }

  /** `true` once the handshake completed and the host is speaking our protocol. */
  isAvailable(): boolean {
    return this.available;
  }

  /** Resolves once the `app.handshake` returns; rejects on error / timeout. */
  whenReady(): Promise<HandshakeResult> {
    return this.handshake ?? Promise.reject(new Error("host already disposed"));
  }

  /** Register a notification handler (fire-and-forget methods). */
  onNotification(handler: HostNotificationHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onExit(handler: ProcessExitHandler): () => void {
    this.exitHandlers.add(handler);
    return () => this.exitHandlers.delete(handler);
  }

  onStderr(handler: StderrHandler): () => void {
    this.stderrHandlers.add(handler);
    return () => this.stderrHandlers.delete(handler);
  }

  /**
   * Send a JSON-RPC request and await the response. On `HOST_OVERLOADED` the
   * call is retried with the standard backoff schedule (PI-Desktop
   * `HOST_OVERLOAD_RETRY_DELAYS_MS`); other errors propagate.
   */
  async call<T>(method: string, params?: unknown, timeoutMs = DEFAULT_RPC_TIMEOUT_MS): Promise<T> {
    if (this.disposed) throw new Error("host-core already disposed");
    await this.handshake;

    let attempt = 0;
    while (true) {
      try {
        return await this.callOnce<T>(method, params, timeoutMs);
      } catch (err) {
        if (err instanceof RpcCallError && err.isHostOverloaded() && attempt < HOST_OVERLOAD_RETRY_DELAYS_MS.length) {
          await delay(HOST_OVERLOAD_RETRY_DELAYS_MS[attempt]);
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
  }

  /** Send a JSON-RPC notification (no `id`, no response). */
  async notify(method: string, params?: unknown): Promise<void> {
    if (this.disposed) throw new Error("host-core already disposed");
    await this.handshake;
    const line = formatRequest({
      jsonrpc: "2.0",
      id: null as unknown as string,
      method,
      params,
    });
    this.child.stdin.write(line);
  }

  /** Gracefully shut down the host. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // Try a clean shutdown via app.shutdown first.
    if (this.available) {
      try {
        await this.call<void>("app.shutdown", undefined, 1_000);
      } catch {
        // Ignore: the child may already be exiting on stdin EOF.
      }
    }

    if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }
    await waitForExit(this.child, HOST_DISPOSE_GRACE_MS);
    if (!this.child.killed) {
      this.child.kill("SIGKILL");
      await waitForExit(this.child, HOST_FORCE_KILL_GRACE_MS);
    }

    for (const handler of this.exitHandlers) {
      handler({ code: this.child.exitCode, signal: this.child.signalCode, intentional: true });
    }
    this.exitHandlers.clear();
  }

  private async driveHandshake(timeoutMs: number | undefined): Promise<HandshakeResult> {
    try {
      const result = await this.callOnce<HandshakeResult>(
        "app.handshake",
        {
          protocolVersion: PROTOCOL_VERSION,
          hostVersion: "0.0.0",
          dataDir: this.dataDir || undefined,
        },
        timeoutMs ?? 5_000,
      );
      if (result.protocolVersion !== PROTOCOL_VERSION) {
        throw new RpcCallError(
          `host-core protocolVersion mismatch: host=${result.protocolVersion} client=${PROTOCOL_VERSION}`,
          1014,
          "HANDSHAKE_FAILED",
        );
      }
      this.available = true;
      return result;
    } catch (err) {
      // Surface the failure to exit handlers; the supervisor decides recovery.
      this.handleExit(this.child.exitCode, this.child.signalCode, false);
      throw err;
    }
  }

  private callOnce<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const id = randomUUID();
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`host-core call ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      try {
        this.child.stdin.write(formatRequest(request));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private async drainStdout(): Promise<void> {
    if (!this.child.stdout) return;
    try {
      for await (const frame of readNdjsonFrames(this.child.stdout)) {
        let parsed: JsonRpcResponse;
        try {
          parsed = JSON.parse(frame) as JsonRpcResponse;
        } catch (err) {
          // Surface parse failures to stderr handlers but keep draining.
          for (const h of this.stderrHandlers) {
            h(`[host-runtime] failed to parse stdout frame: ${(err as Error).message}\n`);
          }
          continue;
        }
        if ("error" in parsed) {
          const entry = this.pending.get(parsed.id);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(parsed.id);
            const errorCode =
              parsed.error.data?.errorCode ?? StableErrorCodeNames[parsed.error.code] ?? "INTERNAL_ERROR";
            entry.reject(
              new RpcCallError(parsed.error.message, parsed.error.code, errorCode, parsed.error.data),
            );
          }
          continue;
        }
        if ("result" in parsed) {
          const entry = this.pending.get(parsed.id);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(parsed.id);
            entry.resolve(parsed.result);
          }
          continue;
        }
        // Notification without `id`: dispatch to handlers.
        const notification = parsed as unknown as JsonRpcNotification;
        for (const handler of this.handlers) {
          try {
            handler(notification.method, notification.params);
          } catch {
            // Handlers must not throw back into the dispatcher.
          }
        }
      }
    } catch (err) {
      for (const h of this.stderrHandlers) {
        h(`[host-runtime] stdout drain failed: ${(err as Error).message}\n`);
      }
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null, intentional: boolean): void {
    if (this.disposed) return;
    // Reject all pending calls.
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`host-core exited (code=${code} signal=${signal})`));
    }
    this.pending.clear();

    for (const handler of this.exitHandlers) {
      try {
        handler({ code, signal, intentional });
      } catch {
        // ignore
      }
    }
    this.available = false;
    this.disposed = true;
  }
}

function defaultStderrLogger(text: string): void {
  // eslint-disable-next-line no-console
  console.error(`[openbuddy-host-core] ${text.trimEnd()}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onExit = (): void => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    child.once("exit", onExit);
    timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve();
    }, timeoutMs);
  });
}
