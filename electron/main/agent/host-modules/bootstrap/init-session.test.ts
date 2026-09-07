/**
 * init-session.test.ts — smoke tests for the initSession bootstrap stage.
 *
 * These tests verify the public surface (dep contract + happy path) of
 * initSession without standing up a full Pi session. The full integration
 * path is exercised by electron/main/agent/__tests__/event-channel-matrix.test.ts
 * and the IPC smoke tests under scripts/electron/*.
 */
import { describe, expect, it, vi } from "vitest";

import { initSession } from "./init-session";
import type { AgentHostState } from "../_state-shape";
import { createDefaultAgentHostState } from "../_default-state";

function makeStubState(): AgentHostState {
  const s = createDefaultAgentHostState() as AgentHostState;
  s.sessionEventLog = null;
  return s;
}

function makeStubDeps() {
  const context = {
    provide: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
    get: vi.fn(() => undefined),
    start: vi.fn(async () => undefined),
  };
  const loader = {
    list: vi.fn(() => []),
  };
  const state = makeStubState();
  state.context = context as any;
  state.loader = loader as any;
  state.profilePackagePaths = [];
  state.profilePackageJson = undefined;
  state.profilePiExtensions = [];
  state.piExtensionPaths = [];
  state.piExtensionFactories = [];
  state.piMarketplaceAgentFiles = [];
  state.piMarketplaceResourcePaths = {
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };

  const captured: Array<{ event: string; payload: unknown }> = [];
  const emitPluginEvent = vi.fn((event: string, payload: unknown) => {
    captured.push({ event, payload });
  });

  return {
    state,
    context,
    loader,
    emitPluginEvent,
    emitRendererEvent: vi.fn(),
    emitPiSessionEvent: vi.fn(),
    captureFileSnapshot: vi.fn(async () => ({})),
    sessionPresetSelection: vi.fn(async () => null),
    mountConfiguredAgentPreset: vi.fn(async () => "preset-a"),
    startProfileWatchers: vi.fn(async () => undefined),
    refreshMarketplacePiResourcePaths: vi.fn(async () => undefined),
    configurePiExtensions: vi.fn(),
    reportPiExtensionErrors: vi.fn(),
    syncMarketplacePiExtensionStatuses: vi.fn(async () => undefined),
    nativePiResourcePaths: vi.fn(() => ({ extensions: [], skills: [], prompts: [], themes: [] })),
    persistPiSessionHeaderImpl: vi.fn(async () => undefined),
    piSessionRuntime: {
      create: vi.fn(async () => ({
        sessionId: "test-session",
        sessionManager: { getSessionName: () => null, appendCustomEntry: vi.fn() },
        subscribe: vi.fn(() => () => undefined),
        bindExtensions: vi.fn(async () => undefined),
        setSessionName: vi.fn(),
        model: undefined,
      })),
      subscribe: vi.fn(() => () => undefined),
    },
    publicQueueItems: vi.fn(() => []),
    eventNamespace: vi.fn(),
    canonicalEventNamespace: vi.fn(),
    createOpenBuddyRpcUiContext: vi.fn(() => ({})),
    questionAnswer: vi.fn(),
    piHome: vi.fn(() => "/tmp/pi-home"),
    piSessionDir: vi.fn(() => "/tmp/pi-home/sessions"),
    createTeamRunner: vi.fn(() => ({})),
    captured,
  };
}

