/**
 * profile-artifact-reconciler.test.ts — 单元测试 profile artifact 域.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  installProfileArtifactReconciler,
  discoverProfileRemoteContributions,
  discoverProfileTypertContributions,
  clearProfileArtifacts,
  installProfileArtifacts,
  reconcileProfileArtifacts,
  __resetProfileArtifactReconcilerForTest,
} from "./profile-artifact-reconciler";
import { createDefaultAgentHostState } from "./_default-state";
import type { AgentHostState } from "./_state-shape";

function makeStubDeps() {
  const state = createDefaultAgentHostState() as AgentHostState;
  const typertRegister = vi.fn(() => vi.fn());
  typertRegister(); // 调用一次获取 dispose (实际无副作用, 让 spy 正常工作)
  // Cache the typert service so repeated `context.get("typert")` calls
  // return the same object — otherwise the reconciler subscribes to a
  // brand-new mock fn on every reconcile, leaving the test-captured spy
  // with zero calls. The runtime behaviour is identical (single typert
  // service instance for the lifetime of a context).
  const typertService = {
    register: typertRegister,
    subscribe: vi.fn(() => vi.fn()),
    beginTransaction: () => ({ commit: vi.fn(), rollback: vi.fn() }),
  };
  state.context = {
    get: vi.fn((key: string) => {
      if (key === "typert") return typertService;
      return undefined;
    }),
  } as any;
  state.remoteDispatcher = {
    register: vi.fn(),
    unregister: vi.fn(),
  } as any;
  state.profileRemoteContributions = new Map();
  state.profileTypertContributions = new Map();
  state.cwd = "/test/cwd";
  state.profilePackagePaths = ["/test/pkg-a"];
  state.profilePackageJson = "{}";
  state.typertRegistryUnsubscribe = null;
  state.profileArtifactGeneration = 0;
  state.rendererPluginManifestCache = null;

  const remoteMap = new Map();
  remoteMap.set("pkg-a", { package: "pkg-a", descriptors: [] });
  const typertMap = new Map();
  typertMap.set("pkg-a", { package: "pkg-a", invocations: [] });

  const events: Array<{ type: string; payload: unknown }> = [];

  const stub = {
    state,
    emitPluginEvent: vi.fn((type: string, payload: unknown) => {
      events.push({ type, payload });
    }),
    discoverRemote: vi.fn(async () => remoteMap),
    discoverTypert: vi.fn(async () => typertMap),
    serializeRemote: vi.fn((contribution: any) => contribution),
    remoteServiceContext: vi.fn(() => ({})),
    typertRegister,
    events,
    remoteMap,
    typertMap,
  };
  return stub;
}

describe("profile-artifact-reconciler", () => {
  let stub: ReturnType<typeof makeStubDeps>;

  beforeEach(() => {
    stub = makeStubDeps();
    installProfileArtifactReconciler(stub as any);
  });

  afterEach(() => {
    __resetProfileArtifactReconcilerForTest();
  });

  // install pattern
  it("throws when not installed", async () => {
    __resetProfileArtifactReconcilerForTest();
    await expect(discoverProfileRemoteContributions()).rejects.toThrow(/not installed/);
    installProfileArtifactReconciler(stub as any);
  });

  // discover functions
  it("discoverProfileRemoteContributions returns injected map", async () => {
    const result = await discoverProfileRemoteContributions();
    expect(result).toBe(stub.remoteMap);
  });

  it("discoverProfileTypertContributions returns injected map", async () => {
    const result = await discoverProfileTypertContributions();
    expect(result).toBe(stub.typertMap);
  });

  // clearProfileArtifacts
  it("clearProfileArtifacts unregisters all remote + typert contributions", () => {
    stub.state.profileRemoteContributions.set("pkg-a", { package: "pkg-a", descriptors: [] } as any);
    stub.state.profileTypertContributions.set("pkg-a", {
      contribution: { package: "pkg-a" },
      dispose: vi.fn(),
    } as any);
    clearProfileArtifacts();
    expect(stub.state.remoteDispatcher.unregister).toHaveBeenCalledWith("pkg-a");
    expect(stub.state.profileTypertContributions.size).toBe(0);
    expect(stub.state.profileRemoteContributions.size).toBe(0);
  });

  // installProfileArtifacts
  it("installProfileArtifacts registers remote contributions", () => {
    stub.typertRegister.mockClear();
    installProfileArtifacts(stub.remoteMap, new Map());
    expect(stub.state.remoteDispatcher.register).toHaveBeenCalled();
    expect(stub.state.profileRemoteContributions.size).toBe(1);
  });

  it("installProfileArtifacts throws if typert unavailable and contributions present", () => {
    stub.state.context = { get: vi.fn(() => ({ register: undefined })) } as any;
    expect(() => installProfileArtifacts(new Map(), stub.typertMap)).toThrow(/registry is unavailable/);
  });

  it("installProfileArtifacts rolls back on failure", () => {
    stub.state.remoteDispatcher.register = vi.fn(() => {
      throw new Error("register failed");
    });
    expect(() => installProfileArtifacts(stub.remoteMap, new Map())).toThrow(/register failed/);
    // Rollback should unregister the package
    expect(stub.state.remoteDispatcher.unregister).toHaveBeenCalled();
  });

  // reconcileProfileArtifacts
  it("reconcileProfileArtifacts increments generation", async () => {
    const gen = stub.state.profileArtifactGeneration;
    await reconcileProfileArtifacts();
    expect(stub.state.profileArtifactGeneration).toBe(gen + 1);
  });

  it("reconcileProfileArtifacts subscribes to typert registry changes (once)", async () => {
    const subscribeFn = stub.state.context?.get("typert")?.subscribe as any;
    await reconcileProfileArtifacts();
    await reconcileProfileArtifacts();
    expect(subscribeFn).toHaveBeenCalledTimes(1);
  });

  it("reconcileProfileArtifacts calls discover + install", async () => {
    await reconcileProfileArtifacts();
    expect(stub.discoverRemote).toHaveBeenCalled();
    expect(stub.discoverTypert).toHaveBeenCalled();
    expect(stub.state.remoteDispatcher.register).toHaveBeenCalled();
  });

  it("reconcileProfileArtifacts rolls back to previous on failure", async () => {
    // Seed previous registration
    stub.state.profileRemoteContributions.set("prev", {
      package: "prev",
      descriptors: [],
    } as any);
    stub.state.profileTypertContributions.set("prev", {
      contribution: { package: "prev", invocations: [] },
      dispose: vi.fn(),
    } as any);

    // Make discoverRemote throw to trigger rollback
    stub.discoverRemote.mockRejectedValueOnce(new Error("discover failed"));
    await expect(reconcileProfileArtifacts()).rejects.toThrow(/discover failed/);
    // previous registrations should be restored
    expect(stub.state.profileRemoteContributions.has("prev")).toBe(true);
    expect(stub.state.profileTypertContributions.has("prev")).toBe(true);
  });

  it("reconcileProfileArtifacts throws AggregateError when rollback also fails", async () => {
    stub.state.profileRemoteContributions.set("prev", {
      package: "prev",
      descriptors: [],
    } as any);
    stub.state.profileTypertContributions.set("prev", {
      contribution: { package: "prev", invocations: [] },
      dispose: vi.fn(),
    } as any);

    // Both discover + rollback path fail
    stub.discoverRemote.mockRejectedValueOnce(new Error("discover failed"));
    stub.state.remoteDispatcher.register = vi.fn(() => {
      throw new Error("rollback failed too");
    });
    await expect(reconcileProfileArtifacts()).rejects.toThrow(/reconciliation and rollback failed/);
  });
});
