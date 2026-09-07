import { app, shell } from "electron";
import { readFile, writeFile, mkdir, rename, rm, unlink, readdir, stat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { casdoorAuth } from "../casdoor/casdoor-auth";
import { randomUUID } from "node:crypto";
import { resolve, join, dirname, basename } from "node:path";
// Path/path-security helpers (piHome / isPathWithin / piSessionDir) are owned
// by host-modules/_host-paths.ts. Imported here for local use (passed into
// installHostModules) and re-exported so existing callers and feature modules
// keep one canonical implementation (no duplicate drift).
import { piHome, isPathWithin, piSessionDir } from "./host-modules/_host-paths";
export { piHome, isPathWithin, piSessionDir };
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  ModelRuntime,
  ModelRegistry,
  collectEntriesForBranchSummary,
  prepareBranchEntries,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { createPiPlanModeExtension } from "./pi-plan-mode";
import { formatBranchSummaryText as formatBranchSummaryTextExport } from "./branch-summary-format";
import { Context } from "@openbuddy/cordis";
import { HarnessCursorStore } from "@openbuddy/storage";
import {
  HarnessPluginLoader,
  composePluginPatches,
  manifestToBundle,
  parseCordisPatch,
  patchRowsToOpenBuddy,
  readBundleManifest,
  type PluginStatus,
  type PluginBundle,
  type PluginEntryOptions,
  createPluginStateStore,
  type PluginStateStore,
  type PluginCommitMarker,
  type PluginPatch,
  type PluginProfile,
  discoverRemoteManifestEntries,
  discoverTypertManifestEntries,
  validateTypertHostContribution,
  composeRendererPluginBootGraph,
  type RendererPluginBootGraph,
  type RendererPluginManifestEntry,
  defaultOpenBuddyProfileHome,
  ensureOpenBuddyProfile,
  readOpenBuddyProfile,
  materializeOpenBuddyProfile,
  listProfilePackages,
  installProfilePackage,
  ensureDefaultPiPackages,
  removeProfilePackage,
  type DefaultPiPackageResult,
  type ProfilePackageInfo,
  type OpenBuddyProfileOptions,
  type OpenBuddyPiExtensionSpec,
  type TypertHostContribution,
  type PluginReadinessPhase,
  type PluginReadinessSnapshot,
  createPluginReadinessSnapshot,
  createPluginSnapshot,
  type PluginSnapshot,
  updateUnifiedPluginManifest,
  type UnifiedPluginSurfaceKind,
} from "@openbuddy/plugin-host";
import {
  createOpenBuddyProfile,
  openBuddyCapabilityPluginIndex,
} from "@openbuddy/bundle-base";
import * as openBuddyCorePlugin from "./openbuddy-core-plugin";
import { getActiveHarnessServer } from "../harness/harness-server";
import { writePromptHistory } from "./pi-resources";
import * as piResources from "./pi-resources";
import { discoveredPiPackagePaths } from "./pi-extension-discovery";
import { createMainTelemetrySink, type OpenBuddyTelemetrySink } from "./pi-telemetry-bridge";
import { createStdoutSpanExporter } from "./pi-telemetry-span-tree";
import type { TeamMemberInput, TeamRunner } from "@openbuddy/team-team";
import { createTaskAwareTool, harnessToolErrorResult, harnessToolFailureResult, normalizeHarnessPostResult } from "../task-aware-tool";
import {
  type ProviderRegistryRecord,
  type ProviderRegistrySource,
} from "./agent-host-provider-registry";
import type { ProviderInventoryEntry } from "./agent-host-provider-registry";


import { createPiHooksExtension, DefaultHookShellRunner, discoverHookConfigs, disposeActiveHookProcesses, drainActiveHookProcesses, hookConfigDiagnostics, hookConfigSummary, runHookPoint, type HookRuntimeConfig, type HookShellRunner } from "./agent-hooks";
import { authorizeMcpServer } from "../mcp-authorization";
import { projectMcpCapabilityGovernance } from "../mcp-capability-governance";
import { emitContextEvent, emitPiSessionEvent } from "./pi-event-bridge";
import { bindCapabilityEventBridge } from "../capability-event-bridge";
import { getDeepSeekRemoteMethods, resolveDeepSeekModule } from "../deepseek/deepseek-compat";
import { DeepSeekTypertService, deepSeekSessionQueryRemote, type DeepSeekPiAgentRuntime, type DeepSeekPiToolHooks, type DeepSeekToolDecision, type DeepSeekToolExecution } from "../deepseek/deepseek-runtime";
import { DeepSeekCordisRuntime, type DeepSeekCordisInvocation, type DeepSeekCordisPluginEntry, type DeepSeekCordisRuntimeSnapshot } from "@openbuddy/plugin-host";
import { deepSeekCapabilityPackageForService, deepSeekCapabilityRemote } from "../deepseek/deepseek-capabilities";
import {
  ensureContinuableSubagent as ensureContinuableSubagentImpl,
  type ContinuableSubagentRecord,
} from "./host-modules/deepseek/agent-runtime";
import { SessionEventLog, type SessionEventRecord } from "../session/session-event-log";
import { RemoteDispatcher, type RemoteContribution, type RemoteDescriptor } from "../harness/remote-dispatch";
import { invokeRemoteWithGateway } from "../harness/remote-invocation";
import { serializeRemoteContribution } from "@openbuddy/plugin-host";
import {
  normalizePublishedRemoteContribution as normalizePublishedRemoteContributionPure,
  disposeProfileTypertRegistrations,
  type ProfileTypertRegistration,
} from "./host-modules/profile/contributions-pure";
import {
  discoverRendererPluginManifest as discoverRendererPluginManifestImpl,
  discoverRendererPluginManifestUncached as discoverRendererPluginManifestUncachedImpl,
} from "./host-modules/profile/renderer-manifest";
import {
  startProfileWatchers as startProfileWatchersImpl,
  stopProfileWatchers as stopProfileWatchersImpl,
} from "./host-modules/profile/watchers";
import { syncMarketplacePiExtensionStatuses as syncMarketplacePiExtensionStatusesImpl } from "./host-modules/profile/marketplace-status";
import { createDshHostRunner } from "../deepseek/dsh-host-runner";
import {
  applyPiExtensionOverrides,
  builtinPiExtensionFactories,
  describeCompatibilityAdapterCommandsMarkdown,
  mergePiExtensionStatuses,
  piExtensionsResolvedPayload,
  resolvePiExtensions,
  type PiExtensionResolutionOptions,
  type PiExtensionStatus,
} from "./pi-extensions";
import { createProfileArtifactResolvers, discoverProfilePackageJsons, toModuleUrl } from "./profile-artifact-resolution";
import { createOpenBuddyRpcUiContext } from "./pi-rpc-ui-context";
import { permissionHandlers, resolvePermissionAction, type PermissionRule } from "@openbuddy/auth-permission";
import type { HookPermissionDecision, HookPermissionRequest } from "./agent-hooks";
import type { DeepSeekWorkspace, DeepSeekWorkspaceId } from "../deepseek/deepseek-runtime";
import { WorkspaceOrderInvalidError } from "../deepseek/deepseek-runtime";
import { markPluginTransactionRolledBack, PluginLifecycleQueue, type PluginTransactionContext } from "./plugin-lifecycle";
import { PiRuntimeCoordinator } from "./pi-runtime-coordinator";
import { PiSessionRuntime } from "./pi-session-runtime";
import { SessionAttachmentStore, type StoredSessionAttachment } from "../session/session-attachments";
import { createDeepSeekPiBridge, createDeepSeekPiLlmInterceptor, createDeepSeekPiToolInterceptor, DEEPSEEK_PI_BRIDGE_PROTOCOL, DEEPSEEK_PI_CAPABILITIES, type DeepSeekPiBridgeRuntime } from "../deepseek/deepseek-pi-bridge";
import { createDeepSeekPiCapabilityRuntime } from "../deepseek/deepseek-pi-capabilities";
import { PresetSessionRuntime } from "./preset-session-runtime";
import { resolveAgentPresetSelection, sessionHasConversation } from "./agent-preset-selection";
import { createTerminalService, type TerminalRuntime } from "../deepseek/terminal-runtime";
import { SandboxPolicyService, SandboxRuntime, SubprocessRuntime } from "../deepseek/subprocess-runtime";
import { createDeepSeekExecutionAdapter, createDeepSeekExecutionServices, provideDeepSeekExecutionServices, DEEPSEEK_EXECUTION_PACKAGES } from "../deepseek/deepseek-execution-adapters";
import { lifecycleEntry, lifecycleEvent, lifecycleRevisionFromEntries, OPENBUDDY_LIFECYCLE_CUSTOM_TYPE, type OpenBuddyLifecycleEvent } from "@openbuddy/core-session/lifecycle";
import { generateTraceId } from "@openbuddy/logging-shared";
import { hostReceived as hostReceivedLog, hostDispatched as hostDispatchedLog, hostFailed as hostFailedLog } from "./agent-host-log";
import type { OpenBuddyThinkingLevel } from "../ipc/validation";
import type {
  AgentHostState,
  AgentHostPendingUiRequest as PendingUiRequest,
  AgentHostEventHandler as EventHandler,
  AgentHostPluginEventHandler as PluginEventHandler,
  AgentHostUiRequestValue as UiRequestValue,
  AgentHostQuestionResponse as QuestionResponse,
  HostJobRecord,
  PiToolRegistry,
} from "./host-modules/_state-shape";


type PromptResult = { itemId?: string };




export interface WorkspaceProjection {
  workspaceId: string;
  cwd: string;
  path: string;
  title: string;
  sessionCount: number;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
  lastTitle?: string;
  archivedSessionIds: string[];
}

interface PiSessionFacade {
  readonly sessionId: string | undefined;
  readonly model: Model<any> | undefined;
  readonly thinkingLevel: OpenBuddyThinkingLevel | undefined;
  getSession: () => AgentSession | null;
  subscribe: (handler: EventHandler) => () => void;
  prompt: (text: string) => Promise<void>;
  promptContent: (content: readonly PiPromptContentPart[], mode?: "queue" | "steer") => Promise<{ itemId?: string }>;
  abort: () => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setThinkingLevel: (level: OpenBuddyThinkingLevel) => Promise<OpenBuddyThinkingLevel>;
}

export type PiPromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string; name?: string };

export interface PiAgentRuntime {
	readonly tools: PiToolRegistry;
	getSession(): AgentSession | null;
	getModel(): Model<any> | undefined;
	prompt(text: string): Promise<void>;
	abort(): Promise<void>;
	setModel(modelId: string): Promise<void>;
	onEvent(handler: EventHandler): () => void;
}

export type { AgentHostState } from "./host-modules/_state-shape";
import {
  abortBash as abortBashImpl,
  abortRetry as abortRetryImpl,
  compactSession as compactSessionImpl,
  forkSession as forkSessionImpl,
  getAvailableThinkingLevels as getAvailableThinkingLevelsImpl,
  getCompactionSettings as getCompactionSettingsImpl,
  getSessionStats as getSessionStatsImpl,
  getSessionTree as getSessionTreeImpl,
  setAutoCompactionEnabled as setAutoCompactionEnabledImpl,
  setAutoRetryEnabled as setAutoRetryEnabledImpl,
  setFollowUpMode as setFollowUpModeImpl,
  setSteeringMode as setSteeringModeImpl,
} from "./host-modules/pi-session-capabilities";
import { createDefaultAgentHostState } from "./host-modules/_default-state";



function questionAnswer(value: UiRequestValue, questionKey?: string): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || !("answers" in value)) return undefined;
  const answer = (questionKey ? value.answers[questionKey] : undefined) ?? Object.values(value.answers)[0];
  if (Array.isArray(answer)) return answer[0];
  const note = (questionKey ? value.annotations?.[questionKey]?.notes : undefined)
    ?? Object.values(value.annotations).map((entry) => entry.notes).find((entry): entry is string => Boolean(entry));
  return note || answer;
}

export const state: AgentHostState = {
  ...createDefaultAgentHostState(),
  // Phase 5 — see `_state-shape.ts:extensionsBound`. Initialized to null
  // because no bind is in flight at module load; `rebindSession` / `initialize`
  // set it to the live Promise returned by `bindExtensions`.
  extensionsBound: null,
  toolRegistry: createToolRegistry(),
  remoteDispatcher: new RemoteDispatcher((context) => {
    const props = (context as unknown as { reflect?: { props?: Record<string, { type?: string }> } }).reflect?.props ?? {};
    const discovered: Array<{ package: string; descriptors: RemoteDescriptor[] }> = [];
    for (const [serviceKey, definition] of Object.entries(props)) {
      if (definition.type !== "service") continue;
      const service = context.get?.(serviceKey) as (Record<string, unknown> & { typertRemote?: { namespace?: string; serviceKey?: string } }) | undefined;
      const namespace = service?.typertRemote?.namespace;
      if (!service || typeof namespace !== "string") continue;
      const descriptors = getDeepSeekRemoteMethods(service).map((marker) => ({
        namespace,
        method: marker.exportName ?? marker.method,
        implementation: marker.method,
        service: serviceKey,
        invocation: marker.invocation,
      }));
      if (descriptors.length) discovered.push({ package: deepSeekCapabilityPackageForService(serviceKey) ?? `@openbuddy/discovered/${serviceKey}`, descriptors });
    }
    return discovered;
  }),
  attachmentStore: new SessionAttachmentStore(join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent"), "openbuddy-attachments")),
};

export const lifecycleAppendQueues = new Map<string, Promise<void>>();

const piSessionRuntime = new PiSessionRuntime();

const piRuntimeCoordinator = new PiRuntimeCoordinator({
  getSession: () => piSessionRuntime.session,
  getResourceLoader: () => state.piResourceLoader,
});

export function publicQueueItems(activeSession: AgentSession | null): readonly unknown[] {
  if (!activeSession) return [];
  const items: Array<{
    itemId: string;
    mode: "queue" | "steer";
    content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data?: string; name?: string }>;
  }> = [];
  for (const text of activeSession.getSteeringMessages()) {
    items.push({ itemId: `steer:${text}`, mode: "steer", content: [{ type: "text", text }] });
  }
  for (const text of activeSession.getFollowUpMessages()) {
    items.push({ itemId: `queue:${text}`, mode: "queue", content: [{ type: "text", text }] });
  }
  return items;
}

