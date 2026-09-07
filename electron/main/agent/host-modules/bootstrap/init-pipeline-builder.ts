/**
 * host-modules/bootstrap/init-pipeline-builder.ts
 *
 * v6-G M1 - extract `agent-host.ts:initialize()` 8-stage orchestration deps
 * to a builder. This file builds the InitPipelineDeps object from
 * agent-host.ts's module-level closures, so agent-host.ts:initialize() can
 * shrink to a ~10-line wrapper that calls runInitPipeline.
 *
 * Reverse-dep invariant: this module does NOT import agent-host.ts.
 */
import type { InstallHostModuleDeps } from "./install-host-modules";
import { ensureDefaultPiPackages } from "@openbuddy/plugin-host";
import type { InitPipelineDeps } from "./init-pipeline";

import { bootstrapSessionEventLog } from "./session-event-log";
import { bootstrapModelRuntime } from "./model-runtime";
import { createJobsRegistry } from "./jobs-registry";
import { wireContextServices } from "./wire-context-services";
import { wireDshServices } from "./wire-dsh-services";
import { wireForwardedEvents } from "./wire-forwarded-events";
import { setupProfileOptions } from "./profile-options-setup";
import { initProfile } from "./init-profile";
import { initPluginLoader } from "./init-plugin-loader";
import { initDeepSeek } from "./init-deepseek";
import { computeActiveAdapterIds } from "./compute-active-adapter-ids";
import { injectSystemPromptSections } from "./inject-system-prompt-sections";
import { initSession } from "./init-session";

import {
  prompt as promptImpl,
  steer as steerImpl,
  followUp as followUpImpl,
  abort as abortImpl,
} from "../agent-prompt";
import {
  getModel as getModelImpl,
  setModel as setModelImpl,
} from "../agent-model";
import {
  loadSession as loadSessionImpl,
  listPersistedSessionHeaders as listPersistedSessionHeadersImpl,
  appendPersistedSessionEntries as appendPersistedSessionEntriesImpl,
  appendLifecycleSessionEntry as appendLifecycleSessionEntryImpl,
  persistPiSessionHeader as persistPiSessionHeaderImpl,
} from "../session-store";
import { listSessions as listSessionsImpl } from "../session-metadata";
import { listAllPiSessions as listAllPiSessionsImpl } from "../pi-runtime-factories";
import {
  reserveDeepSeekPreparation as reserveDeepSeekPreparationImpl,
  reserveDeepSeekAgent as reserveDeepSeekAgentImpl,
  createDeepSeekAgent as createDeepSeekAgentImpl,
  resumeDeepSeekAgent as resumeDeepSeekAgentImpl,
} from "../deepseek/agent-runtime";
import { createTeamRunner as createTeamRunnerImpl } from "../team-runner";
import {
  listSubagentChildren as listSubagentChildrenImpl,
  listRunningTasks as listRunningTasksImpl,
  killTask as killTaskImpl,
} from "../subagent-runtime";
import { listCommands as listCommandsImpl } from "../harness-cursors";
import { listPluginInventory as listPluginInventoryImpl } from "../plugin-mutations";
import { syncMarketplacePiExtensionStatuses as syncMarketplacePiExtensionStatusesImpl } from "../profile/marketplace-status";
import {
  nativePiResourcePaths as nativePiResourcePathsImpl,
  refreshMarketplacePiResourcePaths as refreshMarketplacePiResourcePathsImpl,
  setProfilePiResourcePaths as setProfilePiResourcePathsImpl,
} from "../profile/resource-paths";
import {
  createToolRegistry as createToolRegistryImpl,
  createPiRuntime as createPiRuntimeImpl,
  createPiSessionFacade as createPiSessionFacadeImpl,
} from "../pi-runtime-factories";
import { refreshPiExtensions as refreshPiExtensionsImpl } from "../pi-runtime-refresh";
import { startProfileWatchers as startProfileWatchersImpl } from "../profile/watchers";
import { profileResourceWatchPaths as profileResourceWatchPathsImpl } from "../profile/paths";
import { scheduleProfileReload as scheduleProfileReloadImpl } from "../profile-reload-transaction";
import { configurePiExtensions as configurePiExtensionsImpl } from "../pi-extension-configure";
import { captureFileSnapshot as captureFileSnapshotImpl } from "../rewind-snapshot";
import { sessionPresetSelection as sessionPresetSelectionImpl } from "../preset-helpers";
import { publicQueueItems as publicQueueItemsImpl } from "../session-queue-items";
import { questionAnswer as questionAnswerImpl } from "../dsh-bridge-helpers";


import { newSession as newSessionImpl } from "../session-swap";
import { mountConfiguredAgentPreset } from "../agent-preset-runtime";
import { reconcileProfileArtifacts } from "../profile-artifact-reconciler";
import { describeCompatibilityAdapterCommandsMarkdown } from "../../pi-extensions";
import { createOpenBuddyRpcUiContext } from "../../pi-rpc-ui-context";
import { emitPiSessionEvent } from "../../pi-event-bridge";
import { remoteServiceContext, transitionDshGoal, listDshFileReferences } from "../workbench-scope";
import { eventNamespace, canonicalEventNamespace } from "../plugin-event-bus";
import { resolveDeepSeekModule } from "../../../deepseek/deepseek-compat";
import { openBuddyCapabilityPluginIndex } from "@openbuddy/bundle-base";
import * as piResources from "../../pi-resources";

