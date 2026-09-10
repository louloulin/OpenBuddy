/**
 * host-modules/bootstrap/install-host-modules-deps.ts
 *
 * v6-G M1 - builder for the InstallHostModuleDeps object (the ~60-field deps
 * bag that installMicrokernelHost() forwards to installHostModules()).
 *
 * Reverse-dep invariant: this module does NOT import agent-host.ts. The
 * caller passes in the closures from agent-host.ts's module scope.
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { PresetSessionRuntime } from "../../preset-session-runtime";
import { casdoorAuth } from "../../../casdoor/casdoor-auth";
import { permissionHandlers } from "@openbuddy/auth-permission";
import * as piResources from "../../pi-resources";
import type { PiSessionRuntime } from "../../pi-session-runtime";
import type { PiRuntimeCoordinator } from "../../pi-runtime-coordinator";
import type { AgentHostState } from "../_state-shape";
import type { InstallHostModuleDeps, InstallHostModuleDepsWithDomains } from "./install-host-modules";

export interface InstallHostModuleDepsClosures {
  /** Shared composition-root state; every domain must observe this exact object. */
  state: AgentHostState;
  // Path helpers
  piHome: () => string;
  isPathWithin: (root: string, candidate: string) => boolean;
  piSessionDir: (cwd: string) => string;
  /** profile-artifact-resolution.toModuleUrl — wraps a file path as a file:// URL. */
  toModuleUrl: (path: string) => string;
  // Event emitters
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  // Lifecycle
  listAllPiSessions: () => Promise<unknown>;
  persistedSessionPath: (sessionId: string | undefined) => Promise<string | undefined>;
  enqueueLifecycle: <T>(operation: () => Promise<T>) => Promise<T>;
  lifecycleAppendQueues: Map<string, Promise<void>>;
  initialize: (opts?: { cwd?: string; sessionPath?: string; force?: boolean }) => Promise<void>;
  rebindSession: (sessionPath: string, cwd: string) => Promise<void>;
  dispose: () => Promise<void>;
  piRuntimeCoordinator: PiRuntimeCoordinator;
  piSessionRuntime: PiSessionRuntime;
  // Public API helpers
  publicQueueItems: (activeSession: any) => readonly unknown[];
  workspaceRegistry: () => any;
  readModelsConfig: () => Promise<unknown>;
  canonicalEventNamespace: (type: string) => string | undefined;
  eventNamespace: (type: string) => string;
  // Subagent + hook + tools
  createSubagentResourceLoader: (cwd: string) => Promise<unknown>;
  createTaskAwareTool: (...args: any[]) => any;
  modelFacingPresetTools: () => any[];
  runHookPoint: (...args: any[]) => any;
  // Profile artifacts + plugins
  profileArtifactModuleUrl: (path: string) => string;
  profilePackages: () => Promise<unknown>;
  pluginLifecycleQueue: any;
  setProfilePiResourcePaths: (paths: any) => void;
  refreshMarketplacePiResourcePaths: () => Promise<void>;
  sessionPresetSelection: (sessionPath?: string | null) => Promise<string | null | undefined>;
  // Pi runtime + UI
  provideRpcUiContext: (...args: any[]) => any;
  questionAnswer: (value: any, questionKey?: string) => string | undefined;
  createOpenBuddyRpcUiContext: (...args: any[]) => any;
  requestHookPermission: (...args: any[]) => any;
  createPiToolExtension: (...args: any[]) => any;
  sessionHasConversation: (...args: any[]) => any;
  // Auth + permissions
  permissionHandlers: any;
  // Profile snapshot
  capturePiProfileSnapshot: (...args: any[]) => any;
  restorePiProfileSnapshot: (...args: any[]) => any;
  // DeepSeek capability services
  captureDeepSeekCapabilityServices: (...args: any[]) => any;
  restoreDeepSeekCapabilityServices: (...args: any[]) => any;
  materializeOpenBuddyProfile: (...args: any[]) => any;
  createOpenBuddyProfile: (...args: any[]) => any;
  composePluginPatches: (...args: any[]) => any;
  syncDeepSeekCordisRuntime: (...args: any[]) => any;
  deepSeekCoreRuntimeEntries: (...args: any[]) => any;
  reloadMcp: () => Promise<void>;
  syncMarketplacePiExtensionStatusesImpl: (...args: any[]) => any;
  startProfileWatchers: () => Promise<void>;
  readOverridePatches: (...args: any[]) => any;
  runtimeProfileBundle: any;
  reconcileProfileArtifacts: (...args: any[]) => any;
  configurePiExtensionsImpl: (...args: any[]) => any;
  reportPiExtensionErrors: (...args: any[]) => any;
  captureReloadableContextServices: () => Map<string, unknown>;
  restoreCapturedContextServices: (captured: Map<string, unknown>) => void;
  rollbackPiProfile: (...args: any[]) => any;
  scheduleProfileReload: (...args: any[]) => any;
  artifactPackageJsonByName: (...args: any[]) => any;
  discoverRendererPluginManifest: (...args: any[]) => any;
  // Host-functions required by installPiRuntimeFactories
  promptImpl: (...args: any[]) => any;
  abortImpl: (...args: any[]) => any;
  listSessionsImpl: (cwd: string) => Promise<any>;
  listSubagentChildrenImpl: (parentSessionId: string) => Promise<any>;
  promptSubagentImpl: (...args: any[]) => any;
  interruptSubagentImpl: (...args: any[]) => any;
  ensureContinuableSubagentImpl: (...args: any[]) => any;
  // session-swap
  setModel: (...args: any[]) => any;
  getSession: () => any;
  getModel: () => any;
  prompt: (...args: any[]) => any;
  abort: (...args: any[]) => any;
  setThinkingLevel: (...args: any[]) => any;
  promptContent: (...args: any[]) => any;
  onEvent: (handler: any) => any;
  persistPiSessionHeaderImpl: (...args: any[]) => any;
  // dispose-internal
  stopProfileWatchers: () => void;
  disposeProfileTypertRegistrations: (...args: any[]) => any;
  disposeActiveHookProcesses: (...args: any[]) => any;
  drainActiveHookProcesses: (...args: any[]) => any;
}