// ----------------------------------------------------------------------------
// Stage F-1: pure pagination helper moved to host-modules/pagination.ts and
// re-exported here so the IPC facade (`ipc/index.ts`) keeps importing from
// this file unchanged.
import { paginateHistoryEntries as paginateHistoryEntriesImpl } from "./host-modules/pagination";
export const paginateHistoryEntries = paginateHistoryEntriesImpl;

// ----------------------------------------------------------------------------
// Stage F-1: enqueueLifecycle + initialisationPromise are implemented in
// host-modules/lifecycle.ts. We re-import them here so the rest of this file
// can keep calling `enqueueLifecycle(...)` / `initialisationPromise` as if
// they were defined inline. The bridge file (host-modules/state-bridge.ts)
// re-exports `state` for downstream host-modules submodules.
import {
  enqueueLifecycle as enqueueLifecycleImpl,
  getInitialisationPromise,
  setInitialisationPromise,
} from "./host-modules/lifecycle";
const enqueueLifecycle = enqueueLifecycleImpl;
let initialisationPromise: Promise<void> | null = null;
void getInitialisationPromise;
void setInitialisationPromise;

// ----------------------------------------------------------------------------
// Stage F-2: profile snapshot capture/restore lives in
// host-modules/profile/snapshot.ts. Re-exported here so existing callers
// in this file keep working through the original binding. At Stage F-5
// the facade switches all callers to import from
// "./host-modules/profile/snapshot" directly.
import {
  capturePiProfileSnapshot as capturePiProfileSnapshotImpl,
  restorePiProfileSnapshot as restorePiProfileSnapshotImpl,
  type PiProfileSnapshot,
} from "./host-modules/profile/snapshot";
const capturePiProfileSnapshot = capturePiProfileSnapshotImpl;
const restorePiProfileSnapshot = restorePiProfileSnapshotImpl;
export type { PiProfileSnapshot };

// ----------------------------------------------------------------------------
// Batch A — provider/model persistence domain lives in host-modules/models-config.
// We bind the impls here so the facade + installHostModules deps keep importing
// from this file unchanged. installModelConfig wires `state`/`piHome` at module
// load (see the install call next to the re-export below).
import {
  installModelConfig,
  readModelsConfig as readModelsConfigImpl,
  saveProvider as saveProviderImpl,
  saveModel as saveModelImpl,
  deleteModel as deleteModelImpl,
  deleteProvider as deleteProviderImpl,
} from "./host-modules/models-config";

function invokeRemote(request: unknown): Promise<unknown> {
  return invokeRemoteImpl({
    context: state.context as { get?: (key: string) => unknown } | null,
    remoteDispatcher: state.remoteDispatcher as unknown as Parameters<typeof invokeRemoteImpl>[0]["remoteDispatcher"],
    remoteServiceContext,
    request,
  });
}

function deepSeekCordisSnapshot(): DeepSeekCordisRuntimeSnapshot | null {
  return deepSeekCordisSnapshotImpl(state.deepSeekCordisSnapshot);
}

function deepSeekPiBridgeDescription(): {
  protocol: typeof DEEPSEEK_PI_BRIDGE_PROTOCOL;
  runtime: "pi";
  capabilities: typeof DEEPSEEK_PI_CAPABILITIES;
} {
  return deepSeekPiBridgeDescriptionImpl(DEEPSEEK_PI_BRIDGE_PROTOCOL, DEEPSEEK_PI_CAPABILITIES);
}

async function invokeDeepSeekCordis(invocation: DeepSeekCordisInvocation): Promise<unknown> {
  return invokeDeepSeekCordisImpl(state.deepSeekCordisRuntime, invocation);
}

// ----------------------------------------------------------------------------
// Stage F-2 (extended): deepseek bridge helpers (invokeRemote, snapshot,
// description, invokeDeepSeekCordis) live in
// host-modules/deepseek/bridge.ts. Thin wrappers above keep the original
// 0-argument call sites in this file working without forcing every
// reader to pass the dispatcher / runtime explicitly.
import {
  invokeRemote as invokeRemoteImpl,
  deepSeekCordisSnapshot as deepSeekCordisSnapshotImpl,
  deepSeekPiBridgeDescription as deepSeekPiBridgeDescriptionImpl,
  invokeDeepSeekCordis as invokeDeepSeekCordisImpl,
} from "./host-modules/deepseek/bridge";

// Phase 8.3 Batch A: harness cursor store + listCommands + listSkills +
// resourceInventory live in host-modules/harness-cursors.ts. Thin wrappers
// below keep the original 0-argument call sites working; emitRendererEvent
// grep target (event-channel-matrix.test.ts) still hits this file.
import {
  harnessCursorPath as harnessCursorPathImpl,
  getHarnessCursorStore as getHarnessCursorStoreImpl,
  harnessResumeTokenPath as harnessResumeTokenPathImpl,
  getHarnessResumeToken as getHarnessResumeTokenImpl,
  setHarnessResumeToken as setHarnessResumeTokenImpl,
  readHarnessSessionCursors as readHarnessSessionCursorsImpl,
  writeHarnessSessionCursors as writeHarnessSessionCursorsImpl,
  getHarnessSessionCursors as getHarnessSessionCursorsImpl,
  setHarnessSessionCursors as setHarnessSessionCursorsImpl,
  listCommands as listCommandsImpl,
  listSkills as listSkillsImpl,
  resourceInventory as resourceInventoryImpl,
} from "./host-modules/harness-cursors";

// Phase 8.3 Batch A: MCP runtime (reload / authorization / status /
// capability governance) lives in host-modules/mcp-runtime.ts. Thin
// wrappers below keep the 0-argument call sites unchanged.
import {
  reloadMcp as reloadMcpImpl,
  runMcpAuthorization as runMcpAuthorizationImpl,
  authorizeMcp as authorizeMcpImpl,
  cancelMcpAuthorization as cancelMcpAuthorizationImpl,
  mcpStatus as mcpStatusImpl,
  mcpCapabilityGovernance as mcpCapabilityGovernanceImpl,
} from "./host-modules/mcp-runtime";

// Phase 8.3 Batch A 收尾: DeepSeek Cordis runtime + bundle normalizers live
// in host-modules/deepseek/cordis-runtime.ts. Named imports preserve the
// function identifiers so internal call sites (syncDeepSeekCordisRuntime at
// the end of profile reload, etc.) keep working without rewrites.
import {
  createDeepSeekPiToolPlugin,
  syncDeepSeekCordisRuntime,
  deepSeekCoreRuntimeEntries,
  filterPublishedCoreBundle,
  allowDeepSeekCordisInvocation,
  isDeepSeekCorePackage,
  currentSessionProjection,
} from "./host-modules/deepseek/cordis-runtime";

// Phase 8.3 Batch K: default DeepSeek host-runner entries extracted to
// host-modules/deepseek/host-runner-entries.ts. The 40-entry default
// bundle used to live inline in initialize(); moving it out makes the
// bootstrap pipeline easier to read and lets tests assert the entry
// ordering without instantiating a full Context.
import { composeHostRunnerEntries } from "./host-modules/deepseek/host-runner-entries";

// Phase 8.3 Batch A 收尾: capability services capture/restore + typert +
// remote dispatcher + DSH goal/fileref + workspace registry + tenant
// binding live in host-modules/workbench-scope.ts. Named imports preserve
// the function identifiers so internal call sites keep working.
// syncWorkbenchScope stays in this file because its body emits the
// `openbuddy://workbench-scope` event via emitRendererEvent, and
// event-channel-matrix.test.ts:103 only scans agent-host.ts +
// capability-event-bridge.ts for that literal — moving the function would
// break the matrix check.
import {
  captureDeepSeekCapabilityServices,
  restoreDeepSeekCapabilityServices,
  remoteServiceContext,
  ensureTypertReady,
  restoreRemoteService,
  transitionDshGoal,
  listDshFileReferences,
  listPiWorkspaces,
  workspaceRegistry,
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  insertWorkspaceSessionBefore,
  archiveWorkspaceSession,
  bindCurrentSessionToTenant,
} from "./host-modules/workbench-scope";

// Phase 8.3 Batch B: prompt dispatch + session I/O surface (getSession /
// onEvent / onPluginEvent / prompt / promptContent / updateSessionQueue /
// readSessionAttachment / steer / followUp / abort) moved to
// host-modules/agent-prompt.ts. prompt and abort stay `export`-ed because
// host-modules/deepseek/cordis-runtime.ts already imports them from this
// file; the wrappers below re-export so that contract is preserved.
import {
  getSession as getSessionImpl,
  onEvent as onEventImpl,
  onPluginEvent as onPluginEventImpl,
  prompt as promptImpl,
  promptContent as promptContentImpl,
  updateSessionQueue as updateSessionQueueImpl,
  readSessionAttachment as readSessionAttachmentImpl,
  steer as steerImpl,
  followUp as followUpImpl,
  abort as abortImpl,
} from "./host-modules/agent-prompt";

// Phase 8.3 Batch B: model CRUD + provider/auth surface (setModel /
// setThinkingLevel / getModel / getModelRuntime / getCwd / authStatus /
// providerCatalog) moved to host-modules/agent-model.ts. readModelsConfig
// is re-exported by this file (line 4642) so the new module can resolve
// it via the same circular-import pattern used for state / piHome / etc.
import {
  setModel as setModelImpl,
  setThinkingLevel as setThinkingLevelImpl,
  getModel as getModelImpl,
  getModelRuntime as getModelRuntimeImpl,
  getCwd as getCwdImpl,
  authStatus as authStatusImpl,
  providerCatalog as providerCatalogImpl,
} from "./host-modules/agent-model";

// Phase 8.3 Batch C: session facade + CRUD + rewind moved out of
// agent-host.ts. session-store handles loadSession / sessionInfo /
// sessionUsage / sessionFile / rewindSession / renameSession / deleteSession
// + formatBranchSummaryText helper. rewindSession calls into
// restoreFileSnapshots from the sibling rewind-snapshot module, so the
// import order in this file doesn't need to enumerate both.
import {
  loadSession as loadSessionImpl,
  sessionInfo as sessionInfoImpl,
  sessionUsage as sessionUsageImpl,
  sessionFile as sessionFileImpl,
  rewindSession as rewindSessionImpl,
  formatBranchSummaryText as formatBranchSummaryTextImpl,
  renameSession as renameSessionImpl,
  deleteSession as deleteSessionImpl,
} from "./host-modules/session-store";

// Phase 8.3 Batch C: session list + JSON-mirror metadata (pinned /
// archived / expert persona) moved out of agent-host.ts. listSessions is
// already exported because cordis-runtime.ts imports it from here, so the
// wrapper below stays `export`.
import {
  listSessions as listSessionsImpl,
  updateSessionMetadata as updateSessionMetadataImpl,
  clearSessionMetadata as clearSessionMetadataImpl,
  setSessionArchived as setSessionArchivedImpl,
  setAllArchived as setAllArchivedImpl,
  setSessionExpert as setSessionExpertImpl,
  setSessionPinned as setSessionPinnedImpl,
} from "./host-modules/session-metadata";

// Phase 8.3 Batch C: file rewind snapshot store (captureFileSnapshot /
// restoreFileSnapshots / cache). captureFileSnapshot is also called from
// agent-host.ts at line 3215 (tool execution hook), so a wrapper stays
// here to preserve the call site without dragging the new module into
// the early-init import graph.
import {
  captureFileSnapshot as captureFileSnapshotImpl,
} from "./host-modules/rewind-snapshot";

// Phase 8.3 Batch D (D1): subagent + harness task READ surface extracted.
// Write paths (ensureContinuableSubagent / createDeepSeekAgentRuntime /
// promptSubagent / interruptSubagent / killTask / inspirationGenerate) stay
// in agent-host.ts — they touch state from initialize() and the execute
// pipeline, moving them would require migrating the main flow as well.
import {
  listRunningTasks as listRunningTasksImpl,
  listSubagentChildren as listSubagentChildrenImpl,
  listSessionJobs as listSessionJobsImpl,
  subagentHistory as subagentHistoryImpl,
  promptSubagent as promptSubagentImpl,
  interruptSubagent as interruptSubagentImpl,
  killTask as killTaskImpl,
  inspirationGenerate as inspirationGenerateImpl,
} from "./host-modules/subagent-runtime";
export type { HarnessSubagentEntry, HarnessJobView } from "./host-modules/subagent-runtime";

// Phase 8.3 Batch D (D2): plugin state IPC read surface extracted (4 fns).
// Write paths (setPluginEnabled / reloadPlugin / reloadPiExtensions /
// updatePluginConfig / resetPluginState / installProfileBundle /
// removeProfileBundle / listPluginInventory) stay in agent-host.ts — entwined
// with state.pluginState / piResources / piRuntimeCoordinator /
// configurePiExtensions module-level singletons, would need to migrate the
// initialize() main flow.
import {
  pluginSnapshot as pluginSnapshotImpl,
  pluginEvents as pluginEventsImpl,
  reportActivePluginTransaction as reportActivePluginTransactionImpl,
  listActivePluginTransactions as listActivePluginTransactionsImpl,
} from "./host-modules/plugin-state";

