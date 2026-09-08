/**
 * dispose-internal.test.ts — 单元测试 host lifecycle 清理路径.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  installDisposeInternal,
  disposeInternal,
  __resetDisposeInternalForTest,
} from "./dispose-internal";
import { createDefaultAgentHostState } from "./_default-state";
import type { AgentHostState } from "./_state-shape";

function makeStubDeps() {
  const state = createDefaultAgentHostState() as AgentHostState;
  state.session = { sessionId: "test-session" } as any;
  const contextEmit = vi.fn();
  state.context = {
    emit: contextEmit,
  } as any;
  state.profileReloadPromise = Promise.resolve();
  state.capabilityEventBridgeUnsubscribe = vi.fn();
  state.typertRegistryUnsubscribe = vi.fn();
  state.remoteDispatcher = { clear: vi.fn() } as any;
  state.presetSessionRuntime = { dispose: vi.fn(async () => undefined) } as any;
  state.profileRemoteContributions = new Map();
  state.profileTypertContributions = new Map();
  const fakeRegistration = { dispose: vi.fn() };
  state.profileTypertContributions.set("a", fakeRegistration as any);
  state.loader = { dispose: vi.fn(async () => undefined) } as any;
  state.terminalRuntime = { dispose: vi.fn(async () => undefined) } as any;
  state.subprocessRuntime = { dispose: vi.fn(async () => undefined) } as any;
  state.deepSeekCordisRuntime = { dispose: vi.fn(async () => undefined) } as any;
  state.deepSeekCordisSnapshot = { plugins: [] } as any;
  state.sessionEventLog = { flush: vi.fn(async () => undefined), clear: vi.fn() } as any;
  state.runningTasks = new Map();
  state.jobsRegistry = { clear: vi.fn() } as any;
  state.continuableSubagents = new Map();
  state.deepSeekAgents = new Map();
  state.hookPermissionSessionRules = new Map();
  state.pendingUiRequests = new Map();
  state.extensionEditorText = new Map();
  state.extensionToolsExpanded = new Map();
  state.piMarketplaceResourcePaths = { extensions: [], skills: [], prompts: [], themes: [] };
  state.piMarketplaceAgentFiles = [];

  const events: Array<{ type: string; payload: unknown }> = [];
  // 保存引用, 因为 dispose 后 state 字段被清空
  const loaderDispose = vi.fn(async () => undefined);
  const terminalDispose = vi.fn(async () => undefined);
  const subprocessDispose = vi.fn(async () => undefined);
  const deepSeekDispose = vi.fn(async () => undefined);
  const logFlush = vi.fn(async () => undefined);
  const logClear = vi.fn();
  state.loader = { dispose: loaderDispose } as any;
  state.terminalRuntime = { dispose: terminalDispose } as any;
  state.subprocessRuntime = { dispose: subprocessDispose } as any;
  state.deepSeekCordisRuntime = { dispose: deepSeekDispose } as any;
  state.sessionEventLog = { flush: logFlush, clear: logClear } as any;

  const stub = {
    state,
    emitPluginEvent: vi.fn((type: string, payload: unknown) => {
      events.push({ type, payload });
    }),
    piSessionRuntimeDispose: vi.fn(async () => undefined),
    stopProfileWatchers: vi.fn(),
    disposeProfileTypertRegistrations: vi.fn(),
    disposeActiveHookProcesses: vi.fn(),
    drainActiveHookProcesses: vi.fn(async () => undefined),
    fakeRegistration,
    events,
    loaderDispose,
    terminalDispose,
    subprocessDispose,
    deepSeekDispose,
    logFlush,
    logClear,
    contextEmit,
  };
  return stub;
}

describe("dispose-internal", () => {
  let stub: ReturnType<typeof makeStubDeps>;

  beforeEach(() => {
    stub = makeStubDeps();
    installDisposeInternal(stub as any);
  });

  afterEach(() => {
    __resetDisposeInternalForTest();
  });

  it("throws when not installed", async () => {
    __resetDisposeInternalForTest();
    await expect(disposeInternal()).rejects.toThrow(/not installed/);
    installDisposeInternal(stub as any);
  });

  it("calls hooks drain + piSessionRuntime.dispose", async () => {
    await disposeInternal();
    expect(stub.disposeActiveHookProcesses).toHaveBeenCalled();
    expect(stub.drainActiveHookProcesses).toHaveBeenCalled();
    expect(stub.piSessionRuntimeDispose).toHaveBeenCalled();
  });

  it("emits pi/dispose via context + session/dispose via plugin event", async () => {
    await disposeInternal();
    expect(stub.contextEmit).toHaveBeenCalledWith("pi/dispose", { sessionId: "test-session" });
    expect(stub.emitPluginEvent).toHaveBeenCalledWith("session/dispose", { sessionId: "test-session" });
  });

  it("clears state fields after dispose", async () => {
    await disposeInternal();
    expect(stub.state.session).toBeNull();
    expect(stub.state.context).toBeNull();
    expect(stub.state.loader).toBeNull();
    expect(stub.state.modelRuntime).toBeNull();
    expect(stub.state.cwd).toBeNull();
    expect(stub.state.presetSessionRuntime).toBeNull();
  });

  it("disposes preset runtime even if it throws", async () => {
    stub.state.presetSessionRuntime = {
      dispose: vi.fn(async () => {
        throw new Error("dispose failed");
      }),
    } as any;
    // Should not throw — only log a warning.
    await expect(disposeInternal()).resolves.toBeUndefined();
    expect(stub.state.presetSessionRuntime).toBeNull();
  });

  it("catches piSessionRuntime.dispose errors", async () => {
    stub.piSessionRuntimeDispose.mockRejectedValueOnce(new Error("pi dispose failed"));
    // Should not throw — only log a warning.
    await expect(disposeInternal()).resolves.toBeUndefined();
  });

  it("unsubscribes capability + typert event bridges", async () => {
    await disposeInternal();
    expect(stub.state.capabilityEventBridgeUnsubscribe).toBeNull();
    expect(stub.state.typertRegistryUnsubscribe).toBeNull();
  });

  it("disposes plugin loader + terminal + subprocess + deepseek cordis", async () => {
    await disposeInternal();
    expect(stub.loaderDispose).toHaveBeenCalled();
    expect(stub.terminalDispose).toHaveBeenCalled();
    expect(stub.subprocessDispose).toHaveBeenCalled();
    expect(stub.deepSeekDispose).toHaveBeenCalled();
    expect(stub.state.deepSeekCordisRuntime).toBeNull();
    expect(stub.state.deepSeekCordisSnapshot).toBeNull();
  });

  it("flushes + clears session event log", async () => {
    await disposeInternal();
    expect(stub.logFlush).toHaveBeenCalled();
    expect(stub.logClear).toHaveBeenCalled();
    expect(stub.state.sessionEventLog).toBeNull();
  });

  it("resolves pending UI requests with undefined", async () => {
    const pendingRequest = { resolve: vi.fn() };
    stub.state.pendingUiRequests.set("r1", pendingRequest as any);
    stub.state.pendingUiRequests.set("r2", { resolve: vi.fn() } as any);
    await disposeInternal();
    expect(pendingRequest.resolve).toHaveBeenCalledWith(undefined);
    expect(stub.state.pendingUiRequests.size).toBe(0);
  });

  it("clears marketplace resource paths + agent files", async () => {
    stub.state.piMarketplaceResourcePaths.extensions = ["/keep/me"];
    stub.state.piMarketplaceAgentFiles = [{ path: "a", content: "b" }];
    await disposeInternal();
    expect(stub.state.piMarketplaceResourcePaths.extensions).toEqual([]);
    expect(stub.state.piMarketplaceAgentFiles).toEqual([]);
  });

  it("skips pi/dispose context emit when session is null", async () => {
    stub.state.session = null;
    stub.state.context = null;
    await disposeInternal();
    expect(stub.emitPluginEvent).not.toHaveBeenCalledWith("session/dispose", expect.anything());
  });
});
