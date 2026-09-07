/**
 * bootstrap/install-host-modules.ts — single entry point that wires every
 * host-module's module-level state via its `installXxx()` pattern.
 *
 * Phase 8.3 §33.5.3: extract this from agent-host.ts:initialize() so the
 * 17 install calls live in one place. agent-host.ts becomes thinner (a
 * thin facade that bootstraps + wires the context providers + creates
 * the AgentSession) and each host-module keeps its own install contract.
 *
 * Why one file:
 *   - Single import surface for agent-host.ts (one function vs 17 lines).
 *   - The install order matters: bootstrap must happen BEFORE the
 *     install calls so `state.modelRuntime` / `state.piExtensionStatuses`
 *     are populated. Centralising in one function lets us document and
 *     test the ordering.
 *   - Easy to add new install calls without touching agent-host.ts.
 *
 * Reverse-dependency invariant:
 *   This module imports from each host-module's install() but does NOT
 *   import agent-host. The deps parameter (InstallHostModuleDeps) carries
 *   every helper that used to be a closure variable in initialize().
 */

import { installHarnessCursors } from "../harness-cursors";
import { installHookPermission } from "../hook-permission";
import { installOverridePatches } from "../profile/override-patches";
import { installProfileSnapshot } from "../profile/snapshot";
import { installProfileBundles } from "../profile/bundles";
import { installPluginEventBus } from "../plugin-event-bus";
import { installPluginState } from "../plugin-state";
import { installSessionMetadata } from "../session-metadata";
import { installSessionStore } from "../session-store";
import { installSubagentRuntime } from "../subagent-runtime";
import { installAgentPrompt } from "../agent-prompt";
import { installWorkbenchScope } from "../workbench-scope";
import { installAgentModel } from "../agent-model";
import { installPluginMutations } from "../plugin-mutations";
import { installDeepSeekAgentRuntime } from "../deepseek/agent-runtime";
import { installDeepSeekCordisRuntime } from "../deepseek/cordis-runtime";
import { installTeamRunner } from "../team-runner";
import { installProviderRegistryTracker } from "../../agent-host-provider-registry";
import { installProfileReloadTransaction } from "../profile-reload-transaction";
import { installSessionRebind } from "../session-rebind";
import { installPiExtensionConfigure } from "../pi-extension-configure";
import { installAgentPresetRuntime } from "../agent-preset-runtime";
import { installDisposeInternal } from "../dispose-internal";
import { installWorkbenchScopeSync } from "../workbench-scope-sync";
import { installUiRequestResolver } from "../ui-request-resolver";

import type { AgentHostState } from "../_state-shape";

/**
 * Dependencies required to install every host-module. These are functions
 * that used to be closure variables in agent-host.ts:initialize(). Keeping
 * them as parameters lets this bootstrap module stay free of agent-host
 * reverse dependencies.
 *
 * NOTE: only include the deps that are NOT already on `state`. Anything
 * stored in `state` after bootstrap (modelRuntime, piExtensionStatuses,
 * etc.) is accessed via `state` directly inside the host-modules.
 */