// Phase 8.3 Batch D3: plugin runtime READ surface extracted (4 fns).
// Write paths stay in agent-host.ts — entwined with state.pluginState /
// piResources / piRuntimeCoordinator / configurePiExtensions module-level
// singletons and would need a coordinated migration of the initialize()
// main flow.
import {
  getStoredPluginState as getStoredPluginStateImpl,
  listRendererPluginEntries as listRendererPluginEntriesImpl,
  rendererPluginBootGraph as rendererPluginBootGraphImpl,
  resolveRendererPluginModule as resolveRendererPluginModuleImpl,
} from "./host-modules/plugin-runtime";

// Phase 8.3 Batch E: plugin-state 写路径 + plugin-runtime 写路径
// (setPluginEnabledInternal / reloadPluginInternal / reloadPiExtensionsInternal /
// updatePluginConfigInternal / resetPluginStateInternal + 5 wrappers +
// enqueuePluginStateTransaction + refreshStoredPluginLayers + listPluginInventory +
// installProfileBundle / removeProfileBundle / reloadProfile) extracted to
// host-modules/plugin-mutations.ts. These functions entwine the
// `pluginLifecycleQueue` singleton (kept in agent-host.ts for now) with the
// profile-loader / pi-runtime coordinator / market-place extension paths, so
// pulling them into their own module unblocks both the transaction surface
// and the marketplace-side rebuild path tests.
// Phase 8.3 Batch G: DeepSeek agent runtime 抽出到 host-modules/deepseek/agent-runtime.ts
// 保留 5 个 0-arg wrapper 让 aggregate surface 不变; createDeepSeekHookedTool 私有
// helper 直接搬到目标模块 (仅本模块内被 createDeepSeekAgentRuntime 调用)
// modelFacingPresetTools / createSubagentResourceLoader / persistedSessionPath
// 在 agent-host.ts 仍被其他子路径 (subagent 创建 / session facade) 使用, 改为
// export 让 deepseek/agent-runtime 模块通过环形 import 复用
import {
  setPluginEnabledInternal as setPluginEnabledInternalImpl,
  reloadPluginInternal as reloadPluginInternalImpl,
  reloadPiExtensionsInternal as reloadPiExtensionsInternalImpl,
  updatePluginConfigInternal as updatePluginConfigInternalImpl,
  resetPluginStateInternal as resetPluginStateInternalImpl,
  setPluginEnabled as setPluginEnabledImpl,
  reloadPlugin as reloadPluginImpl,
  reloadPiExtensions as reloadPiExtensionsImpl,
  reloadPiRuntime as reloadPiRuntimeImpl,
  updatePluginConfig as updatePluginConfigImpl,
  resetPluginState as resetPluginStateImpl,
  enqueuePluginStateTransaction as enqueuePluginStateTransactionImpl,
  refreshStoredPluginLayers as refreshStoredPluginLayersImpl,
  listPluginInventory as listPluginInventoryImpl,
  installProfileBundle as installProfileBundleImpl,
  ensureDefaultPiPackages as ensureDefaultPiPackagesImpl,
  removeProfileBundle as removeProfileBundleImpl,
  reloadProfile as reloadProfileImpl,
} from "./host-modules/plugin-mutations";
import {
  reserveDeepSeekAgent as reserveDeepSeekAgentImpl,
  reserveDeepSeekPreparation as reserveDeepSeekPreparationImpl,
  createDeepSeekAgent as createDeepSeekAgentImpl,
  resumeDeepSeekAgent as resumeDeepSeekAgentImpl,
} from "./host-modules/deepseek/agent-runtime";

// Phase 8.3 Batch H: session-store 写路径 (listPersistedSessionInfos /
// listPersistedSessionHeaders / readPersistedSessionHeader / Entries /
// Raw / Revision / persistedSessionFileRevision / withPersistedSessionLock /
// appendPersistedSessionEntries / Entry / appendLifecycleSessionEntry /
// createPersistedSession / persistPiSessionHeader) 搬到 sibling session-store.ts,
// 之前 Batch C 已含 read 路径 (loadSession / sessionInfo / sessionUsage /
// sessionFile / rewindSession / formatBranchSummaryText / renameSession /
// deleteSession). aggregate DSH bridge (line 2466-2479) 现在直接引用本模块的
// export, 不再依赖 agent-host 内部 helper。type PersistedSessionHeader /
// PersistedSessionInfo 由 session-store 显式 export, agent-host.ts 通过下方
// `export type { ... } from ...` 透传给 aggregate consumer。
import {
  listPersistedSessionInfos as listPersistedSessionInfosImpl,
  listPersistedSessionHeaders as listPersistedSessionHeadersImpl,
  readPersistedSessionHeader as readPersistedSessionHeaderImpl,
  readPersistedSessionEntries as readPersistedSessionEntriesImpl,
  readPersistedSessionRaw as readPersistedSessionRawImpl,
  readPersistedSessionRevision as readPersistedSessionRevisionImpl,
  listPersistedSessionInfos as listPersistedSessionInfosBare,
  readPersistedSessionHeader as readPersistedSessionHeaderBare,
  appendPersistedSessionEntries as appendPersistedSessionEntriesImpl,
  appendPersistedSessionEntry as appendPersistedSessionEntryImpl,
  appendLifecycleSessionEntry as appendLifecycleSessionEntryImpl,
  createPersistedSession as createPersistedSessionImpl,
  persistPiSessionHeader as persistPiSessionHeaderImpl,
} from "./host-modules/session-store";

// Phase 8.3 Batch I: profile overrides + bundles 抽出
// - overridePatchPath / readOverridePatches → host-modules/profile/override-patches.ts
// - marketplaceBundles / runtimeProfileBundle / mergePluginBundles → host-modules/profile/bundles.ts
import {
  overridePatchPath as overridePatchPathImpl,
  readOverridePatches,
} from "./host-modules/profile/override-patches";
import {
  marketplaceBundles as marketplaceBundlesImpl,
  runtimeProfileBundle,
  mergePluginBundles as mergePluginBundlesImpl,
} from "./host-modules/profile/bundles";

export async function invokeConnection(
	method: string,
	payload: unknown,
	request: import("../deepseek/deepseek-runtime").DeepSeekConnectionDispatchContext = { authority: "loopback" },
): Promise<{ handled: boolean; value?: unknown }> {
	const connection = state.context?.get("connection") as { dispatch?: (method: string, payload: unknown, signal: AbortSignal, request: import("../deepseek/deepseek-runtime").DeepSeekConnectionDispatchContext) => Promise<{ handled: boolean; value?: unknown }> } | undefined;
	if (!connection?.dispatch) return { handled: false };
	return connection.dispatch(method, payload, new AbortController().signal, request);
}

function isCurrentSessionPath(sessionPath: string | undefined, cwd: string | undefined): boolean {
  if (!sessionPath || !state.session || (cwd && cwd !== state.cwd)) return false;
  return state.session.sessionManager.getSessionFile() === sessionPath;
}

export function setProfilePiResourcePaths(paths: {
  extensions: readonly string[];
  skills: readonly string[];
  prompts: readonly string[];
  themes: readonly string[];
}): void {
  state.profilePiResourcePaths.extensions.splice(0, state.profilePiResourcePaths.extensions.length, ...paths.extensions);
  state.profilePiResourcePaths.skills.splice(0, state.profilePiResourcePaths.skills.length, ...paths.skills);
  state.profilePiResourcePaths.prompts.splice(0, state.profilePiResourcePaths.prompts.length, ...paths.prompts);
  state.profilePiResourcePaths.themes.splice(0, state.profilePiResourcePaths.themes.length, ...paths.themes);
  const profilePackageRoots = state.profilePiPackagePaths;
  const omitAutoDiscovered = (resourcePaths: readonly string[]) => resourcePaths.filter((path) =>
    !profilePackageRoots.some((packageRoot) => isPathWithin(packageRoot, path)));
  state.piNativeResourcePaths.skills.splice(0, state.piNativeResourcePaths.skills.length, ...state.profilePiResourcePaths.skills);
  state.piNativeResourcePaths.prompts.splice(0, state.piNativeResourcePaths.prompts.length, ...omitAutoDiscovered(state.profilePiResourcePaths.prompts));
  state.piNativeResourcePaths.themes.splice(0, state.piNativeResourcePaths.themes.length, ...omitAutoDiscovered(state.profilePiResourcePaths.themes));
  syncPiNativeResourcePaths();
}

export async function refreshMarketplacePiResourcePaths(): Promise<void> {
  const resources = await piResources.listPiPluginResourcePaths(state.cwd);
  const agentFiles = await piResources.listPiPluginAgentFiles(state.cwd);
  const next = {
    extensions: resources.flatMap((entry) => entry.extensions),
    skills: resources.flatMap((entry) => entry.skills),
    prompts: resources.flatMap((entry) => entry.prompts),
    themes: resources.flatMap((entry) => entry.themes),
  };
  state.piMarketplaceResourcePaths.extensions.splice(0, state.piMarketplaceResourcePaths.extensions.length, ...new Set(next.extensions));
  state.piMarketplaceResourcePaths.skills.splice(0, state.piMarketplaceResourcePaths.skills.length, ...new Set(next.skills));
  state.piMarketplaceResourcePaths.prompts.splice(0, state.piMarketplaceResourcePaths.prompts.length, ...new Set(next.prompts));
  state.piMarketplaceResourcePaths.themes.splice(0, state.piMarketplaceResourcePaths.themes.length, ...new Set(next.themes));
  state.piMarketplaceAgentFiles.splice(0, state.piMarketplaceAgentFiles.length, ...agentFiles.map(({ path, content }) => ({ path, content })));
  syncPiNativeResourcePaths();
}

export async function refreshHookConfigs(): Promise<void> {
  const configs = await discoverHookConfigs(await artifactPackagePaths());
  state.hookConfigs.splice(0, state.hookConfigs.length, ...configs);
  for (const diagnostic of hookConfigDiagnostics(configs)) {
    emitPluginEvent(diagnostic.level === "error" ? "hook/config-failed" : "hook/config-warning", diagnostic);
  }
}

export async function syncMarketplacePiExtensionStatuses(): Promise<void> {
  return syncMarketplacePiExtensionStatusesImpl(state);
}

function syncPiNativeResourcePaths(): void {
  const merge = (profilePaths: readonly string[], marketplacePaths: readonly string[]) => [...new Set([...profilePaths, ...marketplacePaths])];
  const profilePackageRoots = state.profilePiPackagePaths;
  const omitAutoDiscovered = (resourcePaths: readonly string[]) => resourcePaths.filter((path) =>
    !profilePackageRoots.some((packageRoot) => isPathWithin(packageRoot, path)));
  state.piNativeResourcePaths.skills.splice(0, state.piNativeResourcePaths.skills.length, ...merge(state.profilePiResourcePaths.skills, state.piMarketplaceResourcePaths.skills));
  state.piNativeResourcePaths.prompts.splice(0, state.piNativeResourcePaths.prompts.length, ...merge(omitAutoDiscovered(state.profilePiResourcePaths.prompts), state.piMarketplaceResourcePaths.prompts));
  state.piNativeResourcePaths.themes.splice(0, state.piNativeResourcePaths.themes.length, ...merge(omitAutoDiscovered(state.profilePiResourcePaths.themes), state.piMarketplaceResourcePaths.themes));
}

async function reloadMarketplacePiResources(): Promise<void> {
  await refreshMarketplacePiResourcePaths();
  await refreshHookConfigs();
  configurePiExtensions(state.profilePiExtensions);
  await piRuntimeCoordinator.reload("marketplace-resources");
  reportPiExtensionErrors();
}

export function profileArtifactModuleUrl(path: string): string {
  const url = new URL(toModuleUrl(path));
  url.searchParams.set("openbuddy_profile_reload", String(state.profileArtifactGeneration));
  return url.href;
}

function nativePiResourcePaths(): {
  additionalSkillPaths: string[];
  additionalPromptTemplatePaths: string[];
  additionalThemePaths: string[];
} {
  return {
    additionalSkillPaths: state.piNativeResourcePaths.skills,
    additionalPromptTemplatePaths: state.piNativeResourcePaths.prompts,
    additionalThemePaths: state.piNativeResourcePaths.themes,
  };
}

function refreshPiExtensions(): void {
  if (!state.session) return;
  state.piRefreshPromise = piRuntimeCoordinator
    .reloadUntilStable(() => state.toolRegistryRevision, "tool-registry")
    .catch((error) => {
      console.warn("[openbuddy] failed to refresh Pi extensions", error);
    });
}

function createToolRegistry(onChange?: () => void): PiToolRegistry {
  const tools = new Map<string, ToolDefinition>();
  return {
    registerTool: (tool) => {
      if (!tool?.name) throw new Error("openbuddy-tool: name is required");
      tools.set(tool.name, tool);
      state.toolRegistryRevision += 1;
      state.deepSeekPiToolSync?.();
      onChange?.();
      return () => {
        if (tools.get(tool.name) !== tool) return false;
        const deleted = tools.delete(tool.name);
        if (deleted) {
        state.toolRegistryRevision += 1;
          state.deepSeekPiToolSync?.();
          onChange?.();
        }
        return deleted;
      };
    },
    list: () => [...tools.values()],
    listLocal: () => [...tools.values()],
  };
}

function createPiRuntime(): PiAgentRuntime {
	return {
		tools: state.toolRegistry,
		getSession,
		getModel,
		prompt,
		abort,
		setModel,
		onEvent,
	};
}

