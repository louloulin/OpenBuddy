/**
 * electron/main/host-process.ts
 *
 * Electron-flavoured wrapper around `@openbuddy/host-runtime`'s
 * `HostProcess`. Owns the path-resolution policy (packaged vs monorepo
 * binary) and the boot-diagnostics fallback that surfaces a friendly
 * error message when the Rust sidecar cannot be launched.
 *
 * Mirrors PI-Desktop's `apps/desktop/electron/main/host-process.ts`
 * (which extends `RuntimeHostProcess` and adds `diagnoseHostFailure`).
 * OpenBuddy keeps the wiring lighter since we already factored the
 * cross-platform path lookup into `resolveHostBinary`; the Electron
 * side only adds:
 *   - `app.isPackaged` aware fallback to `process.resourcesPath`
 *   - stderr routing into the existing logger
 *   - `diagnoseHostFailure` translation of common spawn errors
 */
import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  HostProcess as RuntimeHostProcess,
  type HandshakeResult,
  type ProcessExitHandler,
  type StderrHandler,
  type HostNotificationHandler,
} from "@openbuddy/host-runtime";

const EXE_SUFFIX = process.platform === "win32" ? ".exe" : "";

function packagedBinaryPath(): string | null {
  const resources = process.resourcesPath;
  if (!resources) return null;
  const candidate = join(resources, `bin/openbuddy-host-core${EXE_SUFFIX}`);
  return existsSync(candidate) ? candidate : null;
}

export interface ElectronHostProcessOptions {
  /** Absolute path of the userData dir (defaults to `app.getPath("userData")`). */
  dataDir?: string;
  /** Receives raw stderr lines for the main process logger. */
  onStderr?: StderrHandler;
  /** Receives process-exit events. */
  onExit?: ProcessExitHandler;
  /** Receives host notification messages. */
  onNotification?: HostNotificationHandler;
}

export class ElectronHostProcess {
  readonly inner: RuntimeHostProcess;

  constructor(options: ElectronHostProcessOptions = {}) {
    const dataDir = options.dataDir ?? app.getPath("userData");
    const binaryPath = packagedBinaryPath() ?? undefined;
    const stderrHandler: StderrHandler = options.onStderr ?? defaultStderrLogger;

    this.inner = new RuntimeHostProcess({
      binaryPath,
      dataDir,
      onStderr: stderrHandler,
    });

    if (options.onNotification) {
      this.inner.onNotification(options.onNotification);
    }
    if (options.onExit) {
      this.inner.onExit(options.onExit);
    }
  }

  /** Convenience wrapper around the runtime's handshake. */
  whenReady(): Promise<HandshakeResult> {
    return this.inner.whenReady();
  }

  dispose(): Promise<void> {
    return this.inner.dispose();
  }
}

function defaultStderrLogger(text: string): void {
  // Truncate to one line so a runaway sidecar can't flood the main log.
  const trimmed = text.trimEnd();
  const firstLine = trimmed.split("\n", 1)[0] ?? trimmed;
  // eslint-disable-next-line no-console
  console.error(`[openbuddy-host-core] ${firstLine}`);
}

/**
 * Translate a spawn/handshake error into a user-readable diagnostic. Mirrors
 * PI-Desktop's `diagnoseHostFailure` pattern. Returns the original error
 * untouched when no better explanation is available so the stack trace is
 * still surfaced in the main log.
 */
export function diagnoseHostFailure(err: unknown): { message: string; hint?: string } {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("ENOENT")) {
      return {
        message: `Failed to spawn openbuddy-host-core: binary not found.`,
        hint:
          "Run `cargo build --release -p openbuddy-host-core` from the repo root, " +
          "or set PI_OPENBUDDY_HOST_BIN to an absolute path. " +
          "Packaged builds should ship the binary at resources/bin/.",
      };
    }
    if (msg.includes("handshake")) {
      return {
        message: `Host-core handshake failed: ${msg}`,
        hint:
          "The Rust sidecar is speaking an older protocol version. " +
          "Rebuild `openbuddy-host-core` and reinstall dependencies.",
      };
    }
    return { message: msg };
  }
  return { message: String(err) };
}