export interface InstallHostModuleDeps {
  // Path helpers
  piHome: () => string;
  isPathWithin: (root: string, candidate: string) => boolean;
  piSessionDir: (cwd: string) => string;
  // Event emitters
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  // Session helpers
  listAllPiSessions: <T = unknown>() => any;
  persistedSessionPath: (sessionId: string | undefined) => Promise<string | undefined>;
  // Lifecycle queue
  enqueueLifecycle: <T>(operation: () => Promise<T>) => Promise<T>;
  lifecycleAppendQueues: Map<string, Promise<void>>;
  // Self-references for module-level re-entry (session-store / subagent)
  initialize: (opts?: { cwd?: string; sessionPath?: string; force?: boolean }) => Promise<void>;
  rebindSession: (sessionPath: string, cwd: string) => Promise<void>;
  dispose: () => Promise<void>;
  // pi runtime helpers
  piRuntimeCoordinator: { reload: (reason: string) => Promise<void> };
  publicQueueItems: (session: unknown) => readonly unknown[];
  // Profile helpers
  workspaceRegistry: unknown;
  readModelsConfig: () => unknown;
  // team-runner / deepseek runtime helpers
  canonicalEventNamespace: (...args: any[]) => any;
  eventNamespace: (...args: any[]) => any;
  createSubagentResourceLoader: (...args: any[]) => any;
  createTaskAwareTool: (...args: any[]) => any;
  modelFacingPresetTools: unknown;
  runHookPoint: (...args: any[]) => any;
  // Plugin mutations helpers
  profileArtifactModuleUrl: (id: string) => string;
  profilePackages: () => Promise<readonly unknown[]>;
  pluginLifecycleQueue: { enqueue: (...args: any[]) => any };
  setProfilePiResourcePaths: (...args: any[]) => any;
  refreshMarketplacePiResourcePaths: (...args: any[]) => any;
  refreshHookConfigs: (...args: any[]) => any;
  syncMarketplacePiExtensionStatuses: (...args: any[]) => any;
  startProfileWatchers: (...args: any[]) => any;
  readOverridePatches: (...args: any[]) => any;
  runtimeProfileBundle: (...args: any[]) => any;
  reconcileProfileArtifacts: (...args: any[]) => any;
  configurePiExtensions: (specs: readonly unknown[]) => void;
  reportPiExtensionErrors: () => void;
  captureReloadableContextServices: () => Map<string, unknown>;
  restoreCapturedContextServices: (...args: any[]) => any;
  // profile-reload-transaction helpers
  capturePiProfileSnapshot: () => any;
  restorePiProfileSnapshot: (snapshot: any) => void;
  captureDeepSeekCapabilityServices: () => Map<string, unknown>;
  restoreDeepSeekCapabilityServices: (captured?: Map<string, unknown>) => Promise<void>;
  materializeOpenBuddyProfile: (options: any) => Promise<{ profile: any; bundle: any }>;
  createOpenBuddyProfile: () => any;
  composePluginPatches: (entries: readonly any[], patches: readonly any[][]) => any[];
  syncDeepSeekCordisRuntime: (entries: readonly any[]) => Promise<void>;
  deepSeekCoreRuntimeEntries: (patches: readonly any[]) => any[];
  reloadMcp: () => Promise<void>;
  rollbackPiProfile: (...args: any[]) => any;
  scheduleProfileReload: () => void;
  // dispose-internal
  piSessionRuntimeDispose: () => Promise<void>;
  stopProfileWatchers: () => void;
  disposeProfileTypertRegistrations: (values: Iterable<any>) => void;
  disposeActiveHookProcesses: () => void;
  drainActiveHookProcesses: () => Promise<void>;
  // workbench-scope
  casdoorStatus: () => any;
  // ui-request-resolver
  permissionReadRules: () => Promise<any[]>;
  permissionWriteRules: (rules: any[]) => Promise<void>;
  // agent-preset-runtime
  listAgentPresets: (cwd: string) => Promise<any[]>;
  readAgentPresetDefaults: () => Promise<{ default?: string } | undefined>;
  writeAgentPresetDefault: (defaultId?: string) => Promise<void>;
  readAgentPreset: (presetId: string, cwd: string) => Promise<string>;
  createPresetSessionRuntime: (opts: any) => any;
  sessionHasConversation: (entries: any[]) => boolean;
  piRuntimeCoordinatorReload: (reason: string) => Promise<void>;
  // session-rebind (warm-host fast path)
  sessionPresetSelection: (sessionPath?: string | null) => Promise<string | null | undefined>;
  replaceSession: (opts: any) => Promise<any>;
  sessionManagerOpen: (sessionPath: string, options: any, cwd: string) => any;
  agentHome: () => string;
  provideRpcUiContext: (deps: any) => any;
  questionAnswer: (value: any, key?: string) => string | undefined;
  createOpenBuddyRpcUiContext: (deps: any) => any;
  // pi-extension-configure (built-in factories + extension diagnostics)
  telemetrySink: () => any;
  resolveProfileDirectory: () => string;
  requestHookPermission: (title: string, message: string, request?: any) => Promise<any>;
  createRequire: (path: string) => { resolve: (id: string) => string };
  createPiToolExtension: () => any;
  artifactPackageJsonByName: (...args: any[]) => any;
  discoverRendererPluginManifest: () => Promise<unknown[]>;
  // Cordis runtime helpers
  promptImpl: (...args: any[]) => any;
  abortImpl: (...args: any[]) => any;
  listSessionsImpl: (...args: any[]) => any;
  listSubagentChildrenImpl: (...args: any[]) => any;
  promptSubagentImpl: (...args: any[]) => any;
  interruptSubagentImpl: (...args: any[]) => any;
  // Subagent continuable
  ensureContinuableSubagent: (...args: any[]) => any;
}