/**
 * Stable service exposed before the first AgentSession is created.
 *
 * Profile plugins are loaded before Pi creates its session so they can add
 * tools to the resource loader. A raw `AgentSession` cannot be injected at
 * that point, so `piSession` is a live facade instead of a one-time value.
 * Its methods always resolve the current session and fail with a stable
 * message while the host is between sessions.
 */
function createPiSessionFacade(): PiSessionFacade {
  return {
    get sessionId() { return state.session?.sessionId; },
    get model() { return state.session?.model; },
    get thinkingLevel() {
      // Read through the SDK getter so we always surface the clamped level
      // (Pi can downshift e.g. "high" → "medium" if the active model
      // doesn't support the requested tier).
      const session = state.session;
      return session ? (session.thinkingLevel as OpenBuddyThinkingLevel) : undefined;
    },
    getSession,
    subscribe: (handler) => onEvent(handler),
    prompt: (text) => prompt(text),
    promptContent: (content, mode) => promptContent(content, mode),
    abort: () => abort(),
    setModel: (modelId) => setModel(modelId),
    setThinkingLevel: (level) => setThinkingLevel(level),
  };
}

export async function listAllPiSessions(): Promise<Awaited<ReturnType<typeof SessionManager.listAll>>> {
  const root = piHome();
  const sessionRoots = [root, join(root, "sessions")];
  try {
    for (const entry of await readdir(join(root, "sessions"), { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink()) sessionRoots.push(join(root, "sessions", entry.name));
    }
  } catch {
    // A first-run agent directory may not have a sessions directory yet.
  }
  const sessions = await Promise.all(sessionRoots.map((directory) => SessionManager.listAll(directory)));
  return [...new Map(sessions.flat().map((session) => [session.path, session])).values()]
    .sort((left, right) => right.modified.getTime() - left.modified.getTime());
}

async function reserveDeepSeekAgent(sessionId: string, operation: "create" | "resume"): Promise<{ token: string; heartbeatMs: number; renew: () => Promise<void>; release: () => Promise<void> }> {
  return reserveDeepSeekAgentImpl(sessionId, operation);
}

async function reserveDeepSeekPreparation(sessionId: string): Promise<{ token: string; heartbeatMs: number; renew: () => Promise<void>; release: () => Promise<void> }> {
	return reserveDeepSeekPreparationImpl(sessionId);
}

export async function persistedSessionPath(sessionId: string | undefined): Promise<string | undefined> {
	if (!sessionId) return undefined;
	const active = state.session;
	if (active?.sessionId === sessionId) return active.sessionManager.getSessionFile();
	try {
		return (await listAllPiSessions()).find((session) => session.id === sessionId)?.path;
	} catch {
		return undefined;
	}
}


// Stage F-2: profile path helpers moved to host-modules/profile/paths.ts.
// The thin wrappers below keep the original 0-argument call sites in this
// file working without forcing every reader to pass state.profileOptions
// / state.cwd explicitly.
import {
  profilePatchPaths as profilePatchPathsImpl,
  profileResourceWatchPaths as profileResourceWatchPathsImpl,
  marketplaceArtifactPackagePaths as marketplaceArtifactPackagePathsImpl,
  artifactPackagePaths as artifactPackagePathsImpl,
  artifactPackageJsonByName,
  packageRootForLoaderSpecifier as packageRootForLoaderSpecifierImpl,
} from "./host-modules/profile/paths";
function profilePatchPaths(): string[] {
  return profilePatchPathsImpl(state.profileOptions, piHome);
}
function profileResourceWatchPaths(): string[] {
  return profileResourceWatchPathsImpl(state.profileOptions, state.profilePackagePaths, piHome);
}
async function marketplaceArtifactPackagePaths(): Promise<string[]> {
  return marketplaceArtifactPackagePathsImpl(state.cwd);
}
async function artifactPackagePaths(): Promise<string[]> {
  return artifactPackagePathsImpl(state.profilePackagePaths, state.cwd);
}


function stopProfileWatchers(): void {
  stopProfileWatchersImpl(state);
}

function compact(customInstructions?: string) {
  return compactSessionImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir }, customInstructions);
}
function setAutoCompaction(enabled: boolean) {
  return setAutoCompactionEnabledImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir }, enabled);
}
function setAutoRetry(enabled: boolean) {
  return setAutoRetryEnabledImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir }, enabled);
}
function abortRetryFn() {
  return abortRetryImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir });
}
function abortBashFn() {
  return abortBashImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir });
}
function setSteeringModeFn(mode: "all" | "one-at-a-time") {
  return setSteeringModeImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir }, mode);
}
function setFollowUpModeFn(mode: "all" | "one-at-a-time") {
  return setFollowUpModeImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir }, mode);
}
function getSessionStatsFn() {
  return getSessionStatsImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir });
}
function getAvailableThinkingLevelsFn(): string[] {
  return getAvailableThinkingLevelsImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir }) as string[];
}
function forkSessionFn(entryId: string) {
  return forkSessionImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir }, entryId);
}
function getSessionTreeFn() {
  return getSessionTreeImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir });
}
function getCompactionSettingsFn() {
  return getCompactionSettingsImpl({ state, cwd: () => state.cwd ?? process.cwd(), piSessionDir });
}

// Stage F-2: PiProfileSnapshot + capturePiProfileSnapshot + restorePiProfileSnapshot
// have moved to host-modules/profile/snapshot.ts. The local bindings
// `capturePiProfileSnapshot` / `restorePiProfileSnapshot` are re-imported
// at the top of this file (see L463-470) so existing callers keep working.

export function captureReloadableContextServices(): Map<string, unknown> {
  const captured = captureDeepSeekCapabilityServices();
  const workspaceRegistry = state.context?.get("workspaceRegistry");
  if (workspaceRegistry !== undefined) captured.set("workspaceRegistry", workspaceRegistry);
  return captured;
}

export function restoreCapturedContextServices(captured: Map<string, unknown>): void {
  if (!state.context) return;
  for (const [serviceKey, service] of captured) {
    if (state.context.get(serviceKey) === undefined) state.context.set(serviceKey, service);
  }
}
// Stage F-5: scheduleProfileReload + rollbackPiProfile moved to
// host-modules/profile-reload-transaction.ts. The facade re-exports
// the module-level functions so legacy callers (startProfileWatchers
// wrapper, plugin-mutations installHostModules deps, etc.) keep
// working unchanged.
import { scheduleProfileReload, rollbackPiProfile } from "./host-modules/profile-reload-transaction";
export { scheduleProfileReload, rollbackPiProfile };
/**
 * Stage F-5: profile artifact reconciler functions (discoverProfileRemoteContributions,
 * discoverProfileTypertContributions, clearProfileArtifacts, installProfileArtifacts,
 * reconcileProfileArtifacts) moved to host-modules/profile-artifact-reconciler.ts.
 */
import {
  reconcileProfileArtifacts,
  discoverProfileRemoteContributions,
  discoverProfileTypertContributions,
} from "./host-modules/profile-artifact-reconciler";
export {
  reconcileProfileArtifacts,
  discoverProfileRemoteContributions,
  discoverProfileTypertContributions,
};


function listProfileRemoteContributions(): RemoteContribution[] {
  return [...state.profileRemoteContributions.values()].map((contribution) => ({
    ...contribution,
    descriptors: contribution.descriptors.map((descriptor) => ({ ...descriptor })),
  }));
}

export async function reloadProfile(): Promise<void> {
  scheduleProfileReload();
  await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 160));
  await state.profileReloadPromise;
}

export async function profilePackages(): Promise<ProfilePackageInfo[]> {
  if (!state.profileOptions) throw new Error("openbuddy-profile: profile is not initialized");
  const packages = await listProfilePackages(state.profileOptions);
  const profile = await readOpenBuddyProfile(state.profileOptions);
  const bundleNames = new Set(profile.bundles);
  const rendererEntries = await discoverRendererPluginManifest();
  const piByPackage = new Map<string, PiExtensionStatus[]>();
  for (const extension of state.piExtensionStatuses) {
    if (!extension.packageName) continue;
    const rows = piByPackage.get(extension.packageName) ?? [];
    rows.push(extension);
    piByPackage.set(extension.packageName, rows);
  }
  return packages.map((entry) => {
    const loaded: UnifiedPluginSurfaceKind[] = [
      ...(entry.bundle && bundleNames.has(entry.name) ? ["bundle" as const] : []),
      ...(entry.pi && (piByPackage.get(entry.name) ?? []).some((extension) => extension.state === "loaded") ? ["pi" as const] : []),
      ...(entry.client && rendererEntries.some((renderer) => renderer.moduleId === entry.name && !renderer.disabled) ? ["renderer" as const] : []),
      ...(entry.remote && state.profileRemoteContributions.has(entry.name) ? ["remote" as const] : []),
      ...(entry.typert && state.profileTypertContributions.has(entry.name) ? ["typert" as const] : []),
      ...(entry.cordis && state.deepSeekCordisSnapshot?.plugins.some((plugin) => plugin.name === entry.name && plugin.state === "active") ? ["cordis" as const] : []),
    ];
    const piFailed = (piByPackage.get(entry.name) ?? []).some((extension) => extension.state === "failed");
    return {
      ...entry,
      manifest: updateUnifiedPluginManifest(entry.manifest, {
        loaded,
        health: piFailed || entry.health === "degraded" ? "degraded" : "healthy",
      }),
    };
  });
}

async function installProfileBundle(sourcePath: string) : Promise<ProfilePackageInfo> { return installProfileBundleImpl(sourcePath); }

async function removeProfileBundle(name: string) : Promise<void> { return removeProfileBundleImpl(name); }

/**
 * C6: Install the curated default Pi package bundle into the current profile.
 * Exposed via the renderer so the OpenBuddyPluginPanel "Enable Default Pi Bundle"
 * button can drive it through the IPC bridge.
 *
 * Returns the per-package status list (installed / skipped / failed) so the
 * renderer can surface a toast without owning the installer logic.
 */
export async function installDefaultPiPackages(options?: { force?: boolean }): Promise<DefaultPiPackageResult[]> {
  if (!state.profileOptions) throw new Error("openbuddy-profile: profile is not initialized");
  const results = await ensureDefaultPiPackagesImpl({
    ...state.profileOptions,
    force: options?.force === true,
  });
  return results;
}

export async function startProfileWatchers(): Promise<void> {
  return startProfileWatchersImpl(state, () => scheduleProfileReload(), () => profileResourceWatchPaths());
}

// Stage F-2: ElectronHarnessPluginLoader moved to host-modules/profile/loader.ts.
// The class is re-imported at the top of this file (see L463-470) so the
// `new ElectronHarnessPluginLoader(...)` call site in mountConfiguredAgentPreset
// keeps working through the original binding. At Stage F-5 the facade switches
// to import from "./host-modules/profile/loader" directly.
import { ElectronHarnessPluginLoader as ElectronHarnessPluginLoaderImpl } from "./host-modules/profile/loader";
const ElectronHarnessPluginLoader = ElectronHarnessPluginLoaderImpl;

/**
 * Electron-flavoured subclass of {@link HarnessPluginLoader} that wires
 * `exit()` to the Electron lifecycle: `app.relaunch()` re-spawns the
 * binary with the same arguments, `app.exit(0)` then drops the current
 * process so the new one takes over. Plugins trigger this by calling
 * `ctx.loader.exit()` (the deepseek-harness convention for "please
 * restart the host") — the base loader's no-op default is replaced by
 * the real teardown here.
 */
// (implementation moved to host-modules/profile/loader.ts)

// Phase 8.3 Batch J: plugin event bus + readiness snapshot moved to
// host-modules/plugin-event-bus.ts. Wrappers preserve the 0-arg call
// surface used by host-modules/session-metadata, session-store, and
// deepseek/cordis-runtime (which all import these names from agent-host).
import {
  emitPluginEvent as emitPluginEventImpl,
  pluginReadinessSnapshot as pluginReadinessSnapshotImpl,
  pluginReadiness as pluginReadinessImpl,
  pluginLifecycleQueue,
  // Phase 8.3 fix: installTeamRunner() in initialize() needs these. The
  // pre-migration code went through wrappers; migration removed the
  // wrappers but the install call needs the bare names. They live in
  // plugin-event-bus.ts as the source of truth (lines 57 / 67).
  eventNamespace,
  canonicalEventNamespace,
  // Post-init runtime fix: workspace:list and capability bridge use clonePayload
  // directly; the bare-name accessibility used to come from the agent-host
  // re-export, but the Phase 8.3 split removed that wrapper. Re-import here.
  clonePayload,
} from "./host-modules/plugin-event-bus";

// Phase 8.3 Batch L1: SessionEventLog bootstrap extracted to
// host-modules/bootstrap/session-event-log.ts. Wraps the new + load +
// state-writes that initialize() used to inline. Subsequent batches
// (L2-L5) will extract the model-runtime, context-services,
// profile-loader, and pi-session phases the same way.
import { bootstrapSessionEventLog } from "./host-modules/bootstrap/session-event-log";
import { bootstrapModelRuntime } from "./host-modules/bootstrap/model-runtime";
import { bootstrapProfileOptions, resolveProfileOptions } from "./host-modules/bootstrap/profile-options";
// installMicrokernelHost is the single entry point that wires every
// host-module via installHostModules() under the hood. It also records
// which modules are installed so diagnostics + tests can introspect.
import { installMicrokernelHost } from "./host-modules/bootstrap/microkernel-host";
// v4 sub-stage extractors — initialize() is now an 8-stage orchestrator
// instead of a 300-line wall. Each helper owns one stage of the bootstrap.
import { wireForwardedEvents } from "./host-modules/bootstrap/wire-forwarded-events";
import { setupProfileOptions } from "./host-modules/bootstrap/profile-options-setup";
import { initPluginLoader } from "./host-modules/bootstrap/init-plugin-loader";
import { initDeepSeek } from "./host-modules/bootstrap/init-deepseek";
import { computeActiveAdapterIds } from "./host-modules/bootstrap/compute-active-adapter-ids";
import { createJobsRegistry } from "./host-modules/bootstrap/jobs-registry";
import { buildAgentHostFacade } from "./host-modules/bootstrap/build-agent-host-facade";
import type { InstallHostModuleDeps } from "./host-modules/bootstrap/install-host-modules";

