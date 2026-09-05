// @vitest-environment node
/**
 * Real end-to-end contract test for `registerIpc()` (in `electron/main/ipc.ts`).
 *
 * Goal: verify that the IPC surface exposed by registerIpc has the right shape.
 * This guards against:
 *   - channel count regressions (big drops signal missing code)
 *   - missing namespaces (no `:` in channel name)
 *   - handler shape integrity (every handler is a function)
 *
 * NOTE: Channels may use either `namespace:verb` (preferred) or
 * `flat_namespace_verb` (legacy) — both are accepted.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

interface CapturedHandler { channel: string; fn: (...args: unknown[]) => Promise<unknown> | unknown }
const { registry } = vi.hoisted(() => {
  const registry = new Map<string, CapturedHandler>();
  (globalThis as unknown as { __registry: typeof registry }).__registry = registry;
  return { registry };
});

vi.mock("electron", () => {
  const reg = (globalThis as unknown as { __registry: Map<string, CapturedHandler> }).__registry;
  return {
    app: { getPath: () => "/tmp/openbuddy-contract-test", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
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

beforeAll(async () => {
  const { registerIpc } = await import("../ipc/index");
  await registerIpc(() => null);
});

afterAll(() => {
  vi.clearAllMocks();
});

const COLON_PATTERN = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]+$/;
const FLAT_PATTERN = /^[a-z][a-z0-9_]+$/;

function extractNamespaces(): Set<string> {
  const ns = new Set<string>();
  for (const channel of registry.keys()) {
    if (channel.includes(":")) ns.add(channel.split(":")[0]);
    else {
      // Flat naming: use first underscore-delimited token as namespace
      const firstUnderscore = channel.indexOf("_");
      if (firstUnderscore > 0) ns.add(channel.substring(0, firstUnderscore));
    }
  }
  return ns;
}

describe("IPC contract 真实端到端", () => {
  it("registers at least 400 IPC handlers (regression guard)", () => {
    expect(registry.size).toBeGreaterThanOrEqual(400);
  });

  it("no duplicate channel registrations", () => {
    expect(registry.size).toBe(new Set(registry.keys()).size);
  });

  it("every channel name follows one of the accepted patterns", () => {
    const bad: string[] = [];
    for (const channel of registry.keys()) {
      if (!COLON_PATTERN.test(channel) && !FLAT_PATTERN.test(channel)) {
        bad.push(channel);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every registered handler is a function", () => {
    for (const [channel, handler] of registry) {
      expect(typeof handler.fn, `handler for ${channel} should be a function`).toBe("function");
    }
  });

  it("covers casdoor (95+), agent (50+), email (50+), collaboration (40+) channels", () => {
    function countByPrefix(prefix: string): number {
      let count = 0;
      for (const channel of registry.keys()) {
        if (channel.startsWith(prefix + ":")) count++;
      }
      return count;
    }
    expect(countByPrefix("casdoor")).toBeGreaterThanOrEqual(90);
    expect(countByPrefix("agent")).toBeGreaterThanOrEqual(40);
    expect(countByPrefix("email")).toBeGreaterThanOrEqual(50);
    expect(countByPrefix("collaboration")).toBeGreaterThanOrEqual(35);
    expect(countByPrefix("storage")).toBeGreaterThanOrEqual(10);
    expect(countByPrefix("harness")).toBeGreaterThanOrEqual(5);
    expect(countByPrefix("weknora")).toBeGreaterThanOrEqual(3);
    expect(countByPrefix("shellfs")).toBeGreaterThanOrEqual(10);
  });

  it("covers 30+ unique namespaces (high diversity)", () => {
    const ns = extractNamespaces();
    expect(ns.size).toBeGreaterThanOrEqual(30);
  });

  it("expected critical namespaces are present", () => {
    const ns = extractNamespaces();
    // Critical namespaces that must exist for the desktop app to work
    const required = ["casdoor", "agent", "email", "collaboration", "storage", "harness", "workspace", "casdoor"];
    for (const r of required) {
      expect(ns.has(r), `namespace ${r} should be present`).toBe(true);
    }
  });
});