/**
 * Wire every host-module's module-level state via its install() pattern.
 *
 * Order matters:
 *   1. bootstrapSessionEventLog + bootstrapModelRuntime have already run
 *      (they populate `state.modelRuntime` / `state.sessionEventLog`).
 *   2. Then installXxx() for every host-module in dependency order.
 *   3. Finally installProviderRegistryTracker (needs emitPluginEvent).
 */
export function installHostModules(state: AgentHostState, deps: InstallHostModuleDeps): void {
  // harness-cursors: needs state + piHome + isPathWithin
  installHarnessCursors({ state, piHome: deps.piHome, isPathWithin: deps.isPathWithin });
  // hook-permission
  installHookPermission({ state, emitPluginEvent: deps.emitPluginEvent, emitRendererEvent: deps.emitRendererEvent });
  // override-patches (no state dep, just event emitter)
  installOverridePatches({ piHome: deps.piHome, emitPluginEvent: deps.emitPluginEvent });
  // profile-snapshot
  installProfileSnapshot({ state, setProfilePiResourcePaths: deps.setProfilePiResourcePaths });
  // profile-bundles
  installProfileBundles({ piHome: deps.piHome, state });
  // plugin-event-bus
  installPluginEventBus({ state });
  // plugin-state
  installPluginState({ state, profilePackages: deps.profilePackages as never });
  // session-metadata
  installSessionMetadata({
    state,
    piHome: deps.piHome,
    piSessionDir: deps.piSessionDir,
    emitPluginEvent: deps.emitPluginEvent,
    listAllPiSessions: deps.listAllPiSessions,
    workspaceRegistry: deps.workspaceRegistry as never,
    }
  );
  // session-store (needs self-ref for re-init)
  installSessionStore({
    state,
    piSessionDir: deps.piSessionDir,
    emitPluginEvent: deps.emitPluginEvent,
    emitRendererEvent: deps.emitRendererEvent,
    enqueueLifecycle: deps.enqueueLifecycle,
    initialize: deps.initialize,
    rebindSession: deps.rebindSession,
    dispose: deps.dispose,
    lifecycleAppendQueues: deps.lifecycleAppendQueues,
    listAllPiSessions: deps.listAllPiSessions,
    persistedSessionPath: deps.persistedSessionPath,
    piRuntimeCoordinator: deps.piRuntimeCoordinator,
    }
  );
  // subagent-runtime
  installSubagentRuntime({
    state,
    piHome: deps.piHome,
    emitPluginEvent: deps.emitPluginEvent,
    emitRendererEvent: deps.emitRendererEvent,
    ensureContinuableSubagent: deps.ensureContinuableSubagent,
    listAllPiSessions: deps.listAllPiSessions,
    }
  );
  // agent-prompt
  installAgentPrompt({
    state,
    emitPluginEvent: deps.emitPluginEvent,
    emitRendererEvent: deps.emitRendererEvent,
    publicQueueItems: deps.publicQueueItems,
    }
  );
  // team-runner
  installTeamRunner({
    state,
    emitPluginEvent: deps.emitPluginEvent,
    canonicalEventNamespace: deps.canonicalEventNamespace as never,
    createSubagentResourceLoader: deps.createSubagentResourceLoader as never,
    createTaskAwareTool: deps.createTaskAwareTool as never,
    eventNamespace: deps.eventNamespace as never,
    modelFacingPresetTools: deps.modelFacingPresetTools as never,
    persistedSessionPath: deps.persistedSessionPath,
    piHome: deps.piHome,
    piSessionDir: deps.piSessionDir,
    runHookPoint: deps.runHookPoint as never,
    }
  );
  // workbench-scope
  installWorkbenchScope({ state, listAllPiSessions: deps.listAllPiSessions as never });
  // agent-model
  installAgentModel({ state, emitRendererEvent: deps.emitRendererEvent, piHome: deps.piHome, readModelsConfig: deps.readModelsConfig as never });
  // deepseek/agent-runtime (DSH subagent write paths; ensureContinuableSubagent lives here too)
  installDeepSeekAgentRuntime({
    listAllPiSessions: deps.listAllPiSessions,
    persistedSessionPath: deps.persistedSessionPath,
    piHome: deps.piHome,
    piSessionDir: deps.piSessionDir,
    state,
    createSubagentResourceLoader: deps.createSubagentResourceLoader as never,
    modelFacingPresetTools: deps.modelFacingPresetTools as never,
    createTaskAwareTool: deps.createTaskAwareTool as never,
    }
  );
  // plugin-mutations (largest dep set)
  installPluginMutations({
    state,
    emitPluginEvent: deps.emitPluginEvent,
    isPathWithin: deps.isPathWithin,
    profileArtifactModuleUrl: deps.profileArtifactModuleUrl,
    profilePackages: deps.profilePackages,
    pluginLifecycleQueue: deps.pluginLifecycleQueue,
    piRuntimeCoordinator: deps.piRuntimeCoordinator,
    setProfilePiResourcePaths: deps.setProfilePiResourcePaths,
    refreshMarketplacePiResourcePaths: deps.refreshMarketplacePiResourcePaths,
    refreshHookConfigs: deps.refreshHookConfigs,
    syncMarketplacePiExtensionStatuses: deps.syncMarketplacePiExtensionStatuses,
    startProfileWatchers: deps.startProfileWatchers,
    readOverridePatches: deps.readOverridePatches,
    runtimeProfileBundle: deps.runtimeProfileBundle,
    reconcileProfileArtifacts: deps.reconcileProfileArtifacts,
    configurePiExtensions: deps.configurePiExtensions as never,
    reportPiExtensionErrors: deps.reportPiExtensionErrors,
    captureReloadableContextServices: deps.captureReloadableContextServices,
    restoreCapturedContextServices: deps.restoreCapturedContextServices,
    rollbackPiProfile: deps.rollbackPiProfile,
    scheduleProfileReload: deps.scheduleProfileReload,
    artifactPackageJsonByName: deps.artifactPackageJsonByName,
    discoverRendererPluginManifest: deps.discoverRendererPluginManifest,
    }
  );
  // provider-registry tracker: needs emitPluginEvent (host-owned) so lives
  // here, not in bootstrap/model-runtime.ts (which has zero agent-host deps).
  installProviderRegistryTracker(
    state.modelRuntime as never,
    state.providerRegistry,
    ({ kind, record }) => {
      deps.emitPluginEvent("plugin/provider-registry-changed", { kind, record });
    }
  );
  // deepseek/cordis-runtime (needs promptImpl / abortImpl / listSessionsImpl etc.)
  installDeepSeekCordisRuntime({
    state,
    emitPluginEvent: deps.emitPluginEvent,
    prompt: deps.promptImpl as never,
    abort: deps.abortImpl as never,
    listSessions: deps.listSessionsImpl as never,
    listSubagentChildren: deps.listSubagentChildrenImpl as never,
    promptSubagent: deps.promptSubagentImpl as never,
    interruptSubagent: deps.interruptSubagentImpl as never,
    piHome: deps.piHome,
    profileArtifactModuleUrl: deps.profileArtifactModuleUrl,
  });
  // profile-reload-transaction (own install pattern, before plugin-mutations
  // is installed so the scheduleProfileReload / rollbackPiProfile injected
  // below is the freshly-installed module-level function).
  installProfileReloadTransaction({
    state,
    pluginLifecycleQueue: deps.pluginLifecycleQueue as never,
    piRuntimeCoordinator: deps.piRuntimeCoordinator as never,
    emitPluginEvent: deps.emitPluginEvent,
    capturePiProfileSnapshot: deps.capturePiProfileSnapshot as never,
    restorePiProfileSnapshot: deps.restorePiProfileSnapshot as never,
    captureReloadableContextServices: deps.captureReloadableContextServices,
    restoreCapturedContextServices: deps.restoreCapturedContextServices as never,
    captureDeepSeekCapabilityServices: deps.captureDeepSeekCapabilityServices,
    restoreDeepSeekCapabilityServices: deps.restoreDeepSeekCapabilityServices,
    materializeOpenBuddyProfile: deps.materializeOpenBuddyProfile,
    runtimeProfileBundle: deps.runtimeProfileBundle as never,
    createOpenBuddyProfile: deps.createOpenBuddyProfile,
    composePluginPatches: deps.composePluginPatches,
    syncDeepSeekCordisRuntime: deps.syncDeepSeekCordisRuntime,
    deepSeekCoreRuntimeEntries: deps.deepSeekCoreRuntimeEntries,
    reconcileProfileArtifacts: deps.reconcileProfileArtifacts as never,
    refreshHookConfigs: deps.refreshHookConfigs as never,
    reloadMcp: deps.reloadMcp as never,
    reportPiExtensionErrors: deps.reportPiExtensionErrors,
    readOverridePatches: deps.readOverridePatches as never,
    setProfilePiResourcePaths: deps.setProfilePiResourcePaths as never,
    startProfileWatchers: deps.startProfileWatchers as never,
    configurePiExtensions: deps.configurePiExtensions as never,
  });
  // session-rebind (warm-host fast path)
  installSessionRebind({
    state,
    initialize: deps.initialize as never,
    sessionPresetSelection: deps.sessionPresetSelection as never,
    replaceSession: deps.replaceSession as never,
    sessionManagerOpen: deps.sessionManagerOpen as never,
    agentHome: deps.agentHome,
    provideRpcUiContext: deps.provideRpcUiContext as never,
    emitPluginEvent: deps.emitPluginEvent,
    emitRendererEvent: deps.emitRendererEvent,
    questionAnswer: deps.questionAnswer as never,
    createOpenBuddyRpcUiContext: deps.createOpenBuddyRpcUiContext,
  });
  // pi-extension-configure (built-in factories + extension diagnostics)
  installPiExtensionConfigure({
    state,
    emitPluginEvent: deps.emitPluginEvent,
    telemetrySink: deps.telemetrySink,
    resolveProfileDirectory: deps.resolveProfileDirectory,
    requestHookPermission: deps.requestHookPermission,
    createRequire: deps.createRequire,
    createPiToolExtension: deps.createPiToolExtension,
  });
  // agent-preset-runtime (mountConfiguredAgentPreset + selectAgentPreset)
  installAgentPresetRuntime({
    state,
    emitPluginEvent: deps.emitPluginEvent,
    listAgentPresets: deps.listAgentPresets as never,
    readAgentPresetDefaults: deps.readAgentPresetDefaults as never,
    writeAgentPresetDefault: deps.writeAgentPresetDefault as never,
    readAgentPreset: deps.readAgentPreset as never,
    createPresetSessionRuntime: deps.createPresetSessionRuntime as never,
    pluginLifecycleQueue: deps.pluginLifecycleQueue as never,
    sessionHasConversation: deps.sessionHasConversation as never,
    piRuntimeCoordinatorReload: deps.piRuntimeCoordinatorReload,
  });
  // dispose-internal (lifecycle cleanup path)
  installDisposeInternal({
    state,
    emitPluginEvent: deps.emitPluginEvent,
    piSessionRuntimeDispose: deps.piSessionRuntimeDispose as never,
    stopProfileWatchers: deps.stopProfileWatchers as never,
    disposeProfileTypertRegistrations: deps.disposeProfileTypertRegistrations as never,
    disposeActiveHookProcesses: deps.disposeActiveHookProcesses as never,
    drainActiveHookProcesses: deps.drainActiveHookProcesses as never,
  });
  // workbench-scope-sync (syncWorkbenchScope)
  installWorkbenchScopeSync({
    state,
    emitRendererEvent: deps.emitRendererEvent,
    casdoorStatus: deps.casdoorStatus,
  });
  // ui-request-resolver (resolveUiRequest)
  installUiRequestResolver({
    state,
    emitPluginEvent: deps.emitPluginEvent,
    permissionReadRules: deps.permissionReadRules,
    permissionWriteRules: deps.permissionWriteRules,
  });
}
