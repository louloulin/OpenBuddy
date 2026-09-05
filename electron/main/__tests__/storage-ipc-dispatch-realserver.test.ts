// @vitest-environment node
/**
 * Real end-to-end test for the `storage:*` IPC handlers registered in
 * `electron/main/ipc.ts` via `ipcMain.handle`. Exercises the IPC dispatch
 * layer (parameter validation, error wrapping) that wraps the underlying
 * `rendererStorageGateway`, `openStorage/closeStorage`, and bootstrap
 * helpers. Storage is real (SQLite), no fetch or fs mocks.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CapturedHandler { channel: string; fn: (...args: unknown[]) => Promise<unknown> | unknown }

const { registry } = vi.hoisted(() => {
  const registry = new Map<string, CapturedHandler>();
  (globalThis as unknown as { __registry: typeof registry }).__registry = registry;
  return { registry };
});

vi.mock("electron", () => {
  const reg = (globalThis as unknown as { __registry: Map<string, CapturedHandler> }).__registry;
  return {
    app: { getPath: (key: string) => key === "userData" ? "/tmp/openbuddy-storage-ipc-test" : "/tmp", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: CapturedHandler["fn"]) => { reg.set(channel, { channel, fn: handler }); }),
      removeHandler: vi.fn((channel: string) => { reg.delete(channel); }),
      on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn(),
    },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: vi.fn() },
    BrowserWindow: vi.fn(),
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    clipboard: { writeText: vi.fn(), readText: vi.fn() },
  };
});

let tempDir = "";
let registerIpc: typeof import("../ipc/index").registerIpc;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-storage-ipc-"));
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  const ipc = await import("../ipc/index");
  registerIpc = ipc.registerIpc;
  await registerIpc(() => null);
});

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callHandler<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = registry.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return (await handler.fn({}, ...args)) as T;
}

describe("storage IPC dispatch 真实端到端 (SQLite)", () => {
  describe("storage:renderer-write 真实持久化", () => {
    it("writes a key with version=1 and expectedVersion undefined → ok", async () => {
      const result = await callHandler<{ ok: boolean; value: { value: unknown; version: number } }>("storage:renderer-write", { namespace: "test-ns", key: "k1", value: { hello: "world" } });
      expect(result.ok).toBe(true);
      expect(result.value.version).toBe(1);
      expect(result.value.value).toEqual({ hello: "world" });
    });

    it("writes again with next version → version=2 succeeds with expectedVersion=1", async () => {
      await callHandler("storage:renderer-write", { namespace: "test-ns", key: "k1", value: { hello: "world" } });
      const result = await callHandler<{ ok: boolean; value: { version: number } }>("storage:renderer-write", { namespace: "test-ns", key: "k1", value: { hello: "v2" }, version: 2, expectedVersion: 1 });
      expect(result.ok).toBe(true);
      expect(result.value.version).toBe(2);
    });



    it("writes with expectedVersion=1 after first write (version=2) → succeeds", async () => {
      await callHandler("storage:renderer-write", { namespace: "test-ns2", key: "k1", value: "v1" });
      const result = await callHandler<{ ok: boolean; value: { version: number } }>("storage:renderer-write", { namespace: "test-ns2", key: "k1", value: "v2", version: 2, expectedVersion: 1 });
      expect(result.ok).toBe(true);
      expect(result.value.version).toBe(2);
    });

    it("writes with stale expectedVersion → version conflict", async () => {
      await callHandler("storage:renderer-write", { namespace: "test-ns3", key: "k1", value: "v1" });
      // second write makes it version=2
      await callHandler("storage:renderer-write", { namespace: "test-ns3", key: "k1", value: "v2", version: 2 });
      // now writing with expectedVersion=1 should fail
      const result = await callHandler<{ ok: boolean; error?: string; code?: string; currentVersion?: number }>("storage:renderer-write", { namespace: "test-ns3", key: "k1", value: "v3", version: 3, expectedVersion: 1 });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("version-conflict");
      expect(result.currentVersion).toBe(2);
    });

    it("writes with version=0 → ok", async () => {
      const result = await callHandler<{ ok: boolean }>("storage:renderer-write", { namespace: "test-ns4", key: "k1", value: 42, version: 0 });
      expect(result.ok).toBe(true);
    });

    it("writes with non-integer version → throws", async () => {
      await expect(callHandler("storage:renderer-write", { namespace: "test-ns5", key: "k", value: 1, version: "two" })).rejects.toThrow();
    });

    it("writes without namespace → throws", async () => {
      await expect(callHandler("storage:renderer-write", { key: "k", value: 1 })).rejects.toThrow();
    });

    it("writes without key → throws", async () => {
      await expect(callHandler("storage:renderer-write", { namespace: "ns", value: 1 })).rejects.toThrow();
    });

    it("writes with non-object payload → throws", async () => {
      await expect(callHandler("storage:renderer-write", "not-an-object")).rejects.toThrow();
    });
  });

  describe("storage:renderer-read 读取已写数据", () => {
    it("reads a missing key → ok with undefined value", async () => {
      const result = await callHandler<{ ok: boolean; value: unknown }>("storage:renderer-read", { namespace: "missing-ns", key: "absent" });
      expect(result.ok).toBe(true);
      expect(result.value).toBeUndefined();
    });

    it("reads back a value written earlier", async () => {
      await callHandler("storage:renderer-write", { namespace: "read-test", key: "k1", value: { foo: "bar" } });
      const result = await callHandler<{ ok: boolean; value: { value: unknown } }>("storage:renderer-read", { namespace: "read-test", key: "k1" });
      expect(result.ok).toBe(true);
      expect(result.value.value).toEqual({ foo: "bar" });
    });

    it("reads with missing args → throws", async () => {
      await expect(callHandler("storage:renderer-read", null)).rejects.toThrow();
    });
  });

  describe("storage:renderer-list 列举 namespace 内 keys", () => {
    it("lists keys for namespace", async () => {
      await callHandler("storage:renderer-write", { namespace: "list-ns", key: "a", value: 1 });
      await callHandler("storage:renderer-write", { namespace: "list-ns", key: "b", value: 2 });
      const result = await callHandler<{ ok: boolean; values: Array<{ key: string }> }>("storage:renderer-list", { namespace: "list-ns" });
      expect(result.ok).toBe(true);
      expect(result.values.length).toBeGreaterThanOrEqual(2);
      expect(result.values.map(r => r.key).sort()).toEqual(["a", "b"]);
    });

    it("lists empty namespace → empty array", async () => {
      const result = await callHandler<{ ok: boolean; values: unknown[] }>("storage:renderer-list", { namespace: "empty-ns" });
      expect(result.ok).toBe(true);
      expect(result.values).toEqual([]);
    });
  });

  describe("storage:renderer-remove 删除", () => {
    it("removes existing key → ok + read returns undefined", async () => {
      await callHandler("storage:renderer-write", { namespace: "rm-ns", key: "k1", value: 1 });
      const result = await callHandler<{ ok: boolean; removed: boolean }>("storage:renderer-remove", { namespace: "rm-ns", key: "k1" });
      expect(result.ok).toBe(true);
      expect(result.removed).toBe(true);
      const after = await callHandler<{ ok: boolean; value: unknown }>("storage:renderer-read", { namespace: "rm-ns", key: "k1" });
      expect(after.ok).toBe(true);
      expect(after.value).toBeUndefined();
    });

    it("removes missing key → ok (idempotent)", async () => {
      const result = await callHandler<{ ok: boolean }>("storage:renderer-remove", { namespace: "rm-ns", key: "absent" });
      expect(result.ok).toBe(true);
    });
  });

  describe("storage:metrics 真实 SQLite health snapshot", () => {
    it("returns ok + snapshot with health fields", async () => {
      // Trigger a write first so the driver has activity
      await callHandler("storage:renderer-write", { namespace: "metrics-ns", key: "k", value: 1 });
      const result = await callHandler<{ ok: boolean; snapshot?: Record<string, unknown>; error?: string }>("storage:metrics");
      expect(result.ok).toBe(true);
      expect(result.snapshot).toBeTruthy();
      const metrics = result.snapshot?.metrics as Record<string, unknown> | undefined;
      expect(typeof metrics?.writes).toBe("number");
      expect(typeof result.snapshot?.queueDepth).toBe("number");
      expect(typeof result.snapshot?.schemaVersion).toBe("number");
    });
  });

  describe("storage:metrics-history limit 边界", () => {
    it("limit=0 → empty history", async () => {
      const result = await callHandler<{ ok: boolean; history: unknown[] }>("storage:metrics-history", { limit: 0 });
      expect(result.ok).toBe(true);
      expect(result.history).toEqual([]);
    });

    it("limit=64 → bounded to 64", async () => {
      const result = await callHandler<{ ok: boolean; history: unknown[] }>("storage:metrics-history", { limit: 64 });
      expect(result.history.length).toBeLessThanOrEqual(64);
    });

    it("limit=100 → clamped to 64", async () => {
      const result = await callHandler<{ ok: boolean; history: unknown[] }>("storage:metrics-history", { limit: 100 });
      expect(result.history.length).toBeLessThanOrEqual(64);
    });

    it("no limit → defaults to 8", async () => {
      const result = await callHandler<{ ok: boolean; history: unknown[] }>("storage:metrics-history", undefined);
      expect(result.ok).toBe(true);
      expect(result.history.length).toBeLessThanOrEqual(8);
    });
  });

  describe("storage:workspace-bootstrap / task-bootstrap / collaboration-bootstrap (Stage G-1c: automation-bootstrap removed)", () => {
    it("storage:workspace-bootstrap returns snapshot", async () => {
      const result = await callHandler<{ ok: boolean; snapshot?: Record<string, unknown>; error?: string }>("storage:workspace-bootstrap");
      expect(result.ok).toBe(true);
      expect(result.snapshot).toBeTruthy();
    });

    it("storage:task-bootstrap requires sessionId, returns empty for unknown session", async () => {
      const result = await callHandler<{ ok: boolean; snapshot?: { tasks: unknown[] } }>("storage:task-bootstrap", { sessionId: "unknown-session" });
      expect(result.ok).toBe(true);
      expect(result.snapshot?.tasks).toEqual([]);
    });

    it("storage:task-bootstrap without sessionId → throws", async () => {
      await expect(callHandler("storage:task-bootstrap", {})).rejects.toThrow();
    });

    // Stage G-1c: openbuddy-automation backend removed; automation is owned by
    // pi-background-tasks + pi-goal (passthrough). The storage:automation-bootstrap
    // IPC channel is no longer registered, so callHandler throws "no handler
    // registered" — preserved as regression marker per "保留auto" directive.
    it("storage:automation-bootstrap → throws (handler removed in G-1c)", async () => {
      await expect(callHandler("storage:automation-bootstrap", { automationId: "x" })).rejects.toThrow();
    });

    it("storage:collaboration-bootstrap returns snapshot", async () => {
      const result = await callHandler<{ ok: boolean; snapshot?: { contracts: unknown[]; cursors: unknown[]; recentEvents: unknown[] } }>("storage:collaboration-bootstrap");
      expect(result.ok).toBe(true);
      expect(result.snapshot).toBeTruthy();
      expect(Array.isArray(result.snapshot?.contracts)).toBe(true);
      expect(Array.isArray(result.snapshot?.cursors)).toBe(true);
      expect(Array.isArray(result.snapshot?.recentEvents)).toBe(true);
    });
  });
});
