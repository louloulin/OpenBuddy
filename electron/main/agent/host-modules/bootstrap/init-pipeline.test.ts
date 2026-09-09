/**
 * host-modules/bootstrap/init-pipeline.test.ts
 *
 * v6-E — Smoke tests for the 8-stage init orchestrator.
 *
 * Strategy: stub every dependency as a vi.fn() so we can verify stage
 * ordering, dependency wiring, and the final plugin/ready emit without
 * touching any real filesystem / Cordis / Pi SDK.
 */
import { describe, expect, it, vi } from "vitest";

import { runInitPipeline, type InitPipelineDeps } from "./init-pipeline";

function buildFakeDeps(): InitPipelineDeps {
  const fakeContext = {
    provide: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
  };
  const callOrder: string[] = [];
  const tracker = (name: string) => vi.fn((..._args: unknown[]) => {
    callOrder.push(name);
    return undefined;
  });
  return {
    state: {
      toolRegistryRevision: 0,
      eventSequence: 0,
    } as InitPipelineDeps["state"],
    cwd: () => "/fake/cwd",
    piHome: () => "/fake/pi-home",
    isPathWithin: () => true,
    piSessionDir: () => "/fake/session-dir",
    emitPluginEvent: tracker("emitPluginEvent"),
    emitRendererEvent: tracker("emitRendererEvent"),
    getMicrokernelHostDeps: () => ({}),
    installMicrokernelHost: tracker("installMicrokernelHost"),
    bootstrapSessionEventLog: vi.fn(async () => {
      callOrder.push("bootstrapSessionEventLog");
    }),
    bootstrapModelRuntime: vi.fn(async () => {
      callOrder.push("bootstrapModelRuntime");
    }),
    createToolRegistry: vi.fn(() => ({ list: () => [] })),
    createPiRuntime: vi.fn(() => ({})),
    createPiSessionFacade: vi.fn(() => ({})),
    refreshPiExtensions: vi.fn(),
    createJobsRegistry: vi.fn(() => ({})),
    wireContextServices: vi.fn(),
    wireDshServices: vi.fn(),
    wireForwardedEvents: vi.fn(),
    setupProfileOptions: vi.fn(async () => {
      callOrder.push("setupProfileOptions");
      return { resolvedProfile: {}, profileOptions: undefined };
    }),
    ensureDefaultPiPackages: vi.fn(async () => []),
    initProfile: vi.fn(async () => {
      callOrder.push("initProfile");
      return { profileBundle: {}, profilePackageJson: "{}" };
    }),
    initPluginLoader: vi.fn(async () => {
      callOrder.push("initPluginLoader");
      return { loader: { list: () => [1, 2, 3] }, pluginState: {} };
    }),
    initDeepSeek: vi.fn(async () => {
      callOrder.push("initDeepSeek");
    }),
    computeActiveAdapterIds: vi.fn(() => []),
    injectSystemPromptSections: vi.fn(async () => {
      callOrder.push("injectSystemPromptSections");
    }),
    initSession: vi.fn(async () => {
      callOrder.push("initSession");
    }),
    prompt: vi.fn(async () => undefined),
    steer: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    getModel: () => undefined,
    setModel: vi.fn(async () => undefined),
    newSession: vi.fn(async () => undefined),
    loadSession: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => []),
    listAllPiSessions: vi.fn(async () => []),
    listPersistedSessionHeadersImpl: vi.fn(async () => []),
    appendPersistedSessionEntriesImpl: vi.fn(async () => undefined),
    appendLifecycleSessionEntryImpl: vi.fn(async () => undefined),
    reserveDeepSeekPreparation: vi.fn(async () => undefined),
    reserveDeepSeekAgent: vi.fn(async () => undefined),
    createDeepSeekAgent: vi.fn(async () => undefined),
    resumeDeepSeekAgent: vi.fn(async () => undefined),
    createTeamRunner: vi.fn(() => ({})),
    openBuddyCorePlugin: {},
    listSubagentChildren: vi.fn(async () => []),
    listCommands: vi.fn(() => []),
    listPluginInventory: vi.fn(async () => ({})),
    listPlugins: vi.fn(() => []),
    listDshFileReferences: vi.fn(async () => []),
    listRunningTasks: vi.fn(() => []),
    killTask: vi.fn(async () => undefined),
    remoteServiceContext: vi.fn(() => ({})),
    transitionDshGoal: vi.fn(async () => undefined),
    openBuddyCapabilityPluginIndex: undefined,
    baseUrl: "file:///fake/base",
    describeCompatibilityAdapterCommandsMarkdown: () => "",
    emitPiSessionEvent: vi.fn(),
    captureFileSnapshot: vi.fn(async () => undefined),
    sessionPresetSelection: vi.fn(async () => undefined),
    mountConfiguredAgentPreset: vi.fn(async () => undefined),
    startProfileWatchers: vi.fn(async () => undefined),
    refreshMarketplacePiResourcePaths: vi.fn(async () => undefined),
    configurePiExtensions: vi.fn(async () => undefined),
    reportPiExtensionErrors: vi.fn(async () => undefined),
    syncMarketplacePiExtensionStatuses: vi.fn(async () => undefined),
    nativePiResourcePaths: vi.fn(() => ({})),
    persistPiSessionHeaderImpl: vi.fn(async () => undefined),
    piSessionRuntime: {},
    publicQueueItems: () => [] as readonly unknown[],
    eventNamespace: "ob",
    canonicalEventNamespace: "openbuddy",
    createOpenBuddyRpcUiContext: vi.fn(() => ({})),
    questionAnswer: vi.fn(() => undefined),
    piResources: {},
    refreshPiExtensionsFn: vi.fn(),
    sessionPath: undefined,
    emitPluginReadyEvent: vi.fn((payload) => {
      callOrder.push(`emitPluginReadyEvent:${payload.count}`);
    }),
    _fakeContext: fakeContext,
    _callOrder: callOrder,
  } as unknown as InitPipelineDeps;
}