describe("init-session", () => {
  it("returns the freshly created sessionId", async () => {
    const deps = makeStubDeps();
    const id = await initSession({
      state: deps.state,
      context: deps.context as any,
      loader: deps.loader as any,
      cwd: "/test/cwd",
      modelRuntime: null,
      sessionPath: undefined,
      emitPluginEvent: deps.emitPluginEvent,
      emitRendererEvent: deps.emitRendererEvent,
      emitPiSessionEvent: deps.emitPiSessionEvent,
      captureFileSnapshot: deps.captureFileSnapshot,
      sessionPresetSelection: deps.sessionPresetSelection,
      mountConfiguredAgentPreset: deps.mountConfiguredAgentPreset,
      startProfileWatchers: deps.startProfileWatchers,
      refreshMarketplacePiResourcePaths: deps.refreshMarketplacePiResourcePaths,
      configurePiExtensions: deps.configurePiExtensions,
      reportPiExtensionErrors: deps.reportPiExtensionErrors,
      syncMarketplacePiExtensionStatuses: deps.syncMarketplacePiExtensionStatuses,
      nativePiResourcePaths: deps.nativePiResourcePaths,
      persistPiSessionHeaderImpl: deps.persistPiSessionHeaderImpl,
      piSessionRuntime: deps.piSessionRuntime as any,
      publicQueueItems: deps.publicQueueItems,
      eventNamespace: deps.eventNamespace,
      canonicalEventNamespace: deps.canonicalEventNamespace,
      createOpenBuddyRpcUiContext: deps.createOpenBuddyRpcUiContext,
      questionAnswer: deps.questionAnswer,
      piHome: deps.piHome,
      piSessionDir: deps.piSessionDir,
      createTeamRunner: deps.createTeamRunner as any,
    });
    expect(id).toBe("test-session");
  });

  it("emits session/created + plugin/ready on success", async () => {
    const deps = makeStubDeps();
    await initSession({
      state: deps.state,
      context: deps.context as any,
      loader: deps.loader as any,
      cwd: "/test/cwd",
      modelRuntime: null,
      sessionPath: undefined,
      emitPluginEvent: deps.emitPluginEvent,
      emitRendererEvent: deps.emitRendererEvent,
      emitPiSessionEvent: deps.emitPiSessionEvent,
      captureFileSnapshot: deps.captureFileSnapshot,
      sessionPresetSelection: deps.sessionPresetSelection,
      mountConfiguredAgentPreset: deps.mountConfiguredAgentPreset,
      startProfileWatchers: deps.startProfileWatchers,
      refreshMarketplacePiResourcePaths: deps.refreshMarketplacePiResourcePaths,
      configurePiExtensions: deps.configurePiExtensions,
      reportPiExtensionErrors: deps.reportPiExtensionErrors,
      syncMarketplacePiExtensionStatuses: deps.syncMarketplacePiExtensionStatuses,
      nativePiResourcePaths: deps.nativePiResourcePaths,
      persistPiSessionHeaderImpl: deps.persistPiSessionHeaderImpl,
      piSessionRuntime: deps.piSessionRuntime as any,
      publicQueueItems: deps.publicQueueItems,
      eventNamespace: deps.eventNamespace,
      canonicalEventNamespace: deps.canonicalEventNamespace,
      createOpenBuddyRpcUiContext: deps.createOpenBuddyRpcUiContext,
      questionAnswer: deps.questionAnswer,
      piHome: deps.piHome,
      piSessionDir: deps.piSessionDir,
      createTeamRunner: deps.createTeamRunner as any,
    });
    const events = deps.captured.map((c) => c.event);
    expect(events).toContain("session/created");
  });

  it("disposes the preset runtime on create failure", async () => {
    const deps = makeStubDeps();
    deps.piSessionRuntime.create = vi.fn(async () => {
      throw new Error("session-create failed");
    });
    deps.state.presetSessionRuntime = {
      dispose: vi.fn(async () => undefined),
      renderSystemPrompt: vi.fn(() => undefined),
    } as any;
    await expect(initSession({
      state: deps.state,
      context: deps.context as any,
      loader: deps.loader as any,
      cwd: "/test/cwd",
      modelRuntime: null,
      sessionPath: undefined,
      emitPluginEvent: deps.emitPluginEvent,
      emitRendererEvent: deps.emitRendererEvent,
      emitPiSessionEvent: deps.emitPiSessionEvent,
      captureFileSnapshot: deps.captureFileSnapshot,
      sessionPresetSelection: deps.sessionPresetSelection,
      mountConfiguredAgentPreset: deps.mountConfiguredAgentPreset,
      startProfileWatchers: deps.startProfileWatchers,
      refreshMarketplacePiResourcePaths: deps.refreshMarketplacePiResourcePaths,
      configurePiExtensions: deps.configurePiExtensions,
      reportPiExtensionErrors: deps.reportPiExtensionErrors,
      syncMarketplacePiExtensionStatuses: deps.syncMarketplacePiExtensionStatuses,
      nativePiResourcePaths: deps.nativePiResourcePaths,
      persistPiSessionHeaderImpl: deps.persistPiSessionHeaderImpl,
      piSessionRuntime: deps.piSessionRuntime as any,
      publicQueueItems: deps.publicQueueItems,
      eventNamespace: deps.eventNamespace,
      canonicalEventNamespace: deps.canonicalEventNamespace,
      createOpenBuddyRpcUiContext: deps.createOpenBuddyRpcUiContext,
      questionAnswer: deps.questionAnswer,
      piHome: deps.piHome,
      piSessionDir: deps.piSessionDir,
      createTeamRunner: deps.createTeamRunner as any,
    })).rejects.toThrow(/session-create failed/);
    expect(deps.state.presetSessionRuntime).toBeNull();
  });
});