export function buildInstallHostModuleDeps(
  closures: InstallHostModuleDepsClosures,
): InstallHostModuleDepsWithDomains {
  const flatDeps: InstallHostModuleDeps = {
    state: closures.state,
    piHome: closures.piHome,
    isPathWithin: closures.isPathWithin,
    piSessionDir: closures.piSessionDir,
    toModuleUrl: closures.toModuleUrl,
    emitPluginEvent: closures.emitPluginEvent,
    emitRendererEvent: closures.emitRendererEvent,
    listAllPiSessions: closures.listAllPiSessions,
    persistedSessionPath: closures.persistedSessionPath,
    enqueueLifecycle: closures.enqueueLifecycle,
    lifecycleAppendQueues: closures.lifecycleAppendQueues,
    initialize: closures.initialize,
    rebindSession: closures.rebindSession,
    dispose: closures.dispose,
    piRuntimeCoordinator: closures.piRuntimeCoordinator,
    publicQueueItems: closures.publicQueueItems as any,
    workspaceRegistry: closures.workspaceRegistry,
    readModelsConfig: closures.readModelsConfig,
    canonicalEventNamespace: closures.canonicalEventNamespace,
    eventNamespace: closures.eventNamespace,
    createSubagentResourceLoader: closures.createSubagentResourceLoader,
    createTaskAwareTool: closures.createTaskAwareTool,
    modelFacingPresetTools: closures.modelFacingPresetTools,
    runHookPoint: closures.runHookPoint,
    profileArtifactModuleUrl: closures.profileArtifactModuleUrl,
    profilePackages: closures.profilePackages,
    pluginLifecycleQueue: closures.pluginLifecycleQueue,
    setProfilePiResourcePaths: closures.setProfilePiResourcePaths,
    refreshMarketplacePiResourcePaths: closures.refreshMarketplacePiResourcePaths,
    sessionPresetSelection: closures.sessionPresetSelection,
    replaceSession: ((opts: any) => closures.piSessionRuntime.replace(opts)) as any,
    sessionManagerOpen: ((sessionPath: string, options: any, cwd: string) =>
      SessionManager.open(sessionPath, options, cwd)) as any,
    provideRpcUiContext: closures.provideRpcUiContext,
    questionAnswer: closures.questionAnswer,
    createOpenBuddyRpcUiContext: closures.createOpenBuddyRpcUiContext,
    requestHookPermission: closures.requestHookPermission,
    createPiToolExtension: closures.createPiToolExtension,
    listAgentPresets: ((cwd: string) => piResources.listAgentPresets(cwd)) as any,
    readAgentPresetDefaults: (() => piResources.readAgentPresetDefaults()) as any,
    writeAgentPresetDefault: ((id?: string) => piResources.writeAgentPresetDefault(id)) as any,
    readAgentPreset: ((id: string, cwd: string) => piResources.readAgentPreset(id, cwd)) as any,
    createPresetSessionRuntime: ((opts: any) => new PresetSessionRuntime(opts)) as any,
    sessionHasConversation: closures.sessionHasConversation as any,
    piRuntimeCoordinatorReload: ((reason: string) => closures.piRuntimeCoordinator.reload(reason)),
    piSessionRuntimeDispose: () => closures.piSessionRuntime.dispose(),
    stopProfileWatchers: closures.stopProfileWatchers,
    disposeProfileTypertRegistrations: closures.disposeProfileTypertRegistrations as any,
    disposeActiveHookProcesses: closures.disposeActiveHookProcesses,
    drainActiveHookProcesses: closures.drainActiveHookProcesses,
    casdoorStatus: () => casdoorAuth.status(),
    permissionReadRules: () => closures.permissionHandlers.readRules(),
    permissionWriteRules: (rules: any) => closures.permissionHandlers.writeRules(rules),
    capturePiProfileSnapshot: closures.capturePiProfileSnapshot as any,
    restorePiProfileSnapshot: closures.restorePiProfileSnapshot as any,
    captureDeepSeekCapabilityServices: closures.captureDeepSeekCapabilityServices,
    restoreDeepSeekCapabilityServices: closures.restoreDeepSeekCapabilityServices,
    materializeOpenBuddyProfile: closures.materializeOpenBuddyProfile,
    createOpenBuddyProfile: closures.createOpenBuddyProfile as any,
    composePluginPatches: closures.composePluginPatches,
    syncDeepSeekCordisRuntime: closures.syncDeepSeekCordisRuntime,
    deepSeekCoreRuntimeEntries: closures.deepSeekCoreRuntimeEntries,
    reloadMcp: closures.reloadMcp,
    syncMarketplacePiExtensionStatuses: closures.syncMarketplacePiExtensionStatusesImpl as any,
    startProfileWatchers: closures.startProfileWatchers,
    readOverridePatches: closures.readOverridePatches,
    runtimeProfileBundle: closures.runtimeProfileBundle as any,
    reconcileProfileArtifacts: closures.reconcileProfileArtifacts,
    configurePiExtensions: closures.configurePiExtensionsImpl as any,
    reportPiExtensionErrors: closures.reportPiExtensionErrors,
    captureReloadableContextServices: closures.captureReloadableContextServices,
    restoreCapturedContextServices: closures.restoreCapturedContextServices,
    rollbackPiProfile: closures.rollbackPiProfile as any,
    scheduleProfileReload: closures.scheduleProfileReload,
    artifactPackageJsonByName: closures.artifactPackageJsonByName,
    discoverRendererPluginManifest: closures.discoverRendererPluginManifest,
    promptImpl: closures.promptImpl,
    abortImpl: closures.abortImpl,
    listSessionsImpl: closures.listSessionsImpl,
    listSubagentChildrenImpl: closures.listSubagentChildrenImpl,
    promptSubagentImpl: closures.promptSubagentImpl,
    interruptSubagentImpl: closures.interruptSubagentImpl,
    ensureContinuableSubagent: closures.ensureContinuableSubagentImpl,
    setModel: closures.setModel,
    getSession: closures.getSession,
    getModel: closures.getModel,
    prompt: closures.prompt,
    abort: closures.abort,
    setThinkingLevel: closures.setThinkingLevel,
    promptContent: closures.promptContent,
    onEvent: closures.onEvent,
    persistPiSessionHeaderImpl: closures.persistPiSessionHeaderImpl,
  };
  return {
    profile: flatDeps,
    session: flatDeps,
    plugin: flatDeps,
    runtime: flatDeps,
  } as InstallHostModuleDepsWithDomains;
}