import { buildSessionEventSubscriber } from "./host-modules/bootstrap/handle-session-event";
import type { HandleSessionEventDeps } from "./host-modules/bootstrap/handle-session-event";
import { injectSystemPromptSections } from "./host-modules/bootstrap/inject-system-prompt-sections";
import { provideRpcUiContext } from "./host-modules/bootstrap/provide-rpc-ui-context";
import { wireContextServices, type WireContextServicesDeps } from "./host-modules/bootstrap/wire-context-services";
import type { ProvideRpcUiContextDeps } from "./host-modules/bootstrap/provide-rpc-ui-context";
import { wireDshServices, type WireDshServicesDeps } from "./host-modules/bootstrap/wire-dsh-services";
import { initProfile } from "./host-modules/bootstrap/init-profile";
export function emitPluginEvent(type: string, payload: unknown) { return emitPluginEventImpl(type, payload); }
export function pluginReadinessSnapshot() {
  return pluginReadinessSnapshotImpl();
}
export function pluginReadiness() { return pluginReadinessImpl(); }
export { pluginLifecycleQueue } from "./host-modules/plugin-event-bus";

function selectedProfileDirectory(): string {
  if (state.profileOptions?.profileDir) return resolve(state.profileOptions.profileDir);
  return join(
    state.profileOptions?.home ?? defaultOpenBuddyProfileHome(),
    "profiles",
    state.profileOptions?.profileName ?? "desktop",
  );
}

function createPiToolExtension(): ExtensionFactory {
  return (pi) => {
    if (typeof pi.registerTool !== "function") return;
    const tools = state.presetSessionRuntime?.tools ?? state.toolRegistry.list();
    for (const tool of tools) {
      pi.registerTool(createTaskAwareTool(tool, (toolCallId) => state.runningTasks.get(toolCallId)?.abortController?.signal));
    }
  };
}

async function sessionPresetSelection(sessionPath?: string | null): Promise<string | null | undefined> {
  if (!sessionPath) return undefined;
  try {
    const entries = SessionManager.open(sessionPath).getEntries();
    return resolveAgentPresetSelection(entries);
  } catch {
    return undefined;
  }
}
/**
 * Stage F-5: mountConfiguredAgentPreset + selectAgentPreset moved to
 * host-modules/agent-preset-runtime.ts. The facade re-exports the
 * module-level functions so legacy callers (init-session stage and
 * agentHost.selectAgentPreset IPC) keep working unchanged.
 */
import { mountConfiguredAgentPreset, selectAgentPreset } from "./host-modules/agent-preset-runtime";
export { mountConfiguredAgentPreset, selectAgentPreset };


export function modelFacingPresetTools(): ToolDefinition[] {
  return state.presetSessionRuntime?.modelFacingTools ?? state.toolRegistry.list();
}

export async function createSubagentResourceLoader(cwd: string): Promise<DefaultResourceLoader | undefined> {
  const presetPrompt = state.presetSessionRuntime?.modelFacingSystemPrompt.trim();
  if (!presetPrompt) return undefined;
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: piHome(),
    noExtensions: true,
    systemPromptOverride: (base) => [base, presetPrompt].filter((value): value is string => Boolean(value?.trim())).join("\n\n") || undefined,
  });
  await loader.reload();
  return loader;
}

function createPiPlanModeFactory(): ExtensionFactory {
	return createPiPlanModeExtension({
		resolveController: () => state.context?.get("plan") as {
			getPlan: (sessionId: string) => Promise<{ enabled: boolean; state: string; planText: string }>;
			setEnabled: (sessionId: string, enabled: boolean) => Promise<{ enabled: boolean; state: string; planText: string }>;
			requestEnabled: (sessionId: string, enabled: boolean) => Promise<{ enabled: boolean; state: string; planText: string }>;
			commitPending: (sessionId: string) => Promise<{ enabled: boolean; state: string; planText: string }>;
			setPlan: (sessionId: string, planText: string) => Promise<{ enabled: boolean; state: string; planText: string }>;
			approve: (sessionId: string) => Promise<{ enabled: boolean; state: string; planText: string }>;
			reject: (sessionId: string) => Promise<{ enabled: boolean; state: string; planText: string }>;
		} | undefined,
	});
}

// Stage F-5: configurePiExtensions + reportPiExtensionErrors moved to
// host-modules/pi-extension-configure.ts. The facade re-exports the
// module-level functions so legacy callers (init-session stage,
// profile-reload-transaction installHostModules deps, etc.) keep
// working unchanged.
import { configurePiExtensions, reportPiExtensionErrors } from "./host-modules/pi-extension-configure";
export { configurePiExtensions, reportPiExtensionErrors };

// Phase 8.3 Batch L: hook permission request handler moved to
// host-modules/hook-permission.ts. Wrapper preserves (title, message,
// request) signature used by configurePiExtensions.confirm binding.
import {
  requestHookPermission as requestHookPermissionImpl,
} from "./host-modules/hook-permission";
async function requestHookPermission(title: string, message: string, request?: HookPermissionRequest) { return requestHookPermissionImpl(title, message, request); }