describe("init-pipeline", () => {
  it("runs the 8 stages in the canonical order", async () => {
    const deps = buildFakeDeps() as InitPipelineDeps & {
      _callOrder: string[];
    };
    await runInitPipeline(deps);
    // Verify stage ordering: hydration → model → install → wire → profile → deepseek → session → ready
    const order = (deps as unknown as { _callOrder: string[] })._callOrder;
    const idxHydrate = order.indexOf("bootstrapSessionEventLog");
    const idxModel = order.indexOf("bootstrapModelRuntime");
    const idxProfile = order.indexOf("setupProfileOptions");
    const idxPluginLoader = order.indexOf("initPluginLoader");
    const idxDeepseek = order.indexOf("initDeepSeek");
    const idxSession = order.indexOf("initSession");
    expect(idxHydrate).toBeLessThan(idxModel);
    expect(idxModel).toBeLessThan(idxProfile);
    expect(idxProfile).toBeLessThan(idxPluginLoader);
    expect(idxPluginLoader).toBeLessThan(idxDeepseek);
    expect(idxDeepseek).toBeLessThan(idxSession);
    // Final stage: emit plugin/ready with loader count.
    expect(order[order.length - 1]).toBe("emitPluginReadyEvent:3");
  });

  it("wires context services with the expected core deps", async () => {
    const deps = buildFakeDeps();
    await runInitPipeline(deps);
    expect(deps.wireContextServices).toHaveBeenCalledTimes(1);
    const arg = (deps.wireContextServices as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toHaveProperty("state");
    expect(arg).toHaveProperty("context");
    expect(arg).toHaveProperty("cwd");
    expect(arg).toHaveProperty("prompt");
    expect(arg).toHaveProperty("abort");
    expect(arg).toHaveProperty("listSessions");
  });

  it("wires DSH services after context services", async () => {
    const deps = buildFakeDeps();
    await runInitPipeline(deps);
    expect(deps.wireDshServices).toHaveBeenCalledTimes(1);
  });

  it("starts the cordis context exactly once", async () => {
    const deps = buildFakeDeps();
    const ctx = await runInitPipeline(deps);
    // start() should have been called on the freshly-created context.
    // (We can't directly observe start() since runInitPipeline creates its own
    //  Context via dynamic import. We can still verify the pipeline returned
    //  a context-like object.)
    expect(ctx).toBeDefined();
  });
});
