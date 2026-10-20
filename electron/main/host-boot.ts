/**
 * electron/main/host-boot.ts
 *
 * Boots the Rust host-core sidecar alongside Electron main and waits for
 * the protocol handshake. The host-core outlives the renderer process —
 * if the renderer crashes, the host-core keeps running so that future
 * reloads see the same in-memory state (secrets, permission decisions,
 * audit log) without re-deriving them from disk.
 *
 * Mirrors PI-Desktop's boot order in
 * `apps/desktop/electron/main/runtime/host.ts:358`:
 *   1. Electron main starts.
 *   2. Resolve the data dir.
 *   3. Spawn host-core.
 *   4. Handshake (`app.handshake`).
 *   5. Confirm protocol version matches.
 *   6. Expose the host reference for downstream capability wiring
 *      (Phase 1 will attach secrets / permissions / audit here).
 *
 * Failure modes:
 *   - Binary missing → `diagnoseHostFailure` produces a user-friendly
 *     hint that names the `cargo build` invocation.
 *   - Handshake fails → surface the structured error code from the
 *     shared error-codes mirror.
 *   - Process exits before handshake → log and re-throw so the
 *     supervisor can decide whether to retry.
 */
import { app } from "electron";

import { PROTOCOL_VERSION, RpcCallError } from "@openbuddy/shared-error-codes";
import type { HandshakeResult } from "@openbuddy/host-runtime";

import { ElectronHostProcess, diagnoseHostFailure } from "./host-process";
import { recordHostExit } from "./runtime/host-health";

const STARTUP_SLOW_HINT_MS = 30_000;
const STARTUP_STALLED_MS = 180_000;

export interface HostBootOptions {
  /** Called when boot exceeds STARTUP_SLOW_HINT_MS (one-shot). */
  onSlowHint?: () => void;
  /** Called when boot exceeds STARTUP_STALLED_MS (one-shot). */
  onStalled?: () => void;
}

export interface BootedHost {
  host: ElectronHostProcess;
  handshake: HandshakeResult;
}

export async function bootHostCore(options: HostBootOptions = {}): Promise<BootedHost> {
  const host = new ElectronHostProcess({
    dataDir: app.getPath("userData"),
    // 崩溃对用户可见:记录到 host-health 后经 electron-bridge-status 广播。
    // 主动 dispose（应用退出 / 协议不匹配）会被 intentional 标志排除。
    onExit: (info) => {
      recordHostExit(info);
    },
  });

  const slowHintTimer = setTimeout(() => {
    options.onSlowHint?.();
  }, STARTUP_SLOW_HINT_MS);
  const stalledTimer = setTimeout(() => {
    options.onStalled?.();
  }, STARTUP_STALLED_MS);

  let handshake: HandshakeResult;
  try {
    handshake = await host.whenReady();
  } catch (err) {
    clearTimeout(slowHintTimer);
    clearTimeout(stalledTimer);
    const diagnosis = diagnoseHostFailure(err);
    // P0.7(2026-10-19 生产评审 §6.3):host-core 启动失败是打包后最常见的
    // 首启故障,必须落盘(console.error 在打包态无人可见)。日志文件由
    // log-bootstrap 注入的默认 sink 承接。
    // eslint-disable-next-line no-console
    console.error(
      `[openbuddy-boot] host-core boot failed: ${diagnosis.message}` +
        (diagnosis.hint ? ` (${diagnosis.hint})` : ""),
    );
    try {
      const { createMainLogger } = await import("@openbuddy/logging-main");
      createMainLogger({ serviceName: "openbuddy-boot" }).error(
        { msg: "host-core boot failed", diagnosis: diagnosis.message, hint: diagnosis.hint ?? null },
      );
    } catch { /* 日志不可用时不能掩盖原始错误 */ }
    throw err instanceof Error ? err : new Error(diagnosis.message);
  }
  clearTimeout(slowHintTimer);
  clearTimeout(stalledTimer);

  if (handshake.protocolVersion !== PROTOCOL_VERSION) {
    await host.dispose();
    throw new RpcCallError(
      `host-core protocol mismatch: host=${handshake.protocolVersion} client=${PROTOCOL_VERSION}`,
      1014,
      "HANDSHAKE_FAILED",
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[openbuddy-boot] host-core ready (protocol=${handshake.protocolVersion} host=${handshake.hostVersion} capabilities=${handshake.capabilities.length})`,
  );
  return { host, handshake };
}