export async function initialize(opts?: { cwd?: string; sessionPath?: string; force?: boolean }): Promise<void> {
  if (!opts?.force && state.session && (!opts?.cwd || opts.cwd === state.cwd)
    && (!opts?.sessionPath || isCurrentSessionPath(opts.sessionPath, opts.cwd))) return;
  if (state.session) await disposeInternal();

  const cwd = opts?.cwd ?? process.cwd();
  // Phase 8.3 Batch L1: SessionEventLog bootstrap extracted to
  // host-modules/bootstrap/session-event-log.ts. Hydrating from disk is
  // required for the harness server's `since=` replay across Electron
  // restarts; without `load()`, the new process starts with an empty
  // ring buffer and the harness client never sees events written before
  // the previous shutdown.
  await bootstrapSessionEventLog(state, cwd);
  // Phase 8.3 Batch L2: ModelRuntime + auth sync + provider registry
  // tracker extracted to host-modules/bootstrap/model-runtime.ts. The
  // provider-registry tracker keeps emitting `plugin/provider-registry-changed`
  // events as Pi extensions register/unregister providers, so the host UI
  // can refresh its model picker without polling.
  await bootstrapModelRuntime(state);
  // Establish local alias so the legacy `modelRuntime` shorthand used by
  // context.provide/agentHost payloads inside this function remains valid.
  // Pre-Phase 8.3, this was the closure variable created by the inline
  // ModelRuntime bootstrap. After migration, the same value lives in
  // state.modelRuntime — keep the local alias for backwards source compatibility.
  const modelRuntime = state.modelRuntime;
  // Phase 8.3 §33.5.3: every host-module's install() is now wired in a single
  // call via host-modules/bootstrap/install-host-modules.ts. This keeps
  // agent-host.ts:initialize() free of 17 inline install calls and gives us
  // one place to document / test the install order. The deps parameter
  // carries every closure variable that used to be referenced inline.
  installMicrokernelHost(state, {
    piHome,
    isPathWithin,
    piSessionDir,
    emitPluginEvent,
    emitRendererEvent,
    listAllPiSessions,
    persistedSessionPath,
    enqueueLifecycle,
    lifecycleAppendQueues,
    initialize,
    rebindSession,
    dispose,
    piRuntimeCoordinator,
    publicQueueItems: publicQueueItems as any,
    workspaceRegistry,
    readModelsConfig,
    canonicalEventNamespace,
    eventNamespace,
    createSubagentResourceLoader,
    createTaskAwareTool,
    modelFacingPresetTools,
    runHookPoint,
    profileArtifactModuleUrl,
    profilePackages,
    pluginLifecycleQueue,
    setProfilePiResourcePaths,
    refreshMarketplacePiResourcePaths,
    refreshHookConfigs,
    sessionPresetSelection,
    replaceSession: ((opts: any) => piSessionRuntime.replace(opts)) as any,
    sessionManagerOpen: ((sessionPath: string, options: any, cwd: string) => SessionManager.open(sessionPath, options, cwd)) as any,
    agentHome: piHome,
    provideRpcUiContext,
    questionAnswer,
    createOpenBuddyRpcUiContext,
    telemetrySink,
    resolveProfileDirectory: selectedProfileDirectory,
    requestHookPermission,
    createRequire,
    createPiToolExtension,
    listAgentPresets: ((cwd: string) => piResources.listAgentPresets(cwd)) as any,
    readAgentPresetDefaults: (() => piResources.readAgentPresetDefaults()) as any,
    writeAgentPresetDefault: ((id?: string) => piResources.writeAgentPresetDefault(id)) as any,
    readAgentPreset: ((id: string, cwd: string) => piResources.readAgentPreset(id, cwd)) as any,
    createPresetSessionRuntime: ((opts: any) => new PresetSessionRuntime(opts)) as any,
    sessionHasConversation,
    piRuntimeCoordinatorReload: ((reason: string) => piRuntimeCoordinator.reload(reason)),
    // dispose-internal
    piSessionRuntimeDispose: () => piSessionRuntime.dispose(),
    stopProfileWatchers,
    disposeProfileTypertRegistrations,
    disposeActiveHookProcesses,
    drainActiveHookProcesses,
    // workbench-scope-sync
    casdoorStatus: () => casdoorAuth.status(),
    // ui-request-resolver
    permissionReadRules: () => permissionHandlers.readRules(),
    permissionWriteRules: (rules: any) => permissionHandlers.writeRules(rules),
    capturePiProfileSnapshot,
    restorePiProfileSnapshot,
    captureDeepSeekCapabilityServices,
    restoreDeepSeekCapabilityServices,
    materializeOpenBuddyProfile,
    createOpenBuddyProfile,
    composePluginPatches,
    syncDeepSeekCordisRuntime,
    deepSeekCoreRuntimeEntries,
    reloadMcp,
    syncMarketplacePiExtensionStatuses,
    startProfileWatchers,
    readOverridePatches,
    runtimeProfileBundle,
    reconcileProfileArtifacts,
    configurePiExtensions: configurePiExtensions as any,
    reportPiExtensionErrors,
    captureReloadableContextServices,
    restoreCapturedContextServices,
    rollbackPiProfile,
    scheduleProfileReload,
    artifactPackageJsonByName,
    discoverRendererPluginManifest,
    promptImpl,
    abortImpl,
    listSessionsImpl,
    listSubagentChildrenImpl,
    promptSubagentImpl,
    interruptSubagentImpl,
    ensureContinuableSubagent,
  });
  // Phase 8.3 §33.5.3 fixup: restore context wiring that the previous
  // install-host-modules extraction accidentally consumed. The order is
  // preserved from the pre-refactor parent commit (23b79110^): tool
  // registry + pi runtime + eventLog + jobs all come AFTER every
  // host-module's install() but BEFORE context.provide("jobs", jobs).
  const context = new Context();
  state.toolRegistry = createToolRegistry(refreshPiExtensions);
  state.toolRegistryRevision = 0;
  const piRuntime = createPiRuntime();
  const piSession = createPiSessionFacade();
  context.provide("eventLog", {
    list: (query?: { sessionId?: string; sinceSequence?: number; limit?: number }) => state.sessionEventLog?.snapshot(query) ?? [],
    lastSequence: () => state.sessionEventLog?.lastSequence() ?? state.eventSequence,
  });
  // Phase 8.3 §33.5.4: jobs registry extracted to host-modules/bootstrap/jobs-registry.ts.
  // createJobsRegistry returns the same facade the 22-line inline object used to
  // expose — register / update / list / get — without the composition root
  // having to carry the closures.
  const jobs = createJobsRegistry({ state, emitPluginEvent });
  // Phase 8.3 §38: the 15 "core services" context.provide calls now live in
  // host-modules/bootstrap/wire-context-services.ts. They are pure declarative
  // registrations (no inline closure state) so they belong in one helper.
  // The DSH cluster (dshRemotes / dshRemote / dshGoalState) stays inline
  // because it owns large Maps that don't fit a clean deps interface.
  wireContextServices({
    cwd,
    state,
    context,
    modelRuntime,
    piRuntime,
    piSession,
    jobs,
    prompt,
    steer,
    followUp,
    abort,
    getModel: () => state.model,
    setModel,
    newSession,
    loadSession,
    listSessions,
    listAllPiSessions,
    listPersistedSessionHeadersImpl,
    appendPersistedSessionEntriesImpl,
    appendLifecycleSessionEntryImpl,
    reserveDeepSeekPreparation,
    reserveDeepSeekAgent,
    createDeepSeekAgent,
    resumeDeepSeekAgent,
    createTeamRunner,
    openBuddyCorePlugin,
    listSubagentChildren,
  } as unknown as WireContextServicesDeps);
  // Phase 8.3 §39: the DSH (DeepSeek-Host) cluster (dshGoalState,
  // dshFeedbackState, sessionKey helpers, dshHostRunner, dshRemotes,
  // dshRemote) was 188 lines inline. Extract it to
  // host-modules/bootstrap/wire-dsh-services.ts so agent-host.ts
  // :initialize() stays a thin orchestrator.
  wireDshServices({
    context,
    state,
    cwd,
    listCommands,
    listPluginInventory,
    listPlugins,
    listDshFileReferences,
    listSessions,
    listRunningTasks,
    killTask,
    remoteServiceContext,
    transitionDshGoal,
  } as unknown as WireDshServicesDeps);
  state.context = context;
  // Phase 8.3 §33.5.5: forwarded-events bus + capability event bridge extracted
  // to host-modules/bootstrap/wire-forwarded-events.ts. The forwarder list
  // (FORWARDED_REMOTE_EVENTS) and the bridge binding both live there.
  wireForwardedEvents({ state, context, emitRendererEvent, emitPluginEvent });
  // Stage G-1c: openbuddy-automation removed; automation is owned by
  // pi-background-tasks + pi-goal (passthrough). The legacy
  // `automation/run` Cordis event no longer exists; pi-native
  // background-task scheduling fires directly from the pi session.
  await context.start();

  let profilePackageJson: string | undefined;
  // Phase 8.3 §33.5.6: profile-options trio collapsed to a single stage call.
  // setupProfileOptions() runs resolveProfileOptions + bootstrapProfileOptions
  // + ensureOpenBuddyProfile, returning the resolved + bootstrapped objects.
  const { resolvedProfile, profileOptions } = await setupProfileOptions({ env: process.env });
  // C6: opt-in install of the curated default Pi package bundle.
  // Controlled by `OPENBUDDY_INSTALL_DEFAULT_PI=1` so the default install path
  // is untouched unless the host integrator opts in. Failures are logged as
  // warnings so an upstream registry hiccup never blocks session bootstrap.
  if (process.env.OPENBUDDY_INSTALL_DEFAULT_PI === "1" && profileOptions?.profileDir) {
    void ensureDefaultPiPackages({ profileDir: profileOptions.profileDir }).then((results) => {
      const failed = results.filter((r) => r.status === "failed");
      const installed = results.filter((r) => r.status === "installed");
      if (installed.length || failed.length) {
        console.log(
          `[openbuddy] default Pi bundle: installed=${installed.length} skipped=${results.filter((r) => r.status === "skipped").length} failed=${failed.length}`,
          failed.map((r) => `${r.spec}: ${r.error}`),
        );
      }
    }).catch((error) => {
      console.warn("[openbuddy] default Pi bundle install failed:", error);
    });
  }
  const { profileBundle, profilePackageJson: materializedProfilePackageJson } = await initProfile({
    state,
    resolvedProfile,
    profileOptions,
    piHome,
    emitPluginEvent,
    setProfilePiResourcePaths,
    startProfileWatchers,
  });
  profilePackageJson = materializedProfilePackageJson;
  // Phase 8.3 §33.5.7: ElectronHarnessPluginLoader + PluginStateStore bootstrap
  // extracted to host-modules/bootstrap/init-plugin-loader.ts. Returns the
  // loader (so DSH + session stages can reuse it) and the hydrated
  // pluginState (commit markers already loaded into state).
  const { loader, pluginState } = await initPluginLoader({
    state,
    cwd,
    context,
    baseUrl: import.meta.url,
    emitPluginEvent,
    resolveDeepSeekModule,
    openBuddyCorePlugin,
    openBuddyCapabilityPluginIndex,
  });
  state.loader = loader;
  state.pluginState = pluginState;

  // Phase 8.3 §33.5.8: DSH (DeepSeek Host) assembly extracted to
  // host-modules/bootstrap/init-deepseek.ts. Owns baseProfile composition,
  // profile.loadProfile + syncDeepSeekCordisRuntime, capability service
  // restore + typert ready, 7 @deepseek-ai/* core package registrations,
  // and reconcileProfileArtifacts — all under a single named call.
  await initDeepSeek({
    state,
    context,
    loader,
    profileBundle,
    baseUrl: import.meta.url,
    emitPluginEvent,
    emitRendererEvent,
    remoteServiceContext,
    reconcileProfileArtifacts,
  });

  // Phase 8.3 §33.5.9: activeAdapterIds computation extracted to
  // host-modules/bootstrap/compute-active-adapter-ids.ts. Walks
  // state.piExtensionStatuses (canonical source of truth) and returns the
  // deduped set the system-prompt injection needs.
  const activeAdapterIds = computeActiveAdapterIds({ state });
  await injectSystemPromptSections({
    cwd,
    context: state.context!,
    piResources,
    describeCompatibilityAdapterCommandsMarkdown,
    activeAdapterIds,
  });

  const persistedPresetId = await sessionPresetSelection(opts?.sessionPath);
  const mountedPresetId = await mountConfiguredAgentPreset(cwd, context, loader, persistedPresetId);

  await startProfileWatchers();

  await refreshMarketplacePiResourcePaths();
  configurePiExtensions(state.profilePiExtensions);
  const piResourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: piHome(),
    ...nativePiResourcePaths(),
    additionalExtensionPaths: state.piExtensionPaths,
    extensionFactories: state.piExtensionFactories,
    agentsFilesOverride: (base) => ({
      agentsFiles: [...base.agentsFiles, ...state.piMarketplaceAgentFiles.map((file) => ({ ...file }))],
    }),
    systemPromptOverride: (base) => {
      const prompt = state.context?.get("systemPrompt") as { render?: () => string } | undefined;
      const contributed = prompt?.render?.() ?? "";
      const presetPrompt = state.presetSessionRuntime?.renderSystemPrompt() ?? "";
      return [base, contributed, presetPrompt].filter((value): value is string => Boolean(value?.trim())).join("\n\n") || undefined;
    },
  });
  let session: AgentSession;
  try {
    await piResourceLoader.reload();
    state.piResourceLoader = piResourceLoader;
    session = await piSessionRuntime.create({
      cwd,
      agentDir: piHome(),
      noTools: "builtin",
      modelRuntime: modelRuntime ?? undefined,
      sessionManager: opts?.sessionPath
        ? SessionManager.open(opts.sessionPath, undefined, cwd)
        : SessionManager.create(cwd, piSessionDir(cwd)),
      resourceLoader: piResourceLoader,
    });
    if (!opts?.sessionPath) await persistPiSessionHeaderImpl(session);
  } catch (error) {
    await state.presetSessionRuntime?.dispose().catch(() => undefined);
    state.presetSessionRuntime = null;
    throw error;
  }
  reportPiExtensionErrors();
  await syncMarketplacePiExtensionStatuses();

  state.session = session;
  state.model = session.model;
  if (!opts?.sessionPath) {
    session.sessionManager.appendCustomEntry("openbuddy/agent-preset", { id: mountedPresetId, version: 1 });
  }
  state.queueMirror = [];
  context.provide("teamRunner", createTeamRunner(modelRuntime as ModelRuntime, cwd, () => state.model));
  context.provide("piSessionRaw", session);
  context.provide("piExtensionApi", session);
  // Phase 8.3 §46: extract createOpenBuddyRpcUiContext call + context.provide into
  // provideRpcUiContext(deps). The closure-rich inline args (select/confirm/input/
  // editor/emit/getEditorText/setEditorText/getToolsExpanded/setToolsExpanded) all
  // close over session + state + emitters, and they're identical across the codebase
  // — perfect candidate for a single anchored unit. Returned uiContext is needed
  // by session.bindExtensions({ uiContext, mode: "rpc" }) below.
  const uiContext = provideRpcUiContext({
    context,
    session,
    state,
    emitPluginEvent,
    emitRendererEvent,
    questionAnswer,
    createOpenBuddyRpcUiContext,
  } as unknown as ProvideRpcUiContextDeps);
  // Capture which Pi extension registered which provider before bindExtensions
  // drains the pending queue. The tracker installed above captures live calls
  // but loses the extension path context; this snapshot preserves it so the UI

  for (const entry of piResourceLoader.getExtensions().runtime.pendingProviderRegistrations ?? []) {
    state.providerRegistry.set(entry.name, {
      id: entry.name,
      source: "pi-extension",
      extensionPath: entry.extensionPath,
      registeredAt: Date.now(),
    });
  }
  // Phase 5 — fire-and-forget; mutating IPCs await `state.extensionsBound`
  // before issuing their RPC. The first `agent:prompt` after a cold-start
  // session waits once for the bind to settle; subsequent turns don't
  // (the bind is already settled, the await is a microtask).
  state.extensionsBound = session
    .bindExtensions({ uiContext, mode: "rpc" })
    .catch((err) => {
      console.warn("[openbuddy] bindExtensions failed", err);
    });
  context.emit("pi/ready", { sessionId: session.sessionId, cwd });
  emitPluginEvent("session/created", { sessionId: session.sessionId, cwd });
  state.sessionUnsubscribe = piSessionRuntime.subscribe(buildSessionEventSubscriber({
    state,
    context,
    publicQueueItems: publicQueueItems as any,
    captureFileSnapshot,
    emitPluginEvent,
    emitRendererEvent,
    emitPiSessionEvent,
    eventNamespace,
    canonicalEventNamespace,
  } as unknown as HandleSessionEventDeps));

  try {
    if (!session.sessionManager.getSessionName()) session.setSessionName("OpenBuddy");
  } catch {
    // Session naming is optional across Pi releases.
  }

  emitPluginEvent("plugin/ready", { count: loader.list().length });
  // Stage G-1c: openbuddy-automation removed; automation is owned by
  // pi-background-tasks + pi-goal (passthrough). The Cordis ticker
  // (`automationsHandlers.startTicking`) is gone; pi-native
  // background-task scheduling fires directly from the pi session.
}

function init(opts?: { cwd?: string; sessionPath?: string; force?: boolean; traceId?: string; sessionId?: string }): Promise<void> {
  const traceId = opts?.traceId ?? generateTraceId();
  const sessionId = opts?.sessionId ?? state.session?.sessionId;
  hostReceivedLog("agent:init", traceId, sessionId);
  const promise = enqueueLifecycle(() => initialize(opts));
  initialisationPromise = promise;
  void promise.then(
    () => {
      if (initialisationPromise === promise) initialisationPromise = null;
      hostDispatchedLog("agent:init", traceId, sessionId);
    },
    (error) => {
      if (initialisationPromise === promise) initialisationPromise = null;
      hostFailedLog("agent:init", traceId, error);
    },
  );
  return promise;
}

function waitUntilReady(): Promise<void> {
  if (state.modelRuntime && state.context && state.session) return Promise.resolve();
  return initialisationPromise ?? init();
}

/**
 * Stage F-5: rebindSession moved to host-modules/session-rebind.ts.
 *
 * Pi-native fast session switch: reuse the warm host (plugin loader,
 * resource loader, typert, remote dispatcher, event log — none of which
 * depend on which session is open) and swap only the AgentSession via
 * PiSessionRuntime.replace(). Falls back to a full initialize() whenever
 * any cwd-scoped or preset-scoped host state differs from the currently
 * loaded one, because those are baked into the resource loader / preset
 * runtime and cannot be swapped cheaply.
 */
import { rebindSession } from "./host-modules/session-rebind";
export { rebindSession };
/**
 * Stage F-5: disposeInternal moved to host-modules/dispose-internal.ts.
 * The facade re-exports it as part of the lifecycle path.
 */
import { disposeInternal } from "./host-modules/dispose-internal";


export function dispose(): Promise<void> {
  return enqueueLifecycle(disposeInternal);
}

let rendererEventEmitter: ((channel: string, payload: unknown) => void) | null = null;
export function bindRendererEventEmitter(emitter: (channel: string, payload: unknown) => void): () => void {
  rendererEventEmitter = emitter;
  return () => { if (rendererEventEmitter === emitter) rendererEventEmitter = null; };
}
export function emitRendererEvent(channel: string, payload: unknown): void { rendererEventEmitter?.(channel, payload); }

/**
 * Sink the bridge forwards pi span events into. Always non-null after
 * `bindRendererEventEmitter` has run; we still null-guard so cold boot
 * (before the renderer registers) cannot crash the agent runtime.
 */
function telemetrySink(): OpenBuddyTelemetrySink | undefined {
  if (!rendererEventEmitter) return undefined;
  // Aegis mode forwards span events under the `wb.telemetry.*` namespace
  // so external WorkBuddy Aegis collectors consume the same span tree
  // without any additional schema translation. Off by default.
  const aegisMode = process.env.OPENBUDDY_AEGIS_MODE === "1";
  const inner = createMainTelemetrySink(
    (channel, payload) => emitRendererEvent(channel, payload),
    aegisMode ? { aegisMode: true } : {},
  );
  // When `OPENBUDDY_SPAN_TREE_EXPORTER=1` is set, mirror every event
  // into `~/.pi/openbuddy/span-tree.jsonl`. The exporter is a no-op
  // identity passthrough when the flag is unset, so the default
  // boot path is unchanged. This is the local stand-in for
  // `@braintrust/pi-extension` / `@raindrop-ai/pi-agent` per the
  // pi-plugin-reuse-batch decision table.
  return createStdoutSpanExporter(inner);
}

// Phase 8.3 Batch K: team runner factory moved to host-modules/team-runner.ts.
// Wrappers preserve the (modelRuntime, cwd, getModel) / (messages) call
// signatures used by initialize() (Cordis context.provide("teamRunner"))
// and host-modules/team-runner itself.
import {
  assistantMessageText as assistantMessageTextImpl,
  createTeamRunner as createTeamRunnerImpl,
} from "./host-modules/team-runner";
function assistantMessageText(messages: unknown) : string { return assistantMessageTextImpl(messages); }
function createTeamRunner(modelRuntime: ModelRuntime, cwd: string, getModel: () => Model<any> | undefined): TeamRunner {
  return createTeamRunnerImpl(modelRuntime, cwd, getModel);
}
/**
 * Stage F-5: resolveUiRequest moved to host-modules/ui-request-resolver.ts.
 */
import { resolveUiRequest } from "./host-modules/ui-request-resolver";
export { resolveUiRequest };


