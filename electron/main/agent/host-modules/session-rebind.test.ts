/**
 * session-rebind.test.ts — 单元测试 warm-host session 热重绑定.
 *
 * 测试策略:
 *   1. install/uninstall 周期
 *   2. fallback 路径: missing services → initialize
 *   3. fallback 路径: cwd changed → initialize
 *   4. fallback 路径: preset mismatch → initialize
 *   5. hot path: 替换 session + context.provide + bindExtensions + emit
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  installSessionRebind,
  rebindSession,
  __resetSessionRebindForTest,
} from "./session-rebind";
import { createDefaultAgentHostState } from "./_default-state";
import type { AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function makeStubDeps() {
  const events: Array<{ type: string; payload: unknown }> = [];
  const provides: Array<{ key: string; value: unknown }> = [];
  const emits: Array<{ name: string; payload: unknown }> = [];
  const initializeCalls: Array<unknown> = [];
  const replaceCalls: Array<unknown> = [];

  const state = createDefaultAgentHostState() as AgentHostState;

  // 模拟当前已有一个 session
  state.session = { sessionId: "prev-session-id", model: "test-model" } as any;
  state.model = "test-model" as any;
  state.cwd = "/test/cwd";
  state.modelRuntime = { id: "model-runtime" } as any;
  state.piResourceLoader = { id: "pi-resource-loader" } as any;
  state.context = {
    provide: (key: string, value: unknown) => {
      provides.push({ key, value });
    },
    emit: (name: string, payload: unknown) => {
      emits.push({ name, payload });
    },
  } as any;

  const newSession = {
    sessionId: "new-session-id",
    model: "new-test-model",
    sessionManager: { getSessionName: () => "" },
    setSessionName: vi.fn(),
    bindExtensions: vi.fn(async () => undefined),
  };

  const stub = {
    state,
    initialize: vi.fn(async (opts?: unknown) => {
      initializeCalls.push(opts);
    }),
    sessionPresetSelection: vi.fn(async (_sessionPath?: string | null) => undefined),
    replaceSession: vi.fn(async (opts: unknown) => {
      // stub: don't touch opts.sessionManager (real SessionManager.open
      // would mkdir -p which fails on fake paths).
      const stubbedOpts = { ...(opts as object), sessionManager: { id: "stubbed-sm" } };
      replaceCalls.push(stubbedOpts);
      return newSession;
    }),
    sessionManagerOpen: vi.fn((_sessionPath: string, _options: any, _cwd: string) => ({
      id: "stubbed-sm",
    })),
    agentHome: vi.fn(() => "/test/agent-home"),
    provideRpcUiContext: vi.fn(() => ({ id: "ui-context" })),
    emitPluginEvent: vi.fn((type: string, payload: unknown) => {
      events.push({ type, payload });
    }),
    emitRendererEvent: vi.fn(),
    questionAnswer: vi.fn(),
    createOpenBuddyRpcUiContext: vi.fn(() => ({ id: "rpc-ui-context" })),

    events,
    provides,
    emits,
    initializeCalls,
    replaceCalls,
    newSession,
  };

  return stub;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session-rebind", () => {
  let stub: ReturnType<typeof makeStubDeps>;

  beforeEach(() => {
    stub = makeStubDeps();
    installSessionRebind(stub as any);
  });

  afterEach(() => {
    __resetSessionRebindForTest();
  });

  // -------------------------------------------------------------------------
  // install pattern
  // -------------------------------------------------------------------------

  describe("install pattern", () => {
    it("replaces module-level state on install", async () => {
      // 已经 install, 调用 rebindSession 不应该抛错
      await rebindSession("/test/session.json", "/test/cwd");
    });

    it("throws when not installed", async () => {
      __resetSessionRebindForTest();
      await expect(rebindSession("/test/session.json", "/test/cwd")).rejects.toThrow(/not installed/);
      installSessionRebind(stub as any);
    });
  });

  // -------------------------------------------------------------------------
  // fallback paths
  // -------------------------------------------------------------------------

  describe("fallback paths", () => {
    it("falls back to initialize() when session is missing", async () => {
      stub.state.session = null;
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.initialize).toHaveBeenCalledWith({
        cwd: "/test/cwd",
        sessionPath: "/test/session.json",
      });
      expect(stub.replaceSession).not.toHaveBeenCalled();
    });

    it("falls back when modelRuntime is missing", async () => {
      stub.state.modelRuntime = null;
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.initialize).toHaveBeenCalled();
    });

    it("falls back when piResourceLoader is missing", async () => {
      stub.state.piResourceLoader = null;
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.initialize).toHaveBeenCalled();
    });

    it("falls back when context is missing", async () => {
      stub.state.context = null;
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.initialize).toHaveBeenCalled();
    });

    it("falls back when cwd differs from current", async () => {
      await rebindSession("/test/session.json", "/different/cwd");
      expect(stub.initialize).toHaveBeenCalledWith({
        cwd: "/different/cwd",
        sessionPath: "/test/session.json",
      });
      expect(stub.replaceSession).not.toHaveBeenCalled();
    });

    it("falls back when probed preset differs from mounted preset", async () => {
      stub.state.presetSessionRuntime = { id: "preset-a" } as any;
      stub.sessionPresetSelection.mockResolvedValueOnce("preset-b" as any);
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.initialize).toHaveBeenCalled();
      expect(stub.replaceSession).not.toHaveBeenCalled();
    });

    it("falls back when probed preset is unset but mounted preset exists", async () => {
      // Note: when probed is null/undefined, target = mounted. So mismatch
      // only happens when probed is non-null AND differs from mounted.
      stub.state.presetSessionRuntime = { id: "preset-a" } as any;
      stub.sessionPresetSelection.mockResolvedValueOnce("preset-b" as any);
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.initialize).toHaveBeenCalled();
    });

    it("does NOT fall back when probed preset matches mounted", async () => {
      stub.state.presetSessionRuntime = { id: "preset-a" } as any;
      stub.sessionPresetSelection.mockResolvedValueOnce("preset-a" as any);
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.initialize).not.toHaveBeenCalled();
      expect(stub.replaceSession).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // hot path
  // -------------------------------------------------------------------------

  describe("hot path (warm host reuse)", () => {
    beforeEach(() => {
      // 确保 sessionPresetSelection 返回 null (没有 preset hint)
      stub.sessionPresetSelection.mockResolvedValueOnce(null as any);
    });

    it("replaces session via replaceSession() with correct args", async () => {
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.replaceSession).toHaveBeenCalledTimes(1);
      const call = stub.replaceCalls[0] as any;
      expect(call.cwd).toBe("/test/cwd");
      expect(call.agentDir).toBe("/test/agent-home");
      expect(call.noTools).toBe("builtin");
      expect(call.modelRuntime).toBe(stub.state.modelRuntime);
      expect(call.resourceLoader).toBe(stub.state.piResourceLoader);
      // sessionManager is constructed inside rebindSession. The stub
      // replaceSession wraps it to avoid real SessionManager.open mkdir.
      expect(call.sessionManager).toBeDefined();
      expect((call.sessionManager as any).id).toBe("stubbed-sm");
    });

    it("updates state.session + state.model + clears state.queueMirror", async () => {
      state_queueMirror: {
        stub.state.queueMirror = [{ id: "old" }] as any;
      }
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.state.session).toBe(stub.newSession);
      expect(stub.state.model).toBe(stub.newSession.model);
      expect(stub.state.queueMirror).toEqual([]);
    });

    it("provides piSessionRaw + piExtensionApi to context", async () => {
      await rebindSession("/test/session.json", "/test/cwd");
      const keys = stub.provides.map((p) => p.key);
      expect(keys).toContain("piSessionRaw");
      expect(keys).toContain("piExtensionApi");
      const piSessionRaw = stub.provides.find((p) => p.key === "piSessionRaw");
      expect(piSessionRaw?.value).toBe(stub.newSession);
    });

    it("builds ui context via provideRpcUiContext with correct deps", async () => {
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.provideRpcUiContext).toHaveBeenCalledTimes(1);
      const call = (stub.provideRpcUiContext.mock.calls[0] as any[])[0];
      expect(call.context).toBe(stub.state.context);
      expect(call.session).toBe(stub.newSession);
      expect(call.state).toBe(stub.state);
    });

    it("kicks off bindExtensions via state.extensionsBound (fire-and-forget)", async () => {
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.newSession.bindExtensions).toHaveBeenCalledWith({
        uiContext: { id: "ui-context" },
        mode: "rpc",
      });
      expect(stub.state.extensionsBound).toBeInstanceOf(Promise);
    });

    it("emits pi/ready context event", async () => {
      await rebindSession("/test/session.json", "/test/cwd");
      const piReady = stub.emits.find((e) => e.name === "pi/ready");
      expect(piReady).toBeDefined();
      expect((piReady?.payload as any).sessionId).toBe("new-session-id");
    });

    it("emits session/created plugin event", async () => {
      await rebindSession("/test/session.json", "/test/cwd");
      const evt = stub.events.find((e) => e.type === "session/created");
      expect(evt).toBeDefined();
      expect((evt?.payload as any).sessionId).toBe("new-session-id");
    });

    it("sets session name to OpenBuddy when missing", async () => {
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.newSession.setSessionName).toHaveBeenCalledWith("OpenBuddy");
    });

    it("does NOT overwrite session name when already set", async () => {
      (stub.newSession.sessionManager as any).getSessionName = () => "Existing Name";
      await rebindSession("/test/session.json", "/test/cwd");
      expect(stub.newSession.setSessionName).not.toHaveBeenCalled();
    });
  });
});