export interface InitPipelineClosures {
  state: AgentHostState;
  cwd: string;
  piHome: () => string;
  isPathWithin: (root: string, candidate: string) => boolean;
  piSessionDir: (cwd: string) => string;
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  piSessionRuntime: unknown;
  installMicrokernelHost: (deps: InstallHostModuleDeps) => void;
  getMicrokernelHostDeps: () => InstallHostModuleDeps;
  openBuddyCorePlugin: unknown;
  baseUrl: string;
  reportPiExtensionErrors: (...args: any[]) => any;
  listPlugins: () => PluginStatus[];
}

import type { AgentHostState } from "../_state-shape";

export interface InitPipelineOpts {
  sessionPath?: string;
}

export function buildInitPipelineDeps(
  closures: InitPipelineClosures,
  opts: InitPipelineOpts = {},
): InitPipelineDeps {
  return {
    state: closures.state,
    cwd: () => closures.cwd,
    piHome: closures.piHome,
    isPathWithin: closures.isPathWithin,
    piSessionDir: closures.piSessionDir,
    emitPluginEvent: closures.emitPluginEvent,
    emitRendererEvent: closures.emitRendererEvent,
    getMicrokernelHostDeps: closures.getMicrokernelHostDeps,
    installMicrokernelHost: closures.installMicrokernelHost,
    bootstrapSessionEventLog,
    bootstrapModelRuntime,
    createToolRegistry: createToolRegistryImpl,
    createPiRuntime: createPiRuntimeImpl,
    createPiSessionFacade: createPiSessionFacadeImpl,
    refreshPiExtensions: refreshPiExtensionsImpl,
    createJobsRegistry,
    wireContextServices,
    wireDshServices,
    wireForwardedEvents,
    setupProfileOptions,
    ensureDefaultPiPackages,
    initProfile,
    initPluginLoader,
    initDeepSeek,
    computeActiveAdapterIds,
    injectSystemPromptSections,
    initSession,
    prompt: promptImpl,
    steer: steerImpl,
    followUp: followUpImpl,
    abort: abortImpl,
    getModel: getModelImpl,
    setModel: setModelImpl,
    newSession: newSessionImpl,
    loadSession: loadSessionImpl,
    listSessions: listSessionsImpl,
    listAllPiSessions: listAllPiSessionsImpl,
    listPersistedSessionHeadersImpl,
    appendPersistedSessionEntriesImpl,
    appendLifecycleSessionEntryImpl,
    reserveDeepSeekPreparation: reserveDeepSeekPreparationImpl,
    reserveDeepSeekAgent: reserveDeepSeekAgentImpl,
    createDeepSeekAgent: createDeepSeekAgentImpl,
    resumeDeepSeekAgent: resumeDeepSeekAgentImpl,
    createTeamRunner: createTeamRunnerImpl,
    openBuddyCorePlugin: closures.openBuddyCorePlugin,
    listSubagentChildren: listSubagentChildrenImpl,
    listCommands: listCommandsImpl,
    listPluginInventory: listPluginInventoryImpl,
    listPlugins: closures.listPlugins,
    listDshFileReferences,
    listRunningTasks: listRunningTasksImpl,
    killTask: killTaskImpl,
    remoteServiceContext,
    transitionDshGoal,
    resolveDeepSeekModule,
    openBuddyCapabilityPluginIndex,
    baseUrl: closures.baseUrl,
    describeCompatibilityAdapterCommandsMarkdown,
    emitPiSessionEvent,
    captureFileSnapshot: captureFileSnapshotImpl,
    sessionPresetSelection: sessionPresetSelectionImpl,
    mountConfiguredAgentPreset,
    startProfileWatchers: () => startProfileWatchersImpl(closures.state, scheduleProfileReloadImpl, () => profileResourceWatchPathsImpl(closures.state.profileOptions, closures.state.profilePackagePaths, closures.piHome)),
    refreshMarketplacePiResourcePaths: refreshMarketplacePiResourcePathsImpl,
    configurePiExtensions: configurePiExtensionsImpl,
    reportPiExtensionErrors: closures.reportPiExtensionErrors,
    syncMarketplacePiExtensionStatuses: () => syncMarketplacePiExtensionStatusesImpl(closures.state),
    nativePiResourcePaths: nativePiResourcePathsImpl,
    persistPiSessionHeaderImpl,
    piSessionRuntime: closures.piSessionRuntime,
    publicQueueItems: publicQueueItemsImpl,
    eventNamespace,
    canonicalEventNamespace,
    createOpenBuddyRpcUiContext,
    questionAnswer: questionAnswerImpl,
    piResources,
    refreshPiExtensionsFn: refreshPiExtensionsImpl,
    sessionPath: opts.sessionPath,
    setProfilePiResourcePaths: setProfilePiResourcePathsImpl,
    reconcileProfileArtifacts,
    emitPluginReadyEvent: (payload) => closures.emitPluginEvent("plugin/ready", payload),
  } as InitPipelineDeps;
}