function getSession() { return getSessionImpl(); }
function onEvent(handler: EventHandler) { return onEventImpl(handler); }
function onPluginEvent(handler: PluginEventHandler) { return onPluginEventImpl(handler); }
/**
 * Phase 5 — getter for the `state.extensionsBound` Promise. IPC handlers
 * (`agent:prompt`, `agent:set-model`, …) call this and await the result
 * before issuing their own RPC, so they don't race with the
 * fire-and-forget `bindExtensions` in `rebindSession` /
 * `initialize`. Returns `null` when no bind is in flight (e.g. no
 * session loaded yet — callers should treat that as "nothing to wait
 * for" and proceed).
 */
function extensionsBound() { return state.extensionsBound; }
export async function prompt(text: string, options?: { traceId?: string; sessionId?: string }) { return promptImpl(text, options); }
async function promptContent(content: readonly PiPromptContentPart[], mode: "queue" | "steer" = "queue") { return promptContentImpl(content, mode); }
async function updateSessionQueue(sessionId: string, itemId: string, action: { kind: "edit" | "remove" | "steer"; content?: readonly PiPromptContentPart[] }) { return updateSessionQueueImpl(sessionId, itemId, action); }
async function readSessionAttachment(sessionId: string, attachmentId: string) { return readSessionAttachmentImpl(sessionId, attachmentId); }
async function steer(text: string, options?: { traceId?: string; sessionId?: string }) { return steerImpl(text, options); }
async function followUp(text: string, options?: { traceId?: string; sessionId?: string }) { return followUpImpl(text, options); }
export async function abort(options?: { traceId?: string; sessionId?: string }) { return abortImpl(options); }
async function setModel(modelId: string, options?: { traceId?: string; sessionId?: string }) { return setModelImpl(modelId, options); }
async function setThinkingLevel(level: OpenBuddyThinkingLevel, options?: { traceId?: string; sessionId?: string }) { return setThinkingLevelImpl(level, options); }
function getModel() { return getModelImpl(); }
function getModelRuntime() { return getModelRuntimeImpl(); }
function getCwd() { return getCwdImpl(); }

function listCommands() { return listCommandsImpl(); }

function listRunningTasks() { return listRunningTasksImpl(); }

type HarnessSubagentEntry = {
  kind: "child";
  id: string;
  mode: "one-shot" | "continuable";
  activity: "running" | "inactive";
  label?: string;
  hasChildren: boolean;
};

type HarnessJobView = {
  id: string;
  kind: string;
  label: string;
  sessionId?: string;
  status: "running" | "stopping" | "completed" | "killed" | "failed";
  startedAt: number;
  finishedAt?: number;
  detail?: string;
};



export async function listSubagentChildren(parentSessionId: string) : Promise<HarnessSubagentEntry[]> { return listSubagentChildrenImpl(parentSessionId); }

function listSessionJobs(sessionId: string) : HarnessJobView[] { return listSessionJobsImpl(sessionId); }

async function subagentHistory(
  parentSessionId: string,
  childSessionId: string,
  mode: "one-shot" | "continuable",
  beforeSeq?: number,
  maxMessages?: number,
): Promise<{ entries: unknown[]; hasMore: boolean }> {
  return subagentHistoryImpl(parentSessionId, childSessionId, mode, beforeSeq, maxMessages);
}

/**
 * Forwarder for ensureContinuableSubagent. Real implementation now lives in
 * `host-modules/deepseek/agent-runtime.ts` (Batch C 收尾).
 */
export async function ensureContinuableSubagent(
  parentSessionId: string,
  childSessionId: string,
): Promise<ContinuableSubagentRecord> {
  return ensureContinuableSubagentImpl(parentSessionId, childSessionId);
}

async function createDeepSeekAgentRuntime(options: {
  sessionId: string;
  cwd?: string;
  parentSession?: string;
  provider?: string;
  model?: string;
  maxTokens?: number;
  seed?: readonly unknown[];
  toolHooks?: DeepSeekPiToolHooks;
  signal?: AbortSignal;
  resume?: boolean;
}): Promise<DeepSeekPiAgentRuntime> {
  return (options.resume ? resumeDeepSeekAgentImpl : createDeepSeekAgentImpl)(options);
}

async function createDeepSeekAgent(options: Parameters<typeof createDeepSeekAgentRuntime>[0]) : Promise<DeepSeekPiAgentRuntime> { return createDeepSeekAgentImpl(options); }

async function resumeDeepSeekAgent(options: Parameters<typeof createDeepSeekAgentRuntime>[0]) : Promise<DeepSeekPiAgentRuntime> { return resumeDeepSeekAgentImpl(options); }

async function promptSubagent(
  parentSessionId: string,
  childSessionId: string,
  content: readonly PiPromptContentPart[],
): Promise<{ messageId: string }> {
  return promptSubagentImpl(parentSessionId, childSessionId, content);
}

async function interruptSubagent(parentSessionId: string, childSessionId: string): Promise<{ accepted: true }> {
  return interruptSubagentImpl(parentSessionId, childSessionId);
}

async function killTask(taskId: string) : Promise<void> { return killTaskImpl(taskId); }
async function authStatus() { return authStatusImpl(); }
async function providerCatalog() { return providerCatalogImpl(); }

async function loadSession(sessionId: string, cwd: string, options?: { traceId?: string; sessionId?: string }) : Promise<void> { return loadSessionImpl(sessionId, cwd, options); }

function sessionInfo(sessionId: string) { return sessionInfoImpl(sessionId); }

function sessionUsage(sessionId: string) { return sessionUsageImpl(sessionId); }

function sessionFile(sessionId: string) : string { return sessionFileImpl(sessionId); }

async function rewindSession(sessionId: string, targetPromptIndex: number, mode = "conversation"): Promise<void> {
  return rewindSessionImpl(sessionId, targetPromptIndex, mode);
}

function formatBranchSummaryText(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
  options?: { maxTotal?: number; maxUser?: number; maxAssistant?: number },
): string | null {
  return formatBranchSummaryTextImpl(messages, options);
}

async function reloadMcp(): Promise<void> {
  return reloadMcpImpl(state);
}

async function runMcpAuthorization(serverName: string, signal?: AbortSignal): Promise<{ status: "authenticated" } | { status: "setup_required" | "cancelled" | "failed"; error: string }> {
  return runMcpAuthorizationImpl(state, serverName, signal);
}

async function authorizeMcp(serverName: string, signal?: AbortSignal): Promise<{ status: "authenticated" } | { status: "setup_required" | "cancelled" | "failed"; error: string }> {
  return authorizeMcpImpl(state, serverName, signal);
}

function cancelMcpAuthorization(serverName: string): boolean {
  return cancelMcpAuthorizationImpl(state, serverName);
}

function mcpStatus(): Array<{ serverName: string; status: string; toolCount: number; emailProfile?: string; error?: string }> {
  return mcpStatusImpl(state);
}

function mcpCapabilityGovernance(): Array<{
  serverName: string;
  toolName: string;
  providerId: string;
  roomId: string;
  dataScopes: string[];
  allowedActions: string[];
  approval: "before_external_commit";
  status: string;
}> {
  return mcpCapabilityGovernanceImpl(state);
}

async function renameSession(sessionId: string, title: string, cwd: string) : Promise<void> { return renameSessionImpl(sessionId, title, cwd); }

async function deleteSession(sessionId: string, cwd: string) : Promise<void> { return deleteSessionImpl(sessionId, cwd); }

async function inspirationGenerate(category: string, count: number, cwd?: string): Promise<{ sessionId: string; category: string; count: number }> {
  return inspirationGenerateImpl(category, count, cwd);
}


// ----------------------------------------------------------------------------
// Batch A — provider/model persistence domain lives in host-modules/models-config
// (functions bound via the import above). agent-host keeps the public export
// `readModelsConfig` and the facade bindings for saveProvider/saveModel/
// deleteProvider/deleteModel; `installModelConfig` wires state+piHome at module
// load so these stay callable at runtime without agent-host owning the logic.
export const readModelsConfig = readModelsConfigImpl;
const saveProvider = saveProviderImpl;
const saveModel = saveModelImpl;
const deleteModel = deleteModelImpl;
const deleteProvider = deleteProviderImpl;
installModelConfig({ state, piHome });

// syncAuthCredentials: dead copy removed (canonical impl lives in
// host-modules/bootstrap/model-runtime.ts).

export async function listSessions(cwd: string) { return listSessionsImpl(cwd); }

async function updateSessionMetadata(sessionId: string, update: (metadata: {
  pinned: string[];
  archived: string[];
  experts: Record<string, { expertId: string; expertName: string; avatarLocal?: string }>;
}) => void): Promise<void> {
  return updateSessionMetadataImpl(sessionId, update);
}

async function clearSessionMetadata() : Promise<void> { return clearSessionMetadataImpl(); }

function harnessCursorPath() : string { return harnessCursorPathImpl(); }
function getHarnessCursorStore(): HarnessCursorStore {
  return getHarnessCursorStoreImpl();
}

function harnessResumeTokenPath() : string { return harnessResumeTokenPathImpl(); }

async function getHarnessResumeToken() : Promise<string | undefined> { return getHarnessResumeTokenImpl(); }

async function setHarnessResumeToken(token: unknown) : Promise<string | undefined> { return setHarnessResumeTokenImpl(token); }

async function readHarnessSessionCursors() : Promise<Record<string, number>> { return readHarnessSessionCursorsImpl(); }

async function writeHarnessSessionCursors(cursors: Record<string, unknown>) : Promise<void> { return writeHarnessSessionCursorsImpl(cursors); }

async function getHarnessSessionCursors() : Promise<Record<string, number>> { return getHarnessSessionCursorsImpl(); }

async function setHarnessSessionCursors(cursors: unknown) : Promise<Record<string, number>> { return setHarnessSessionCursorsImpl(cursors); }

/** Forwarder for setSessionPinned (real impl in host-modules/session-metadata.ts). */
async function setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean> {
  return setSessionPinnedImpl(sessionId, pinned);
}

async function setSessionArchived(sessionId: string, archived: boolean) : Promise<boolean> { return setSessionArchivedImpl(sessionId, archived); }

async function setAllArchived(archived: boolean): Promise<{ updated: number }> {
  return setAllArchivedImpl(archived);
}

async function setSessionExpert(sessionId: string, expert: { expertId: string; expertName: string; avatarLocal?: string } | null) : Promise<void> { return setSessionExpertImpl(sessionId, expert); }

/** Forwarder for getToolRegistry (real impl lives in tool-registry owner). */
function getToolRegistry(): PiToolRegistry {
  return state.toolRegistry;
}

async function listSkills(requestedCwd?: string | null) { return listSkillsImpl(requestedCwd); }

async function resourceInventory() { return resourceInventoryImpl(); }

/** Forwarder for listPlugins (real impl lives in plugin-state). */
function listPlugins(): PluginStatus[] {
  return state.loader?.list() ?? [];
}

async function refreshStoredPluginLayers(updateActiveProfile = false): Promise<void> {
  return refreshStoredPluginLayersImpl(updateActiveProfile);
}

async function listPluginInventory(): Promise<{
  entries: PluginStatus[];
  piExtensions: PiExtensionStatus[];
  renderers: RendererPluginManifestEntry[];
  packages: ProfilePackageInfo[];
  providers: ProviderInventoryEntry[];
  terminals: {
    backends: string[];
    sessionCount: number;
  };
}> {
  return listPluginInventoryImpl();
}

async function pluginSnapshot() : Promise<PluginSnapshot> { return pluginSnapshotImpl(); }

function pluginEvents(query?: { sessionId?: string; sinceSequence?: number; limit?: number }) : SessionEventRecord[] { return pluginEventsImpl(query); }

async function sessionBaselines(): Promise<Array<{ sessionId: string; lastSeq: number }>> {
  const latest = new Map<string, number>();
  for (const event of pluginEvents()) {
    if (!event.sessionId) continue;
    latest.set(event.sessionId, Math.max(latest.get(event.sessionId) ?? 0, event.sessionSequence ?? event.sequence));
  }
  try {
    for (const session of await listPersistedSessionInfosBare()) {
      latest.set(session.id, latest.get(session.id) ?? -1);
    }
  } catch {
    // The event log remains a valid fallback while Pi persistence is unavailable.
  }
  return [...latest.entries()].map(([sessionId, lastSeq]) => ({ sessionId, lastSeq }));
}

async function sessionProjectionBaseline(sessionId: string): Promise<{ asOfSeq: number; values: Readonly<Record<string, unknown>> }> {
  const rows = pluginEvents({ sessionId, limit: 2000 });
  const values = new Map<string, { value: unknown; sequence: number }>();
  let asOfSeq = -1;
  for (const row of rows) {
    const sequence = row.sessionSequence ?? row.sequence;
    asOfSeq = Math.max(asOfSeq, sequence);
    if (row.type !== "session/projection" || !row.payload || typeof row.payload !== "object") continue;
    const payload = row.payload as { key?: unknown; value?: unknown };
    if (typeof payload.key !== "string") continue;
    const previous = values.get(payload.key);
    if (!previous || sequence > previous.sequence) values.set(payload.key, { value: payload.value, sequence });
  }
  try {
    const header = await readPersistedSessionHeaderBare(sessionId);
    if ((header.title || header.name) && !values.has("title")) values.set("title", { value: header.title ?? header.name, sequence: asOfSeq });
  } catch {
    // A live in-memory session may not have a persisted header yet.
  }
  return { asOfSeq, values: Object.fromEntries([...values].map(([key, row]) => [key, row.value])) };
}

