/**
 * profile-reload-transaction.test.ts — 单元测试 profile-reload 事务核心.
 *
 * 测试策略:
 *   1. 用 stub deps install, 验证 scheduleProfileReload 入队 + 执行流程
 *   2. 验证 rollbackPiProfile 抓快照 → 替换 loader profile → 同步 cordis → reconcile
 *   3. 验证失败路径: scheduleProfileReload 异常 → rollback → markPluginTransactionRolledBack
 *   4. 验证 debounce: 多次连续 scheduleProfileReload 只触发一次 reload
 *   5. 验证 renderer ack 超时
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  installProfileReloadTransaction,
  scheduleProfileReload,
  rollbackPiProfile,
  RELOAD_DEBOUNCE_MS,
  RENDERER_RECEIPT_TIMEOUT_MS,
  __resetProfileReloadTransactionForTest,
} from "./profile-reload-transaction";
import { createDefaultAgentHostState } from "./_default-state";
import type { AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Stub helpers — 每个 stub 记录调用, 便于断言调用顺序与参数
// ---------------------------------------------------------------------------

function makeStubDeps() {
  const calls: Array<{ name: string; args?: unknown }> = [];
  const events: Array<{ type: string; payload: unknown }> = [];

  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
  };

  const enqueueImpl = async <T>(
    _kind: string,
    _target: string,
    operation: (transaction: any) => Promise<T>,
  ): Promise<T> => {
    const transaction = makeTransaction();
    return operation(transaction);
  };

  const makeTransaction = () => {
    const tx = {
      phase: record("phase"),
      receipt: record("receipt"),
      requireReceipt: record("requireReceipt"),
      awaitSurfaceReceipt: vi.fn(async () => undefined),
    };
    return tx;
  };

  // snapshot
  const previousSnapshot = {
    activePluginProfile: {
      entries: [{ id: "prev", name: "prev-name" }],
      patches: [["prev-patch"]],
    },
    piExtensionStatuses: [{ id: "ext", state: "loaded" }],
  } as any;

  const capturedServices = new Map<string, unknown>([["workspaceRegistry", { id: "ws" }]]);
  const capturedCapabilities = new Map<string, unknown>([["typert", { id: "t" }]]);

  const stub = {
    // state
    state: createDefaultAgentHostState() as AgentHostState,
    // queue
    pluginLifecycleQueue: { enqueue: vi.fn(enqueueImpl) },
    piRuntimeCoordinator: { reload: vi.fn(async () => undefined) },
    emitPluginEvent: (type: string, payload: unknown) => {
      events.push({ type, payload });
    },

    // snapshot helpers
    capturePiProfileSnapshot: vi.fn(() => previousSnapshot),
    restorePiProfileSnapshot: vi.fn(),

    // context services
    captureReloadableContextServices: vi.fn(() => capturedServices),
    restoreCapturedContextServices: vi.fn(),

    // deepseek capability services
    captureDeepSeekCapabilityServices: vi.fn(() => capturedCapabilities),
    restoreDeepSeekCapabilityServices: vi.fn(async () => undefined),

    // profile materialization
    materializeOpenBuddyProfile: vi.fn(async (opts: any) => ({
      profile: {
        name: "test-profile",
        packageJson: "{}",
        packagePaths: ["/test/pkg-a", "/test/pkg-b"],
        piExtensions: [{ id: "ext-a" }],
        piPackagePaths: ["/test/pi-pkg-a"],
        piResourcePaths: {
          extensions: ["/ext"],
          skills: ["/skill"],
          prompts: ["/prompt"],
          themes: ["/theme"],
        },
      },
      bundle: { entries: [{ id: "bundle-entry", name: "bundle" }] },
    })),
    runtimeProfileBundle: vi.fn(async (bundle: any) => ({
      entries: bundle.entries ?? [],
      patches: [["bundle-patch"]],
    })),
    createOpenBuddyProfile: vi.fn(() => ({
      entries: [{ id: "base", name: "base" }],
      patches: [["base-patch"]],
    })),
    composePluginPatches: vi.fn((entries: any[], patches: any[][]) => [
      ...entries,
      { id: "composed", name: "composed" },
    ]),

    // deepseek cordis
    syncDeepSeekCordisRuntime: vi.fn(async () => undefined),
    deepSeekCoreRuntimeEntries: vi.fn((entries: any[]) => entries),

    // artifacts
    reconcileProfileArtifacts: vi.fn(async () => undefined),
    refreshHookConfigs: vi.fn(async () => undefined),

    // mcp
    reloadMcp: vi.fn(async () => undefined),

    // pi extensions
    reportPiExtensionErrors: vi.fn(),
    readOverridePatches: vi.fn(async () => [["override-patch"]]),
    setProfilePiResourcePaths: vi.fn(),
    startProfileWatchers: vi.fn(async () => undefined),
    configurePiExtensions: vi.fn(),

    // observability
    calls,
    events,
    previousSnapshot,
    capturedServices,
    capturedCapabilities,
  };

  // 默认 state 上有 loader (scheduleProfileReload 必须先看到 loader 才入队)
  stub.state.loader = {
    replaceProfile: vi.fn(async () => undefined),
  } as any;
  // profileOptions 必须非空, materializeOpenBuddyProfile 才会被调用
  stub.state.profileOptions = { profileDir: "/test/profile", name: "test" } as any;

  // emitPluginEvent 改为 spy 以便 spy 断言
  const emitSpy = vi.fn((type: string, payload: unknown) => {
    events.push({ type, payload });
  });
  stub.emitPluginEvent = emitSpy as any;

  return stub;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("profile-reload-transaction", () => {
  let stub: ReturnType<typeof makeStubDeps>;

  beforeEach(() => {
    stub = makeStubDeps();
    installProfileReloadTransaction(stub as any);
    vi.useFakeTimers();
  });

  afterEach(() => {
    __resetProfileReloadTransactionForTest();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // scheduleProfileReload
  // -------------------------------------------------------------------------

  describe("scheduleProfileReload", () => {
    it("returns early when state.loader is null", () => {
      stub.state.loader = null;
      scheduleProfileReload();
      expect(stub.pluginLifecycleQueue.enqueue).not.toHaveBeenCalled();
    });

    it("throws when not installed", () => {
      __resetProfileReloadTransactionForTest();
      expect(() => scheduleProfileReload()).toThrow(/not installed/);
      // 重装以便 afterEach 清理
      installProfileReloadTransaction(stub as any);
    });

    it("enqueues profile-reload transaction after debounce", async () => {
      scheduleProfileReload();
      expect(stub.pluginLifecycleQueue.enqueue).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.pluginLifecycleQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(stub.pluginLifecycleQueue.enqueue).toHaveBeenCalledWith(
        "profile-reload",
        "profile",
        expect.any(Function),
      );
    });

    it("debounces repeated calls into a single transaction", async () => {
      scheduleProfileReload();
      scheduleProfileReload();
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.pluginLifecycleQueue.enqueue).toHaveBeenCalledTimes(1);
    });

    it("captures snapshot + context services before mutation", async () => {
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.capturePiProfileSnapshot).toHaveBeenCalledTimes(1);
      expect(stub.captureReloadableContextServices).toHaveBeenCalledTimes(1);
    });

    it("updates state.profilePackageJson + profilePackagePaths after materialize", async () => {
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.state.profilePackageJson).toBe("{}");
      expect(stub.state.profilePackagePaths).toEqual([
        "/test/pkg-a",
        "/test/pkg-b",
      ]);
    });

    it("updates state.profilePiExtensions + setProfilePiResourcePaths + configurePiExtensions", async () => {
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.state.profilePiExtensions).toEqual([{ id: "ext-a" }]);
      expect(stub.state.profilePiPackagePaths).toEqual(["/test/pi-pkg-a"]);
      expect(stub.setProfilePiResourcePaths).toHaveBeenCalledWith({
        extensions: ["/ext"],
        skills: ["/skill"],
        prompts: ["/prompt"],
        themes: ["/theme"],
      });
      expect(stub.configurePiExtensions).toHaveBeenCalledWith([{ id: "ext-a" }]);
    });

    it("calls readOverridePatches and rejects when undefined", async () => {
      stub.readOverridePatches.mockResolvedValueOnce(undefined as any);
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.emitPluginEvent).toHaveBeenCalledWith(
        "profile/reload-failed",
        expect.objectContaining({ rolledBack: true }),
      );
    });

    it("replaces loader profile with composed entries + patches", async () => {
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.state.loader?.replaceProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: expect.any(Array),
          patches: expect.any(Array),
        }),
      );
    });

    it("syncs deepseek cordis runtime after profile replace", async () => {
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.syncDeepSeekCordisRuntime).toHaveBeenCalled();
    });

    it("emits profile/reloaded event on success", async () => {
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.emitPluginEvent).toHaveBeenCalledWith(
        "profile/reloaded",
        expect.objectContaining({ name: "test-profile" }),
      );
    });

    it("awaits renderer ack with the documented 5000ms timeout", async () => {
      const txRef: { current: any } = { current: null };
      stub.pluginLifecycleQueue.enqueue = vi.fn(async (_k: string, _t: string, op: any) => {
        const tx = {
          phase: vi.fn(),
          receipt: vi.fn(),
          requireReceipt: vi.fn(),
          awaitSurfaceReceipt: vi.fn(async () => undefined),
        };
        txRef.current = tx;
        return op(tx);
      });
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(txRef.current.awaitSurfaceReceipt).toHaveBeenCalledWith(
        "renderer",
        RENDERER_RECEIPT_TIMEOUT_MS,
      );
    });

    it("runs pi/mcp reload + restore services when session + piResourceLoader present", async () => {
      stub.state.session = { id: "test" } as any;
      stub.state.piResourceLoader = { id: "pi" } as any;
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.piRuntimeCoordinator.reload).toHaveBeenCalledWith("profile-reload");
      expect(stub.reloadMcp).toHaveBeenCalled();
      expect(stub.restoreDeepSeekCapabilityServices).toHaveBeenCalledWith(
        stub.capturedCapabilities,
      );
      expect(stub.restoreCapturedContextServices).toHaveBeenCalledWith(
        stub.capturedServices,
      );
      expect(stub.reportPiExtensionErrors).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // rollbackPiProfile
  // -------------------------------------------------------------------------

  describe("rollbackPiProfile", () => {
    it("throws when not installed", async () => {
      __resetProfileReloadTransactionForTest();
      await expect(rollbackPiProfile(stub.previousSnapshot)).rejects.toThrow(/not installed/);
      installProfileReloadTransaction(stub as any);
    });

    it("restores snapshot then starts profile watchers", async () => {
      await rollbackPiProfile(stub.previousSnapshot, stub.capturedServices);
      expect(stub.restorePiProfileSnapshot).toHaveBeenCalledWith(stub.previousSnapshot);
      expect(stub.startProfileWatchers).toHaveBeenCalled();
    });

    it("replaces loader with snapshot.activePluginProfile", async () => {
      await rollbackPiProfile(stub.previousSnapshot);
      expect(stub.state.loader?.replaceProfile).toHaveBeenCalledWith(
        stub.previousSnapshot.activePluginProfile,
      );
    });

    it("syncs deepseek cordis from rolled-back profile", async () => {
      await rollbackPiProfile(stub.previousSnapshot);
      expect(stub.composePluginPatches).toHaveBeenCalledWith(
        [{ id: "prev", name: "prev-name" }],
        [["prev-patch"]],
      );
      expect(stub.syncDeepSeekCordisRuntime).toHaveBeenCalled();
    });

    it("reconciles profile artifacts + reloads pi runtime as 'profile-rollback'", async () => {
      await rollbackPiProfile(stub.previousSnapshot);
      expect(stub.reconcileProfileArtifacts).toHaveBeenCalled();
      expect(stub.piRuntimeCoordinator.reload).toHaveBeenCalledWith("profile-rollback");
    });

    it("reloads mcp + restores deepseek capability services + context services", async () => {
      await rollbackPiProfile(stub.previousSnapshot, stub.capturedServices);
      expect(stub.reloadMcp).toHaveBeenCalled();
      expect(stub.restoreDeepSeekCapabilityServices).toHaveBeenCalledWith();
      expect(stub.restoreCapturedContextServices).toHaveBeenCalledWith(
        stub.capturedServices,
      );
    });

    it("reports pi extension errors at the end", async () => {
      await rollbackPiProfile(stub.previousSnapshot);
      expect(stub.reportPiExtensionErrors).toHaveBeenCalled();
    });

    it("defaults capturedServices to empty Map when omitted", async () => {
      await rollbackPiProfile(stub.previousSnapshot);
      expect(stub.restoreCapturedContextServices).toHaveBeenCalledWith(
        expect.any(Map),
      );
      const passed = (stub.restoreCapturedContextServices.mock.calls[0] ?? [])[0] as Map<
        string,
        unknown
      >;
      expect(passed.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // failure path of scheduleProfileReload
  // -------------------------------------------------------------------------

  describe("scheduleProfileReload failure path", () => {
    it("rolls back and emits profile/reload-failed with rolledBack=true on recoverable error", async () => {
      stub.syncDeepSeekCordisRuntime.mockRejectedValueOnce(
        new Error("cordis sync failed"),
      );
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      expect(stub.restorePiProfileSnapshot).toHaveBeenCalledWith(
        stub.previousSnapshot,
      );
      const failureEvent = stub.events.find(
        (e) => e.type === "profile/reload-failed",
      );
      expect(failureEvent).toBeDefined();
      expect((failureEvent?.payload as any).rolledBack).toBe(true);
    });

    it("emits rolledBack=false when rollback itself throws", async () => {
      stub.syncDeepSeekCordisRuntime.mockRejectedValueOnce(
        new Error("cordis sync failed"),
      );
      stub.restorePiProfileSnapshot.mockImplementationOnce(() => {
        throw new Error("restore also failed");
      });
      scheduleProfileReload();
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
      const failureEvent = stub.events.find(
        (e) => e.type === "profile/reload-failed",
      );
      expect(failureEvent).toBeDefined();
      expect((failureEvent?.payload as any).rolledBack).toBe(false);
      expect((failureEvent?.payload as any).rollbackError).toContain(
        "restore also failed",
      );
    });
  });
});
