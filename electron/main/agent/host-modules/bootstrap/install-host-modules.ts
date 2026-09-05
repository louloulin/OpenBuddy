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
  rollbackPiProfile: (...args: any[]) => any;
  scheduleProfileReload: () => void;
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
  // deepseek/agent-runtime
  installDeepSeekAgentRuntime({
    listAllPiSessions: deps.listAllPiSessions,
    persistedSessionPath: deps.persistedSessionPath,
    piHome: deps.piHome,
    piSessionDir: deps.piSessionDir,
    state,
    createSubagentResourceLoader: deps.createSubagentResourceLoader as never,
    modelFacingPresetTools: deps.modelFacingPresetTools as never,
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
}