/** Toggle a single plugin on/off without restarting the agent session. */
async function setPluginEnabledInternal(id: string, enabled: boolean, transaction?: PluginTransactionContext) : Promise<PluginStatus | null> { return setPluginEnabledInternalImpl(id, enabled, transaction); }

/** Re-import and re-apply a plugin through the same loader lifecycle. */
async function reloadPluginInternal(id: string, transaction?: PluginTransactionContext) : Promise<PluginStatus | null> { return reloadPluginInternalImpl(id, transaction); }

/** Re-materialize the profile and reload Pi resources without recreating the AgentSession. */
async function reloadPiExtensionsInternal(transaction?: PluginTransactionContext) : Promise<PiExtensionStatus[]> { return reloadPiExtensionsInternalImpl(transaction); }

/** Update a plugin's runtime config; non-disabled entries go through Cordis update. */
async function updatePluginConfigInternal(id: string, config: unknown, transaction?: PluginTransactionContext) : Promise<PluginStatus | null> { return updatePluginConfigInternalImpl(id, config, transaction); }

/** Snapshot the persisted plugin-state overrides for UI / IPC inspection. */
async function getStoredPluginState() {
  return getStoredPluginStateImpl(state);
}

/** Clear a single plugin's persisted override (revert to profile defaults). */
async function resetPluginStateInternal(id: string, transaction?: PluginTransactionContext) { return resetPluginStateInternalImpl(id, transaction); }

function setPluginEnabled(id: string, enabled: boolean) : Promise<PluginStatus | null> { return setPluginEnabledImpl(id, enabled); }

function reloadPlugin(id: string) : Promise<PluginStatus | null> { return reloadPluginImpl(id); }

function reloadPiExtensions() : Promise<PiExtensionStatus[]> { return reloadPiExtensionsImpl(); }

async function reloadPiRuntime(reason = "internal-reload"): Promise<void> {
  return reloadPiRuntimeImpl(reason);
}

function updatePluginConfig(id: string, config: unknown) : Promise<PluginStatus | null> { return updatePluginConfigImpl(id, config); }

function resetPluginState(id: string) { return resetPluginStateImpl(id); }

function enqueuePluginStateTransaction<T>(
  kind: "plugin-enable" | "plugin-config" | "plugin-reset",
  target: string,
  operation: (transaction: PluginTransactionContext) => Promise<T>,
): Promise<T> {
  return enqueuePluginStateTransactionImpl(kind, target, operation);
}

export async function discoverRendererPluginManifest(): Promise<RendererPluginManifestEntry[]> {
  return discoverRendererPluginManifestImpl(state, profileArtifactModuleUrl);
}

async function discoverRendererPluginManifestUncached(): Promise<RendererPluginManifestEntry[]> {
  return discoverRendererPluginManifestUncachedImpl(state, profileArtifactModuleUrl);
}

async function listRendererPluginEntries(): Promise<RendererPluginManifestEntry[]> {
  return listRendererPluginEntriesImpl(state, discoverRendererPluginManifest);
}

async function rendererPluginBootGraph(): Promise<RendererPluginBootGraph> {
  return rendererPluginBootGraphImpl(state, discoverRendererPluginManifest);
}

async function resolveRendererPluginModule(moduleKey: string): Promise<string> {
  return resolveRendererPluginModuleImpl(state, moduleKey, discoverRendererPluginManifest);
}

async function newSession(cwd: string, modelId?: string, options?: { traceId?: string; sessionId?: string }): Promise<{ sessionId?: string; sessionFile?: string; cwd: string; model?: { provider?: string; id?: string } }> {
  const traceId = options?.traceId ?? generateTraceId();
  const sessionId = options?.sessionId;
  hostReceivedLog("agent:new-session", traceId, sessionId);
  try {
    // Warm-host fast path. The previous implementation called
    // `init({ cwd, force: true })`, which disposed the entire agent host
    // and re-bootstrapped all 17 host modules on every "新建会话" click
    // (~2-5s wall-clock). The warm-host runtime (plugin loader, resource
    // loader, typert, remote dispatcher, event log) is session-agnostic,
    // so we only need to swap the AgentSession:
    //
    //   1. `init({ cwd })` is a no-op when the warm host already matches
    //      the cwd; on cold start it does the full init exactly once.
    //   2. Create a brand-new (empty) JSONL session file via
    //      SessionManager.create.
    //   3. `rebindSession(path, cwd)` calls piSessionRuntime.replace —
    //      ~50ms hot path. It still falls back to a full initialize() if
    //      cwd or agent-preset scope actually differs from the currently
    //      loaded host, so the correctness guarantees of the old code
    //      are preserved.
    await init({ cwd });
    const newManager = SessionManager.create(cwd, piSessionDir(cwd));
    const newSessionPath = newManager.getSessionFile();
    if (!newSessionPath) {
      throw new Error("SessionManager.create did not return a session file path");
    }
    await rebindSession(newSessionPath, cwd);
    // Mirror the original initialize()'s "fresh session" tail so the new
    // session shows up in listAllPiSessions() on next refresh and the
    // active preset is stamped onto the file.
    const session = state.session;
    if (session) {
      await persistPiSessionHeaderImpl(session);
      const mountedPresetId = state.presetSessionRuntime?.id;
      if (mountedPresetId) {
        try {
          session.sessionManager.appendCustomEntry("openbuddy/agent-preset", { id: mountedPresetId, version: 1 });
        } catch (error) {
          console.warn("[openbuddy] failed to stamp preset on new session", error);
        }
      }
    }
    if (modelId?.trim()) await setModel(modelId.trim());
    const result = {
      sessionId: session?.sessionId,
      sessionFile: session?.sessionFile,
      cwd,
      model: session?.model ? { provider: session.model.provider, id: session.model.id } : undefined,
    };
    hostDispatchedLog("agent:new-session", traceId, result.sessionId ?? sessionId);
    return result;
  } catch (error) {
    hostFailedLog("agent:new-session", traceId, error);
    throw error;
  }
}

/**
 * Server-side coalescing for `agent:ensure-new-session`.
 *
 * Two concurrent callers (e.g. user double-clicks "新建任务", or HomePage +
 * extension methods both racing for a fresh session) used to each kick off
 * a full `newSession` warm-host pipeline. The pipeline is idempotent on the
 * warm host (the second caller reuses the in-memory AgentSession), but it
 * still pays for `SessionManager.create()` + `rebindSession()` + a fresh JSONL
 * write. Coalescing by `${cwd}\0${modelId}` returns the same Promise to
 * concurrent callers so they share one round-trip and one JSONL file.
 *
 * Mirrors `pi-web/lib/rpc-manager.ts:startRpcSession` coalescing semantics.
 */
const inFlightEnsureNewSession = new Map<string, Promise<{ sessionId?: string; sessionFile?: string; cwd: string; model?: { provider?: string; id?: string } }>>();

async function ensureNewSession(cwd: string, modelId?: string, options?: { traceId?: string }): Promise<{ sessionId?: string; sessionFile?: string; cwd: string; model?: { provider?: string; id?: string } }> {
  const key = `${cwd} ${modelId ?? ""}`;
  const existing = inFlightEnsureNewSession.get(key);
  if (existing) return existing;

  const traceId = options?.traceId ?? generateTraceId();
  const promise = newSession(cwd, modelId, { traceId })
    .finally(() => {
      inFlightEnsureNewSession.delete(key);
    });
  inFlightEnsureNewSession.set(key, promise);
  return promise;
}

async function captureFileSnapshot(sessionId: string, toolCallId: string, toolName: string, args: unknown) {
  return captureFileSnapshotImpl(state, sessionId, toolCallId, toolName, args);
}

export function reportActivePluginTransaction(
  transactionId: string,
  surface: string,
  details?: Record<string, unknown>,
): { ok: true; transactionId: string; surface: string } | { ok: false; error: string } {
  return reportActivePluginTransactionImpl(transactionId, surface, details);
}

export function listActivePluginTransactions(): Array<{ transactionId: string; kind: string; target: string; requiredReceipts: readonly string[] }> {
  return listActivePluginTransactionsImpl();
}

export const agentHost = buildAgentHostFacade({
  // Inline lambdas pre-bound in this module (they close over `state` which lives
  // in module scope and cannot be passed across the module boundary).
  getContext: () => state.context,
  listAgentPresets: (cwd?: string | null) => piResources.listAgentPresets(cwd ?? state.cwd),
  currentAgentPreset: () => state.presetSessionRuntime?.id ?? null,
  listTools: () => state.toolRegistry.list().map((tool) => ({ name: tool.name, label: tool.label, description: tool.description })),
  readSessionEntries: async (sessionId: string) => {
    if (state.session?.sessionId === sessionId) return state.session.sessionManager.getEntries();
    return readPersistedSessionEntriesImpl(sessionId);
  },
  registerRemote: (contribution: unknown) => state.remoteDispatcher.register(serializeRemoteContribution(contribution), remoteServiceContext()),
  unregisterRemote: (packageName: unknown) => state.remoteDispatcher.unregister(packageName as string),
  // Direct function references — these are defined elsewhere in this module.
  init,
  waitUntilReady,
  dispose,
  getSession,
  extensionsBound,
  onEvent,
  onPluginEvent,
  prompt,
  promptContent,
  steer,
  followUp,
  abort,
  setModel,
  setThinkingLevel,
  getModel,
  getModelRuntime,
  getCwd,
  selectAgentPreset,
  authStatus,
  providerCatalog,
  listPlugins,
  pluginInventory: listPluginInventory,
  pluginSnapshot,
  pluginEvents,
  setPluginEnabled,
  reloadPlugin,
  reloadPiExtensions,
  reloadPiRuntime,
  updatePluginConfig,
  getStoredPluginState,
  resetPluginState,
  getToolRegistry,
  profilePackages,
  installDefaultPiPackages,
  installProfileBundle,
  removeProfileBundle,
  listRendererPluginEntries,
  rendererPluginBootGraph,
  resolveRendererPluginModule,
  listProfileRemoteContributions,
  ensureTypertReady,
  newSession,
  ensureNewSession,
  loadSession,
  sessionInfo,
  sessionUsage,
  sessionFile,
  rewindSession,
  reloadMcp,
  authorizeMcp,
  cancelMcpAuthorization,
  mcpStatus,
  mcpCapabilityGovernance,
  resolveUiRequest,
  renameSession,
  deleteSession,
  setSessionPinned,
  setSessionArchived,
  setAllArchived,
  setSessionExpert,
  clearSessionMetadata,
  saveProvider,
  saveModel,
  deleteProvider,
  deleteModel,
  listSessions,
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  insertWorkspaceSessionBefore,
  archiveWorkspaceSession,
  invokeRemote,
  deepSeekCordisSnapshot,
  deepSeekPiBridgeDescription,
  invokeDeepSeekCordis,
  invokeConnection,
  sessionBaselines,
  sessionProjectionBaseline,
  listCommands,
  listSkills,
  resourceInventory,
  pluginReadiness,
  listRunningTasks,
  listSubagentChildren,
  listSessionJobs,
  subagentHistory,
  promptSubagent,
  interruptSubagent,
  killTask,
  inspirationGenerate,
  getHarnessSessionCursors,
  setHarnessSessionCursors,
  getHarnessResumeToken,
  setHarnessResumeToken,
  updateSessionQueue,
  readSessionAttachment,
  reportActivePluginTransaction,
  listActivePluginTransactions,
  // Keep the workbench lifecycle methods on the public facade. These methods
  // are intentionally safe before Pi session initialization so the renderer
  // can establish its scope during cold boot.
  syncWorkbenchScope,
  bindCurrentSessionToTenant: () => bindCurrentSessionToTenant(),
  // Phase 8.3 Batch D-11: pi-web RPC capability forwards. These 12 thin
  // wrappers let the IPC layer talk to OpenBuddy `agentHost` as if it were
  // a pi-web `RpcClient` — the renderer side can adopt pi-web patterns
  // (compact, fork, getTree, etc.) without changes.
  compact,
  setAutoCompaction,
  setAutoRetry,
  abortRetry: abortRetryFn,
  abortBash: abortBashFn,
  setSteeringMode: setSteeringModeFn,
  setFollowUpMode: setFollowUpModeFn,
  getSessionStats: getSessionStatsFn,
  getAvailableThinkingLevels: getAvailableThinkingLevelsFn,
  forkSession: forkSessionFn,
  getSessionTree: getSessionTreeFn,
  getCompactionSettings: getCompactionSettingsFn,
});


/**
 * Stage F-5: syncWorkbenchScope moved to host-modules/workbench-scope.ts.
 */
import { syncWorkbenchScope } from "./host-modules/workbench-scope-sync";
export { syncWorkbenchScope };

export type { AgentSession };

let quitting = false;
let disposedForQuit = false;

app.on("before-quit", (event) => {
  if (disposedForQuit) return;
  if (quitting) {
    event.preventDefault();
    return;
  }
  quitting = true;
  event.preventDefault();
  void dispose().finally(() => {
    disposedForQuit = true;
    app.exit(0);
  });
});

// Filesystem capability policy — single source of truth for whether the
// harness may run filesystem smoke. Delegates to the canonical helper under
// evals/node so Node.mjs runners and the Electron main process return the
// same answer. Keep this name stable; callers grep for it.
export type FilesystemCapabilityPolicy = {
  allowed: boolean;
  reason: string;
  source: "env" | "manifest" | "default";
};
export const DEFAULT_FILESYSTEM_POLICY = "disabled-by-policy";
export function evaluateFilesystemCapabilityPolicy(
  overrides: { env?: NodeJS.ProcessEnv; manifestPolicy?: string } = {},
): FilesystemCapabilityPolicy {
  const helper = require("../../evals/node/_filesystem-capability-policy.mjs");
  return helper.evaluateFilesystemCapabilityPolicy(overrides);
}
