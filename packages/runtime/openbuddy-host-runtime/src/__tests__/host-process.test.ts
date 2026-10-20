/**
 * @vitest-environment node
 *
 * The host-process integration suite spawns a real Rust sidecar and drives
 * JSON-RPC over stdio. jsdom (the project default for `packages/ui/*`) is
 * inappropriate here because it intercepts `child_process.spawn` and can
 * leave the parent end of the stdio pipe buffered, so the binary never
 * observes the request bytes. Forcing the `node` environment makes the
 * Writable pass through writes immediately and matches the runtime that
 * Electron itself uses when it embeds this package.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { RpcCallError } from "@openbuddy/shared-error-codes";

import { resolveHostBinary } from "../resolve-binary.js";

// Phase 0 tests require a built `openbuddy-host-core` binary. The repo's
// CI / local dev workflow runs `cargo build --release -p openbuddy-host-core`
// before this suite, so the binary should already exist. If not, the suite
// emits a single skipped test rather than failing the build.

function resolveBuiltBinary(): string | null {
  try {
    return resolveHostBinary();
  } catch {
    return null;
  }
}

describe("HostProcess end-to-end", () => {
  const binary = resolveBuiltBinary();
  if (!binary) {
    it.skip("openbuddy-host-core binary not built; skipping host-process integration test", () => {});
    return;
  }

  it("completes app.handshake against a real Rust host-core", async () => {
    const { HostProcess } = await import("../host-process.js");
    const host = new HostProcess({ binaryPath: binary, dataDir: "/tmp/openbuddy-host-runtime-test" });
    try {
      const result = await host.whenReady();
      expect(result.protocolVersion).toBe(1);
      expect(typeof result.hostVersion).toBe("string");
      expect(Array.isArray(result.capabilities)).toBe(true);
      expect(result.capabilities).toContain("app.handshake");
      expect(result.capabilities).toContain("app.listMethods");
    } finally {
      await host.dispose();
    }
  });

  it("app.listMethods returns the registered method names", async () => {
    const { HostProcess } = await import("../host-process.js");
    const host = new HostProcess({ binaryPath: binary, dataDir: "/tmp/openbuddy-host-runtime-test" });
    try {
      const result = await host.call<{ methods: string[] }>("app.listMethods", {});
      expect(result.methods).toContain("app.handshake");
      expect(result.methods).toContain("app.listMethods");
      expect(result.methods).toContain("app.shutdown");
    } finally {
      await host.dispose();
    }
  });

  it("unknown methods return METHOD_NOT_FOUND", async () => {
    const { HostProcess } = await import("../host-process.js");
    const host = new HostProcess({ binaryPath: binary, dataDir: "/tmp/openbuddy-host-runtime-test" });
    try {
      await expect(host.call("app.doesNotExist", {})).rejects.toBeInstanceOf(RpcCallError);
    } finally {
      await host.dispose();
    }
  });

  it("rejects calls after dispose()", async () => {
    const { HostProcess } = await import("../host-process.js");
    const host = new HostProcess({ binaryPath: binary, dataDir: "/tmp/openbuddy-host-runtime-test" });
    await host.dispose();
    await expect(host.call("app.listMethods", {})).rejects.toThrow(/disposed/);
  });

  // 回归测试(2026-09-29):真实崩溃必须以 intentional:false 派发给 onExit
  // 观测者,否则上层(host-health)会把崩溃当主动退出过滤,host-core 崩溃
  // 对用户完全不可见。dispose() 路径仍是 intentional:true。
  it("reports a real crash as intentional:false and dispose as intentional:true", async () => {
    const { HostProcess } = await import("../host-process.js");
    const child = (host: unknown): { kill: (signal: NodeJS.Signals) => boolean } =>
      (host as { child: { kill: (signal: NodeJS.Signals) => boolean } }).child;

    // 1) 真实崩溃
    const crashed = new HostProcess({ binaryPath: binary, dataDir: "/tmp/openbuddy-host-runtime-test" });
    await crashed.whenReady();
    const crashExits: Array<{ signal: NodeJS.Signals | null; intentional: boolean }> = [];
    crashed.onExit((info) => crashExits.push({ signal: info.signal, intentional: info.intentional }));
    const crashedExit = new Promise<void>((resolve) => crashed.onExit(() => resolve()));
    child(crashed).kill("SIGKILL");
    await crashedExit;
    expect(crashExits).toHaveLength(1);
    expect(crashExits[0].signal).toBe("SIGKILL");
    expect(crashExits[0].intentional).toBe(false);

    // 2) 主动 dispose 仍然报 intentional:true
    const disposed = new HostProcess({ binaryPath: binary, dataDir: "/tmp/openbuddy-host-runtime-test" });
    await disposed.whenReady();
    const disposeExits: boolean[] = [];
    disposed.onExit((info) => disposeExits.push(info.intentional));
    await disposed.dispose();
    expect(disposeExits).toEqual([true]);
  });

  // touch the spawn import so unused warnings don't fire on stripped targets
  it.skip("smoke: child_process.spawn import is reachable", () => {
    expect(typeof spawn).toBe("function");
    expect(typeof join).toBe("function");
  });
});
