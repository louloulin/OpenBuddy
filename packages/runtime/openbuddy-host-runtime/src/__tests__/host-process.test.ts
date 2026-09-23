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

  // touch the spawn import so unused warnings don't fire on stripped targets
  it.skip("smoke: child_process.spawn import is reachable", () => {
    expect(typeof spawn).toBe("function");
    expect(typeof join).toBe("function");
  });
});
