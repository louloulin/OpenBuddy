/**
 * agent-preset-runtime.test.ts — 单元测试 agent-preset 域.
 *
 * 测试策略:
 *   1. install/uninstall 周期
 *   2. mountConfiguredAgentPreset happy path: 找到 preset, mount, emit event
 *   3. mountConfiguredAgentPreset fallbacks: 未配置 / stale id / broken
 *   4. selectAgentPreset happy path
 *   5. selectAgentPreset errors: 同 preset / has conversation / not found / broken
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  installAgentPresetRuntime,
  mountConfiguredAgentPreset,
  selectAgentPreset,
  __resetAgentPresetRuntimeForTest,
} from "./agent-preset-runtime";
import { createDefaultAgentHostState } from "./_default-state";
import type { AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function makeStubDeps() {
  const events: Array<{ type: string; payload: unknown }> = [];
  const writes: Array<string | undefined> = [];
  const mounts: Array<{ id: string; source: string; path: string }> = [];

  const state = createDefaultAgentHostState() as AgentHostState;
  state.toolRegistry = { list: () => [] } as any;
  state.cwd = "/test/cwd";

  const makePresetRuntime = (id: string) => ({
    id,
    mount: vi.fn(async (opts: any) => {
      mounts.push(opts);
    }),
    dispose: vi.fn(async () => undefined),
  });

  const candidate = makePresetRuntime("candidate");

  const stub = {
    state,
    emitPluginEvent: vi.fn((type: string, payload: unknown) => {
      events.push({ type, payload });
    }),
    listAgentPresets: vi.fn(async (_cwd: string) => [
      { id: "preset-a", path: "/presets/preset-a.json" },
      { id: "preset-b", path: "/presets/preset-b.json", broken: "syntax error" },
    ]),
    readAgentPresetDefaults: vi.fn(async () => ({ default: "preset-a" })),
    writeAgentPresetDefault: vi.fn(async (id?: string) => {
      writes.push(id);
    }),
    readAgentPreset: vi.fn(async (id: string, _cwd: string) => `source-of-${id}`),
    createPresetSessionRuntime: vi.fn((opts: any) => {
      // Always return a fresh runtime (different from candidate) for createPresetSessionRuntime
      return makePresetRuntime("preset-a");
    }),
    pluginLifecycleQueue: {
      enqueue: vi.fn(async <T>(_kind: string, _target: string, op: any) => {
        const tx = { phase: vi.fn(), receipt: vi.fn(), requireReceipt: vi.fn() };
        return op(tx);
      }),
    },
    sessionHasConversation: vi.fn(() => false),
    piRuntimeCoordinatorReload: vi.fn(async () => undefined),

    events,
    writes,
    mounts,
    candidate,
  };

  return stub;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agent-preset-runtime", () => {
  let stub: ReturnType<typeof makeStubDeps>;

  beforeEach(() => {
    stub = makeStubDeps();
    installAgentPresetRuntime(stub as any);
  });

  afterEach(() => {
    __resetAgentPresetRuntimeForTest();
  });

  // -------------------------------------------------------------------------
  // install pattern
  // -------------------------------------------------------------------------

  describe("install pattern", () => {
    it("replaces module-level state on install", async () => {
      await mountConfiguredAgentPreset("/test/cwd", {} as any, {} as any);
    });

    it("throws when not installed", async () => {
      __resetAgentPresetRuntimeForTest();
      await expect(
        mountConfiguredAgentPreset("/test/cwd", {} as any, {} as any),
      ).rejects.toThrow(/not installed/);
      installAgentPresetRuntime(stub as any);
    });
  });

  // -------------------------------------------------------------------------
  // mountConfiguredAgentPreset
  // -------------------------------------------------------------------------

  describe("mountConfiguredAgentPreset", () => {
    it("returns null when no default preset configured", async () => {
      stub.readAgentPresetDefaults.mockResolvedValueOnce(undefined as any);
      const result = await mountConfiguredAgentPreset("/test/cwd", {} as any, {} as any);
      expect(result).toBeNull();
    });

    it("mounts default preset when configured and found", async () => {
      const result = await mountConfiguredAgentPreset("/test/cwd", {} as any, {} as any);
      expect(result).toBe("preset-a");
      expect(stub.mounts.length).toBe(1);
      expect(stub.mounts[0]).toMatchObject({
        id: "preset-a",
        source: "source-of-preset-a",
        path: "/presets/preset-a.json",
      });
      expect(stub.state.presetSessionRuntime).toBeDefined();
    });

    it("emits agent-preset/selected event after mount", async () => {
      await mountConfiguredAgentPreset("/test/cwd", {} as any, {} as any);
      const evt = stub.events.find((e) => e.type === "agent-preset/selected");
      expect(evt).toBeDefined();
      expect(evt?.payload).toMatchObject({
        id: "preset-a",
        path: "/presets/preset-a.json",
      });
    });

    it("clears stale default and returns null when preset id is not found", async () => {
      stub.readAgentPresetDefaults.mockResolvedValueOnce({ default: "stale-preset" });
      const result = await mountConfiguredAgentPreset("/test/cwd", {} as any, {} as any);
      expect(result).toBeNull();
      expect(stub.writeAgentPresetDefault).toHaveBeenCalledWith(undefined);
    });

    it("clears stale default and returns null when preset is broken", async () => {
      stub.readAgentPresetDefaults.mockResolvedValueOnce({ default: "preset-b" });
      const result = await mountConfiguredAgentPreset("/test/cwd", {} as any, {} as any);
      expect(result).toBeNull();
      expect(stub.writeAgentPresetDefault).toHaveBeenCalledWith(undefined);
    });

    it("uses explicit selectedId instead of reading defaults", async () => {
      stub.readAgentPresetDefaults.mockClear();
      const result = await mountConfiguredAgentPreset("/test/cwd", {} as any, {} as any, "preset-a");
      expect(result).toBe("preset-a");
      expect(stub.readAgentPresetDefaults).not.toHaveBeenCalled();
    });

    it("disposes runtime on mount error", async () => {
      const failingRuntime = {
        id: "preset-a",
        mount: vi.fn(async () => {
          throw new Error("mount failed");
        }),
        dispose: vi.fn(async () => undefined),
      };
      stub.createPresetSessionRuntime.mockReturnValueOnce(failingRuntime);
      await expect(
        mountConfiguredAgentPreset("/test/cwd", {} as any, {} as any),
      ).rejects.toThrow(/mount failed/);
      expect(failingRuntime.dispose).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // selectAgentPreset
  // -------------------------------------------------------------------------

  describe("selectAgentPreset", () => {
    it("throws when id is empty", async () => {
      await expect(selectAgentPreset("")).rejects.toThrow(/non-empty/);
      await expect(selectAgentPreset("   ")).rejects.toThrow(/non-empty/);
    });

    it("throws when Pi session is not initialized", async () => {
      stub.state.session = null;
      await expect(selectAgentPreset("preset-a")).rejects.toThrow(/not initialized/);
    });

    it("fast-paths when same preset is already mounted", async () => {
      const existing = { id: "preset-a" } as any;
      stub.state.presetSessionRuntime = existing;
      stub.state.session = { sessionManager: { getEntries: () => [] } } as any;
      stub.state.context = {} as any;
      stub.state.loader = {} as any;

      const result = await selectAgentPreset("preset-a");
      expect(result).toMatchObject({ id: "preset-a", path: "/presets/preset-a.json" });
      expect(stub.piRuntimeCoordinatorReload).not.toHaveBeenCalled();
    });

    it("rejects when session already has conversation", async () => {
      stub.state.session = { sessionManager: { getEntries: () => [] } } as any;
      stub.state.context = {} as any;
      stub.state.loader = {} as any;
      stub.sessionHasConversation.mockReturnValueOnce(true);

      await expect(selectAgentPreset("preset-a")).rejects.toThrow(/first conversation turn/);
    });

    it("rejects when preset is not found", async () => {
      stub.state.session = { sessionManager: { getEntries: () => [] } } as any;
      stub.state.context = {} as any;
      stub.state.loader = {} as any;
      await expect(selectAgentPreset("nonexistent")).rejects.toThrow(/was not found/);
    });

    it("rejects when preset is broken", async () => {
      stub.state.session = { sessionManager: { getEntries: () => [] } } as any;
      stub.state.context = {} as any;
      stub.state.loader = {} as any;
      await expect(selectAgentPreset("preset-b")).rejects.toThrow(/is broken/);
    });

    it("mounts new preset and reloads pi runtime", async () => {
      stub.state.session = {
        sessionManager: {
          getEntries: () => [],
          appendCustomEntry: vi.fn(),
        },
        waitForIdle: vi.fn(async () => undefined),
      } as any;
      stub.state.context = {} as any;
      stub.state.loader = {} as any;
      stub.state.presetSessionRuntime = { id: "old-preset", dispose: vi.fn() } as any;

      const result = await selectAgentPreset("preset-a");
      expect(result).toMatchObject({ id: "preset-a", path: "/presets/preset-a.json" });
      expect(stub.piRuntimeCoordinatorReload).toHaveBeenCalledWith("agent-preset-switch");
    });
  });
});
