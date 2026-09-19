// @vitest-environment node
/**
 * Real end-to-end test for the `plugin:hash-content` IPC handler registered
 * via `electron/main/plugin-hash.ts`. Verifies the dispatcher layer:
 *   - Allowlist membership in the preload bridge.
 *   - Parameter shape validation (missing/typed content).
 *   - Delegation to the injected `hashFn` (dependency injection allows the
 *     test to pass a stub without importing
 *     `@openbuddy/plugin-host/plugin-security`).
 *
 * Why this test exists:
 *   Goal mu7rpkze-gc769z / phase4-plugin-redo. The integrity badge in
 *   `OpenBuddyPluginPanel` calls
 *   `window.api.invoke("plugin:hash-content", { content })`; if the main-side
 *   handler is ever silently dropped (e.g. preload allowlist misconfigured,
 *   or the handler mis-shapes the response), the badge silently degrades to
 *   "—" and the contract is broken without any test failure. This file is
 *   the regression guard.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

interface CapturedHandler {
  channel: string;
  fn: (...args: unknown[]) => Promise<unknown> | unknown;
}

const { registry, hashFnStub } = vi.hoisted(() => {
  const registry = new Map<string, CapturedHandler>();
  // Stub hashFn that mirrors what @openbuddy/plugin-host/plugin-security's
  // `hashPluginContent` would produce for the given input (sha256-<hex>).
  // The test deliberately does NOT import from @openbuddy/plugin-host — the
  // whole point of dependency injection is that the handler is testable
  // without dragging in Node-only deps.
  const hashFnStub = vi.fn((content: string | Uint8Array) => {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
  });
  (globalThis as unknown as { __registry: typeof registry }).__registry = registry;
  return { registry, hashFnStub };
});

vi.mock("electron", () => {
  const reg = (globalThis as unknown as { __registry: Map<string, CapturedHandler> }).__registry;
  return {
    app: {
      getPath: (key: string) => (key === "userData" ? "/tmp/openbuddy-plugin-hash-test" : "/tmp"),
      on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: CapturedHandler["fn"]) => {
        reg.set(channel, { channel, fn: handler });
      }),
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
let registerPluginHashIpc: typeof import("../plugin-hash").registerPluginHashIpc;
let hashContent: typeof import("../plugin-hash").hashContent;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-plugin-hash-"));
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  // Import AFTER mocks so wrapIpcHandler / ipcMain.handle are captured.
  const mod = await import("../plugin-hash");
  registerPluginHashIpc = mod.registerPluginHashIpc;
  hashContent = mod.hashContent;
  registerPluginHashIpc(hashFnStub as never);
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

describe("plugin-hash IPC dispatcher", () => {
  it("plugin:hash-content is registered as an ipcMain handler", () => {
    expect(registry.has("plugin:hash-content")).toBe(true);
  });

  it("delegates to the injected hashFn and returns the sha256-<hex> shape", async () => {
    hashFnStub.mockClear();
    const result = await callHandler<{ hash: string | null; error?: string }>(
      "plugin:hash-content",
      { content: "hello world" },
    );
    expect(result.hash).toBe(
      "sha256-b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
    expect(result.error).toBeUndefined();
    expect(hashFnStub).toHaveBeenCalledTimes(1);
    expect(hashFnStub).toHaveBeenCalledWith("hello world");
  });

  it("accepts Uint8Array content (binary blob path)", async () => {
    hashFnStub.mockClear();
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0xff]);
    const result = await callHandler<{ hash: string | null; error?: string }>(
      "plugin:hash-content",
      { content: bytes },
    );
    expect(result.hash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(hashFnStub).toHaveBeenCalledWith(bytes);
  });

  it("rejects null content with a structured error (no hashFn invocation)", async () => {
    hashFnStub.mockClear();
    const result = await callHandler<{ hash: string | null; error?: string }>(
      "plugin:hash-content",
      null,
    );
    expect(result.hash).toBeNull();
    expect(result.error).toContain("invalid content");
    expect(hashFnStub).not.toHaveBeenCalled();
  });

  it("rejects missing content field with a structured error", async () => {
    hashFnStub.mockClear();
    const result = await callHandler<{ hash: string | null; error?: string }>(
      "plugin:hash-content",
      { notContent: "oops" },
    );
    expect(result.hash).toBeNull();
    expect(result.error).toContain("invalid content");
    expect(hashFnStub).not.toHaveBeenCalled();
  });

  it("rejects non-string/non-Uint8Array content with a structured error", async () => {
    hashFnStub.mockClear();
    const result = await callHandler<{ hash: string | null; error?: string }>(
      "plugin:hash-content",
      { content: 12345 },
    );
    expect(result.hash).toBeNull();
    expect(result.error).toContain("invalid content");
    expect(hashFnStub).not.toHaveBeenCalled();
  });

  it("surfaces hashFn-thrown errors without crashing the IPC channel", async () => {
    hashFnStub.mockClear();
    hashFnStub.mockImplementationOnce(() => {
      throw new Error("simulated hashFn failure");
    });
    const result = await callHandler<{ hash: string | null; error?: string }>(
      "plugin:hash-content",
      { content: "will throw" },
    );
    expect(result.hash).toBeNull();
    expect(result.error).toContain("simulated hashFn failure");
  });

  it("hashContent (non-IPC) entry point returns the same shape for valid args", () => {
    hashFnStub.mockClear();
    const result = hashContent({ content: "direct-call" }, hashFnStub as never);
    expect(result.hash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(hashFnStub).toHaveBeenCalledWith("direct-call");
  });
});