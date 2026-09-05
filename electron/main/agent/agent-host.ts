import { app, shell } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { readFile, writeFile, mkdir, rename, rm, unlink, readdir, stat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { agentHome } from "./agent-home";
import { casdoorAuth } from "../casdoor/casdoor-auth";
import { randomUUID } from "node:crypto";
import { resolve, join, dirname, relative, sep, isAbsolute, basename } from "node:path";
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
  discoverRendererPluginEntries,
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
  openBuddyDeepSeekRendererEntries,
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
import { deepSeekCapabilityDefinitions, deepSeekCapabilityPackageForService, deepSeekCapabilityRemote } from "../deepseek/deepseek-capabilities";
import { SessionEventLog, type SessionEventRecord } from "../session/session-event-log";
import { RemoteDispatcher, type RemoteContribution, type RemoteDescriptor } from "../harness/remote-dispatch";
import { invokeRemoteWithGateway } from "../harness/remote-invocation";
import { serializeRemoteContribution } from "@openbuddy/plugin-host";
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
  session: null,
  cwd: null,
  model: undefined,
  sessionUnsubscribe: null,
  /**
   * Phase 5 — see `_state-shape.ts:extensionsBound`. Initialized to null
   * because no bind is in flight at module load; `rebindSession` /
   * `initialize` set it to the live Promise returned by `bindExtensions`.
   */
  extensionsBound: null,
  eventHandlers: new Set(),
  pluginEventHandlers: new Set(),
  context: null,
  loader: null,
  deepSeekCordisRuntime: null,
  deepSeekCordisSnapshot: null,
  deepSeekPiToolSync: null,
  sessionEventLog: null,
  harnessCursorStore: undefined,
  scopeKey: undefined,
  sessionTenantBindings: undefined,
  eventSequence: 0,
  sessionSequences: new Map(),
  toolRegistry: createToolRegistry(),
  pluginState: null,
  modelRuntime: null,
  piResourceLoader: null,
  piRefreshPromise: Promise.resolve(),
  profileWatchers: [],
  profileReloadTimer: null,
  profileReloadPromise: Promise.resolve(),
  profileArtifactGeneration: 0,
  activePluginTransactions: new Map<string, PluginTransactionContext>(),
  rendererPluginManifestCache: null,
  profileOptions: null,
  profileBundle: null,
  activePluginProfile: null,
  profilePackageJson: undefined,
  profilePackagePaths: [],
  profilePiExtensions: [],
  profilePiPackagePaths: [],
  profilePiResourcePaths: { extensions: [], skills: [], prompts: [], themes: [] },
  piNativeResourcePaths: { skills: [], prompts: [], themes: [] },
  piMarketplaceResourcePaths: { extensions: [], skills: [], prompts: [], themes: [] },
  piMarketplaceAgentFiles: [],
  piExtensionPaths: [],
  piExtensionFactories: [],
  hookConfigs: [],
  piExtensionStatuses: [],
  piExtensionOverrides: {},
  baseProfile: null,
  storedLayers: [],
  toolRegistryRevision: 0,
  pendingUiRequests: new Map(),
  hookPermissionSessionRules: new Map(),
  extensionEditorText: new Map(),
  extensionToolsExpanded: new Map(),
  runningTasks: new Map(),
  jobsRegistry: new Map(),
  continuableSubagents: new Map(),
  deepSeekAgents: new Map(),
  capabilityEventBridgeUnsubscribe: null,
  typertRegistryUnsubscribe: null,
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
  profileRemoteContributions: new Map(),
  profileTypertContributions: new Map(),
  pluginCommitGeneration: 0,
  lastPluginCommitMarker: undefined,
  pluginReadiness: { phase: "idle", generation: 0 },
  providerRegistry: new Map(),
  queueMirror: null,
  attachmentStore: new SessionAttachmentStore(join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent"), "openbuddy-attachments")),
  presetSessionRuntime: null,
  terminalRuntime: null,
  subprocessRuntime: null,
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

export function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

export function piHome(): string {
  // Shared resolver with pi-resources.ts so MCP config, session cursors, and
  // model/auth JSON all resolve to the same directory.
  return agentHome();
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
  const plugins = await piResources.listPlugins(state.cwd);
  const marketplaceRoots = new Set(plugins.map((plugin) => resolve(plugin.root)));
  const profileRoots = new Set([...state.profilePackagePaths, ...state.profilePiPackagePaths].map((path) => resolve(path)));
  state.piExtensionStatuses = state.piExtensionStatuses.map((status) => {
    const root = status.sourceBaseDir ? resolve(status.sourceBaseDir) : undefined;
    const plugin = plugins.find((entry) => root === resolve(entry.root) || (status.source ? isPathWithin(entry.root, status.source) : false));
    if (!plugin) return status;
    if (!plugin.enabled) {
      return {
        ...status,
        state: "disabled" as const,
        managed: true,
        packageName: plugin.name,
        ...(plugin.version ? { version: plugin.version } : {}),
        sourceScope: plugin.scope,
        sourceOrigin: "package" as const,
        sourceBaseDir: plugin.root,
        health: "degraded" as const,
        disabledReason: "user" as const,
        commands: [],
        toolCount: 0,
        error: undefined,
      };
    }
    const nextStatus: PiExtensionStatus = {
      ...status,
      managed: true,
      packageName: plugin.name,
      ...(plugin.version ? { version: plugin.version } : {}),
      ...(plugin.version ? { version: plugin.version } : {}),
      sourceScope: plugin.scope,
      sourceOrigin: "package" as const,
      sourceBaseDir: plugin.root,
      health: status.health ?? (status.state === "failed" ? "failed" : "healthy"),
    };
    return nextStatus;
  }).filter((status) => {
    if (!status.sourceBaseDir) return true;
    const root = resolve(status.sourceBaseDir);
    if (profileRoots.has(root)) return true;
    if (marketplaceRoots.has(root)) return true;
    return status.managed === false;
  });
  // Stat each disabled plugin\'s `extensions/` directory in parallel rather
  // than serially through `statSync`, which would block the main-process
  // event loop on every startup.
  const disabledPlugins = plugins.filter((entry) => !entry.enabled);
  const extensionsPresence = await Promise.all(
    disabledPlugins.map(async (plugin) => {
      const packageRoot = resolve(plugin.root);
      let isDir = false;
      try {
        isDir = (await stat(join(packageRoot, "extensions"))).isDirectory();
      } catch {
        isDir = false;
      }
      return { plugin, packageRoot, hasExtensions: isDir };
    }),
  );
  for (const { plugin, packageRoot, hasExtensions } of extensionsPresence) {
    if (!hasExtensions || state.piExtensionStatuses.some((status) => status.sourceBaseDir && resolve(status.sourceBaseDir) === packageRoot)) continue;
    state.piExtensionStatuses.push({
      id: plugin.id ?? plugin.name,
      name: plugin.name,
      kind: "pi",
      state: "disabled",
      source: packageRoot,
      builtIn: false,
      managed: true,
      packageName: plugin.name,
      sourceScope: plugin.scope,
      sourceOrigin: "package",
      sourceBaseDir: packageRoot,
      health: "degraded",
      disabledReason: "user",
      commands: [],
      toolCount: 0,
      hookCount: plugin.hookCount,
    });
  }
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

export function piSessionDir(cwd: string): string {
  const encoded = resolve(cwd).replace(/^[/\\]/, "").replace(/[\\/:]/g, "-");
  return join(piHome(), "sessions", `--${encoded}--`);
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
  if (state.profileReloadTimer) clearTimeout(state.profileReloadTimer);
  state.profileReloadTimer = null;
  for (const watcher of state.profileWatchers) watcher.close();
  state.profileWatchers = [];
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

export async function rollbackPiProfile(snapshot: PiProfileSnapshot, capturedServices = new Map<string, unknown>()): Promise<void> {
  restorePiProfileSnapshot(snapshot);
  await startProfileWatchers();
  if (snapshot.activePluginProfile) await state.loader?.replaceProfile(snapshot.activePluginProfile);
  const rollbackProfile = snapshot.activePluginProfile;
  await syncDeepSeekCordisRuntime(deepSeekCoreRuntimeEntries(composePluginPatches(
    rollbackProfile?.entries ?? [],
    rollbackProfile?.patches ?? [],
  )));
  await reconcileProfileArtifacts();
  await piRuntimeCoordinator.reload("profile-rollback");
  await reloadMcp();
  await restoreDeepSeekCapabilityServices();
  restoreCapturedContextServices(capturedServices);
  reportPiExtensionErrors();
}

export function scheduleProfileReload(): void {
  if (!state.loader) return;
  if (state.profileReloadTimer) clearTimeout(state.profileReloadTimer);
  state.profileReloadTimer = setTimeout(() => {
    state.profileReloadTimer = null;
    state.profileReloadPromise = pluginLifecycleQueue.enqueue("profile-reload", "profile", async (transaction) => {
      const previous = capturePiProfileSnapshot();
      const capturedServices = captureReloadableContextServices();
      try {
      transaction.phase("prepare", "profile");
      const materialized = state.profileOptions ? await materializeOpenBuddyProfile(state.profileOptions) : null;
      const runtimeBundle = materialized ? await runtimeProfileBundle(materialized.bundle) : null;
        if (materialized) {
          state.profilePackageJson = materialized.profile.packageJson;
          state.profilePackagePaths.splice(0, state.profilePackagePaths.length, ...materialized.profile.packagePaths);
        }
        if (materialized) {
          state.profilePiExtensions = materialized.profile.piExtensions;
          state.profilePiPackagePaths.splice(0, state.profilePiPackagePaths.length, ...materialized.profile.piPackagePaths);
          setProfilePiResourcePaths(materialized.profile.piResourcePaths);
          configurePiExtensions(materialized.profile.piExtensions);
          await startProfileWatchers();
        }
        const baseProfile = state.baseProfile ?? createOpenBuddyProfile();
        const overrideLayers = await readOverridePatches();
        if (overrideLayers === undefined) throw new Error("openbuddy-profile: override patch reload was rejected");
        await state.loader?.replaceProfile({
          entries: [...baseProfile.entries, ...(runtimeBundle?.entries ?? [])],
          patches: [
            ...(baseProfile.patches ?? []),
            ...(runtimeBundle?.patches ?? []),
            ...state.storedLayers,
            ...overrideLayers,
          ],
        });
        const nextProfileEntries = [...baseProfile.entries, ...(runtimeBundle?.entries ?? [])];
        const nextProfilePatches = [
          ...(baseProfile.patches ?? []),
          ...(runtimeBundle?.patches ?? []),
          ...state.storedLayers,
          ...overrideLayers,
        ];
        transaction.phase("cordis", "deepseek-cordis");
        await syncDeepSeekCordisRuntime(deepSeekCoreRuntimeEntries(composePluginPatches(nextProfileEntries, nextProfilePatches)));
        transaction.receipt("cordis", { profileEntries: nextProfileEntries.length });
        state.activePluginProfile = {
          entries: [...baseProfile.entries, ...(runtimeBundle?.entries ?? [])],
          patches: [
            ...(baseProfile.patches ?? []),
            ...(runtimeBundle?.patches ?? []),
            ...state.storedLayers,
            ...overrideLayers,
          ],
        };
        state.profileBundle = runtimeBundle ?? null;
        const capturedCapabilities = captureDeepSeekCapabilityServices();
        transaction.phase("artifacts", "typert-remote");
        await reconcileProfileArtifacts();
        transaction.receipt("artifacts", {
          remote: state.profileRemoteContributions.size,
          typert: state.profileTypertContributions.size,
        });
        await refreshHookConfigs();
        if (state.session && state.piResourceLoader) {
          transaction.phase("pi", "pi-resource-loader");
          await piRuntimeCoordinator.reload("profile-reload");
          transaction.phase("mcp", "mcp");
          await reloadMcp();
          transaction.receipt("mcp");
          await restoreDeepSeekCapabilityServices(capturedCapabilities);
          restoreCapturedContextServices(capturedServices);
          reportPiExtensionErrors();
          transaction.receipt("pi", { extensions: state.piExtensionStatuses.filter((entry) => entry.state === "loaded").length });
        }
        transaction.phase("renderer", "renderer-module-graph");
        transaction.requireReceipt("renderer");
        transaction.receipt("rollback-previous", {
          piEntries: previous.piExtensionStatuses.length,
          capturedServices: capturedServices.size,
        });
        await transaction.awaitSurfaceReceipt("renderer", 5000);
        emitPluginEvent("profile/reloaded", {
          name: materialized?.profile.name ?? "desktop",
          piExtensions: materialized?.profile.piExtensions.map((extension) => extension.id) ?? [],
        });
      } catch (error) {
        try {
          transaction.phase("rollback", "profile");
          await rollbackPiProfile(previous, capturedServices);
          emitPluginEvent("profile/reload-failed", { error: String(error), rolledBack: true });
        } catch (rollbackError) {
          emitPluginEvent("profile/reload-failed", { error: String(error), rolledBack: false, rollbackError: String(rollbackError) });
          throw error;
        }
        throw markPluginTransactionRolledBack(error);
      }
    });
    // Watcher-triggered reloads have no caller waiting on the promise. Attach
    // a rejection handler without replacing the shared promise, so manual
    // callers still receive the transaction failure and can retry explicitly.
    void state.profileReloadPromise.catch(() => undefined);
  }, 100);
}

async function discoverProfileRemoteContributions(): Promise<Map<string, RemoteContribution>> {
  const packageJsonByName = await artifactPackageJsonByName(state.profilePackagePaths, state.cwd);
  const additionalPackages = [...new Set([
    ...packageJsonByName.keys(),
    ...(state.loader
      ? [...state.loader.entries()]
        .map((entry) => packageRootForLoaderSpecifierImpl(entry.options.name, packageJsonByName.keys()))
        .filter((name): name is string => Boolean(name))
      : []),
  ])];
  const resolvers = createProfileArtifactResolvers({ packageJsonByName, profilePackageJson: state.profilePackageJson });
  const entries = await discoverRemoteManifestEntries({
    additionalPackages,
    resolvePackageJson: resolvers.resolvePackageJson,
    resolveModule: async (specifier, packageJson) => profileArtifactModuleUrl(await resolvers.resolveModule(specifier, packageJson)),
  });
  const result = new Map<string, RemoteContribution>();
  for (const entry of entries) {
    if (!entry.moduleUrl) throw new Error(`openbuddy-remote: module URL missing for ${entry.packageName}`);
    const module = await import(/* @vite-ignore */ entry.moduleUrl);
    const exported = module.TYPERT_REMOTE ?? module.default;
    if (!exported || typeof exported !== "object" || Array.isArray(exported)) {
      throw new Error(`openbuddy-remote: ${entry.packageName} remote artifact has no TYPERT_REMOTE export`);
    }
    const packageName = (exported as { package?: unknown }).package;
    if (packageName !== entry.packageName) {
      throw new Error(`openbuddy-remote: ${entry.packageName} artifact names package ${JSON.stringify(packageName)}`);
    }
    const contribution = normalizePublishedRemoteContribution(serializeRemoteContribution(exported) as RemoteContribution);
    result.set(entry.packageName, contribution);
  }
  return result;
}

function normalizePublishedRemoteContribution(contribution: RemoteContribution): RemoteContribution {
  const definition = deepSeekCapabilityDefinitions.find((candidate) => candidate.packageName === contribution.package);
  if (!definition) return contribution;
  const descriptors = [...contribution.descriptors];
  const endpoints = new Set(descriptors.map((descriptor) => `${descriptor.namespace}/${descriptor.method}`));
  for (const descriptor of [...descriptors]) {
    const remoteExportMatch = /^remoteExport([A-Z][A-Za-z0-9_$.-]*)$/.exec(descriptor.method);
    const canonicalMethod = remoteExportMatch
      ? `${remoteExportMatch[1]![0]!.toLowerCase()}${remoteExportMatch[1]!.slice(1)}`
      : descriptor.implementation?.startsWith("remoteExport")
        ? descriptor.implementation.replace(/^remoteExport([A-Z])/, (_, first: string) => first.toLowerCase())
        : undefined;
    if (!canonicalMethod || !definition.methods.includes(canonicalMethod)) continue;
    const canonical = { ...descriptor, method: canonicalMethod, implementation: canonicalMethod, service: definition.serviceKey };
    const canonicalEndpoint = `${canonical.namespace}/${canonical.method}`;
    const existingCanonical = descriptors.find((candidate) => `${candidate.namespace}/${candidate.method}` === canonicalEndpoint);
    if (existingCanonical) {
      Object.assign(existingCanonical, { implementation: canonicalMethod, service: definition.serviceKey });
    } else {
      descriptors.push(canonical);
      endpoints.add(canonicalEndpoint);
    }
    const alias = { ...descriptor, implementation: canonicalMethod, service: definition.serviceKey };
    const aliasEndpoint = `${alias.namespace}/${alias.method}`;
    if (!endpoints.has(aliasEndpoint)) {
      descriptors.push(alias);
      endpoints.add(aliasEndpoint);
    } else {
      const existingAlias = descriptors.find((candidate) => `${candidate.namespace}/${candidate.method}` === aliasEndpoint);
      if (existingAlias) Object.assign(existingAlias, { implementation: canonicalMethod, service: definition.serviceKey });
    }
  }
  return { ...contribution, descriptors };
}

async function discoverProfileTypertContributions(): Promise<Map<string, TypertHostContribution>> {
  const packageJsonByName = await artifactPackageJsonByName(state.profilePackagePaths, state.cwd);
  const resolvers = createProfileArtifactResolvers({ packageJsonByName, profilePackageJson: state.profilePackageJson });
  const entries = await discoverTypertManifestEntries({
    additionalPackages: [...new Set([
      ...packageJsonByName.keys(),
      ...(state.loader
        ? [...state.loader.entries()]
          .map((entry) => packageRootForLoaderSpecifierImpl(entry.options.name, packageJsonByName.keys()))
          .filter((name): name is string => Boolean(name))
        : []),
    ])],
    resolvePackageJson: resolvers.resolvePackageJson,
    resolveModule: async (specifier, packageJson) => profileArtifactModuleUrl(await resolvers.resolveModule(specifier, packageJson)),
  });
  const result = new Map<string, TypertHostContribution>();
  for (const entry of entries) {
    if (!entry.moduleUrl) throw new Error(`openbuddy-typert: module URL missing for ${entry.packageName}`);
    const module = await import(/* @vite-ignore */ entry.moduleUrl);
    result.set(entry.packageName, validateTypertHostContribution(entry.packageName, module.TYPERT ?? module.default));
  }
  return result;
}

type ProfileTypertRegistration = {
  contribution: TypertHostContribution;
  dispose: () => void;
  remoteDispose?: () => void;
};

function disposeProfileTypertRegistrations(registrations: Iterable<ProfileTypertRegistration>): void {
  for (const entry of [...registrations].reverse()) {
    entry.remoteDispose?.();
    entry.dispose();
  }
}

function clearProfileArtifacts(): void {
  disposeProfileTypertRegistrations(state.profileTypertContributions.values());
  state.profileTypertContributions.clear();
  for (const packageName of state.profileRemoteContributions.keys()) state.remoteDispatcher.unregister(packageName);
  state.profileRemoteContributions.clear();
}

function installProfileArtifacts(
  remoteContributions: Map<string, RemoteContribution>,
  typertContributions: Map<string, TypertHostContribution>,
): void {
  const typert = state.context?.get("typert") as { register?: (contribution: unknown) => () => void } | undefined;
  if (!typert?.register && typertContributions.size > 0) throw new Error("openbuddy-typert: registry is unavailable");

  const installedRemote = new Map<string, RemoteContribution>();
  const installedTypert = new Map<string, ProfileTypertRegistration>();
  try {
    for (const contribution of remoteContributions.values()) {
      state.remoteDispatcher.register(contribution, remoteServiceContext());
      installedRemote.set(contribution.package, contribution);
    }
    if (typert?.register) {
      for (const contribution of typertContributions.values()) {
        const remote = remoteContributions.get(contribution.package);
        let remoteDispose: (() => void) | undefined;
        if (!remote && contribution.invocations.length > 0) {
          const generated = serializeRemoteContribution({ package: contribution.package, descriptors: contribution.invocations }) as RemoteContribution;
          state.remoteDispatcher.register(generated, remoteServiceContext());
          remoteDispose = () => { state.remoteDispatcher.unregister(contribution.package); };
        }
        installedTypert.set(contribution.package, {
          contribution,
          dispose: typert.register(contribution),
          remoteDispose,
        });
      }
    }
  } catch (error) {
    disposeProfileTypertRegistrations(installedTypert.values());
    for (const packageName of installedRemote.keys()) state.remoteDispatcher.unregister(packageName);
    throw error;
  }
  state.profileRemoteContributions = installedRemote;
  state.profileTypertContributions = installedTypert;
}

export async function reconcileProfileArtifacts(): Promise<void> {
  state.profileArtifactGeneration += 1;
  state.rendererPluginManifestCache = null;
  const typert = state.context?.get("typert") as {
    register?: (contribution: unknown) => () => void;
    subscribe?: (listener: (change: unknown) => void) => () => void;
    beginTransaction?: () => { commit: () => void; rollback: () => void };
  } | undefined;
  if (!state.typertRegistryUnsubscribe && typert?.subscribe) {
    state.typertRegistryUnsubscribe = typert.subscribe((change) => {
      emitPluginEvent("typert/registry-changed", change);
    });
  }
  // Import and validate every generated artifact before touching the live registries.
  const [nextRemote, nextTypert] = await Promise.all([
    discoverProfileRemoteContributions(),
    discoverProfileTypertContributions(),
  ]);
  const transaction = typert?.beginTransaction?.();
  const previousRemote = new Map(state.profileRemoteContributions);
  const previousTypert = new Map(state.profileTypertContributions);
  clearProfileArtifacts();
  try {
    installProfileArtifacts(nextRemote, nextTypert);
    transaction?.commit();
  } catch (error) {
    try {
      clearProfileArtifacts();
      installProfileArtifacts(previousRemote, new Map([...previousTypert].map(([packageName, entry]) => [packageName, entry.contribution])));
      transaction?.rollback();
    } catch (rollbackError) {
      transaction?.rollback();
      throw new AggregateError([error, rollbackError], "openbuddy-profile: artifact reconciliation and rollback failed");
    }
    throw error;
  }
}

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

async function installProfileBundle(sourcePath: string): Promise<ProfilePackageInfo> {
  return installProfileBundleImpl(sourcePath);
}

async function removeProfileBundle(name: string): Promise<void> {
  return removeProfileBundleImpl(name);
}

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
  stopProfileWatchers();
  const targets = profileResourceWatchPaths();
  // Probe each target asynchronously so the main process event loop stays
  // free during profile reloads. `stat()` with `throwIfNoEntry: false`
  // would require an extra try/catch per call, so we use `stat()` and
  // normalize the failure shape below.
  const probes = await Promise.all(
    targets.map(async (target) => {
      try {
        const stats = await stat(target);
        return { target, stats };
      } catch {
        return { target, stats: null };
      }
    }),
  );
  for (const { target, stats } of probes) {
    if (!stats) continue;
    try {
      state.profileWatchers.push(watch(target, { persistent: false, recursive: stats.isDirectory() }, () => scheduleProfileReload()));
    } catch (error) {
      console.warn(`[openbuddy] failed to watch ${target}:`, error);
    }
  }
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
import { installHostModules } from "./host-modules/bootstrap/install-host-modules";
import { buildAgentHostFacade } from "./host-modules/bootstrap/build-agent-host-facade";
import type { InstallHostModuleDeps } from "./host-modules/bootstrap/install-host-modules";

import { buildSessionEventSubscriber } from "./host-modules/bootstrap/handle-session-event";
import type { HandleSessionEventDeps } from "./host-modules/bootstrap/handle-session-event";
import { injectSystemPromptSections } from "./host-modules/bootstrap/inject-system-prompt-sections";
import { provideRpcUiContext } from "./host-modules/bootstrap/provide-rpc-ui-context";
import { wireContextServices, type WireContextServicesDeps } from "./host-modules/bootstrap/wire-context-services";
import type { ProvideRpcUiContextDeps } from "./host-modules/bootstrap/provide-rpc-ui-context";
import { wireDshServices, type WireDshServicesDeps } from "./host-modules/bootstrap/wire-dsh-services";
export function emitPluginEvent(type: string, payload: unknown) {
  return emitPluginEventImpl(type, payload);
}
export function pluginReadinessSnapshot() {
  return pluginReadinessSnapshotImpl();
}
export function pluginReadiness() {
  return pluginReadinessImpl();
}
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

async function sessionPresetSelection(sessionPath?: string): Promise<string | null | undefined> {
  if (!sessionPath) return undefined;
  try {
    const entries = SessionManager.open(sessionPath).getEntries();
    return resolveAgentPresetSelection(entries);
  } catch {
    return undefined;
  }
}

async function mountConfiguredAgentPreset(cwd: string, hostContext: Context, hostLoader: HarnessPluginLoader, selectedId?: string | null): Promise<string | null> {
  const configured = selectedId === undefined ? await piResources.readAgentPresetDefaults() : undefined;
  const presetId = selectedId === undefined ? configured?.default?.trim() : selectedId;
  if (!presetId) return null;
  const preset = (await piResources.listAgentPresets(cwd)).find((entry) => entry.id === presetId);
  // The configured preset id may be stale (preset deleted, renamed, or set
  // by an old user action). Surfacing this as a fatal error would block
  // every `agent:init`/`agent:new-session` call until the user manually
  // clears `agent-presets.json`. Treat it as a recoverable warning, drop the
  // stale default, and let the rest of init proceed so the agent host stays
  // usable. The same applies to presets whose source file is broken: log it,
  // clear the default, and continue without the preset runtime.
  if (!preset) {
    console.warn(`[openbuddy-agent] configured preset "${presetId}" was not found; clearing stale default`);
    await piResources.writeAgentPresetDefault(undefined).catch(() => undefined);
    return null;
  }
  if (preset.broken) {
    console.warn(`[openbuddy-agent] configured preset "${presetId}" is broken: ${preset.broken}; clearing stale default`);
    await piResources.writeAgentPresetDefault(undefined).catch(() => undefined);
    return null;
  }
  const source = await piResources.readAgentPreset(presetId, cwd);
  const runtime = new PresetSessionRuntime({
    hostContext,
    hostLoader,
    toolRegistry: state.toolRegistry,
    cwd,
  });
  try {
    await runtime.mount({ id: presetId, source, path: preset.path });
    state.presetSessionRuntime = runtime;
    emitPluginEvent("agent-preset/selected", { id: presetId, path: preset.path });
    return presetId;
  } catch (error) {
    await runtime.dispose().catch(() => undefined);
    throw error;
  }
}

async function selectAgentPreset(id: string): Promise<{ id: string; path: string }> {
  const requestedId = id.trim();
  if (!requestedId) throw new Error("agent-presets: preset id must be non-empty");
  return pluginLifecycleQueue.enqueue("plugin-reload", `agent-preset:${requestedId}`, async (transaction) => {
    const session = state.session;
    const hostContext = state.context;
    const hostLoader = state.loader;
    const cwd = state.cwd;
    if (!session || !hostContext || !hostLoader || !cwd) throw new Error("agent-presets: Pi session is not initialized");
    if (state.presetSessionRuntime?.id === requestedId) {
      const current = (await piResources.listAgentPresets(cwd)).find((entry) => entry.id === requestedId);
      if (!current) throw new Error(`agent-presets: preset "${requestedId}" was not found`);
      return { id: requestedId, path: current.path };
    }
    if (sessionHasConversation(session.sessionManager.getEntries())) {
      throw new Error("agent-presets: preset selection is only allowed before the first conversation turn");
    }
    const preset = (await piResources.listAgentPresets(cwd)).find((entry) => entry.id === requestedId);
    if (!preset) throw new Error(`agent-presets: preset "${requestedId}" was not found`);
    if (preset.broken) throw new Error(`agent-presets: preset "${requestedId}" is broken: ${preset.broken}`);
    const source = await piResources.readAgentPreset(requestedId, cwd);
    const previous = state.presetSessionRuntime;
    const candidate = new PresetSessionRuntime({
      hostContext,
      hostLoader,
      toolRegistry: state.toolRegistry,
      cwd,
    });

    transaction.phase("prepare", "agent-preset");
    await session.waitForIdle();
    await candidate.mount({ id: requestedId, source, path: preset.path });
    state.presetSessionRuntime = candidate;
    try {
      transaction.phase("pi", "agent-preset");
      await piRuntimeCoordinator.reload("agent-preset-switch");
      session.sessionManager.appendCustomEntry("agent-preset/selected", { agentPreset: requestedId, version: 1 });
      await previous?.dispose();
      emitPluginEvent("agent-preset/selected", { id: requestedId, path: preset.path });
      return { id: requestedId, path: preset.path };
    } catch (error) {
      state.presetSessionRuntime = previous;
      await candidate.dispose().catch(() => undefined);
      try {
        transaction.phase("rollback", "agent-preset");
        await piRuntimeCoordinator.reload("agent-preset-rollback");
      } catch (rollbackError) {
        console.warn("[openbuddy] failed to reload previous agent preset after switch failure", rollbackError);
      }
      throw new Error(`agent-presets: failed to select "${requestedId}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });
}

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

// Phase 8.3 Batch L: hook permission request handler moved to
// host-modules/hook-permission.ts. Wrapper preserves (title, message,
// request) signature used by configurePiExtensions.confirm binding.
import {
  requestHookPermission as requestHookPermissionImpl,
} from "./host-modules/hook-permission";
async function requestHookPermission(title: string, message: string, request?: HookPermissionRequest) {
  return requestHookPermissionImpl(title, message, request);
}

export function configurePiExtensions(manifestSpecs: readonly OpenBuddyPiExtensionSpec[]): void {
  const specs = applyPiExtensionOverrides(manifestSpecs, state.piExtensionOverrides);
  const telemetry = telemetrySink();
  const resolution = resolvePiExtensions(specs, {
    profileDir: selectedProfileDirectory(),
    resolveSource: (source) => {
      if (!state.profilePackageJson) throw new Error("Pi extension profile is not initialized");
      return createRequire(state.profilePackageJson).resolve(source);
    },
    emit: emitPluginEvent,
    resolveService: (owner) => state.context?.get(owner),
    ...(telemetry ? { telemetrySink: telemetry } : {}),
  });
  state.piExtensionStatuses = [
    ...specs.filter((spec) => spec.enabled === false).map((spec) => ({ id: spec.id, name: spec.id, kind: "pi" as const, state: "disabled" as const, ...(spec.source ? { source: spec.source } : {}), builtIn: !spec.source, managed: true })),
    ...resolution.resolved.map((entry) => ({ id: entry.id, name: entry.id, kind: "pi" as const, state: "pending" as const, source: entry.source, builtIn: entry.builtIn, managed: true, ...(entry.mode ? { mode: entry.mode } : {}), ...(entry.adapter ? { adapter: entry.adapter } : {}), ...(entry.commands ? { commands: entry.commands } : {}) })),
    ...resolution.diagnostics.filter((diagnostic) => diagnostic.state === "failed").map((diagnostic) => ({ id: diagnostic.id, name: diagnostic.id, kind: "pi" as const, state: "failed" as const, managed: true, ...(diagnostic.error ? { error: diagnostic.error } : {}) })),
  ];
  state.piExtensionPaths.splice(0, state.piExtensionPaths.length, ...state.profilePiResourcePaths.extensions, ...state.piMarketplaceResourcePaths.extensions, ...resolution.paths, ...discoveredPiPackagePaths());
	const toolExtension = state.piExtensionFactories.find((extension) => extension.name === "openbuddy-pi-tools") ?? {
		name: "openbuddy-pi-tools",
		factory: createPiToolExtension(),
		hidden: true as const,
	};
  const planExtension = state.piExtensionFactories.find((extension) => extension.name === "openbuddy-pi-plan-mode") ?? {
		name: "openbuddy-pi-plan-mode",
		factory: createPiPlanModeFactory(),
		hidden: true as const,
	};
	const hooksExtension = state.piExtensionFactories.find((extension) => extension.name === "openbuddy-pi-hooks") ?? {
		name: "openbuddy-pi-hooks",
		factory: createPiHooksExtension(() => state.hookConfigs, emitPluginEvent, {
			confirm: requestHookPermission,
			resolveShellRunner: () => state.context?.get("hookShell") as HookShellRunner | undefined,
		}),
		hidden: true as const,
	};
	// R1 — openbuddy-apply-patch: built-in unified-diff + structured shell tools.
	// Registered as a hidden factory so it ships with every session and the
	// user does not need to enable it in the Plugins panel. Mirrors the
	// Codex App standard `apply_patch` / `apply_command` protocol.
	const applyPatchExtension = state.piExtensionFactories.find((extension) => extension.name === "openbuddy-apply-patch") ?? (() => {
		const applyPatchFactory = builtinPiExtensionFactories["openbuddy-apply-patch"];
		if (!applyPatchFactory) return null;
		const telemetry = telemetrySink();
		return {
			name: "openbuddy-apply-patch",
			factory: applyPatchFactory(emitPluginEvent, { trustedCwd: state.cwd ?? process.cwd() }, {
				profileDir: selectedProfileDirectory(),
				resolveSource: (source) => {
					if (!state.profilePackageJson) throw new Error("Pi extension profile is not initialized");
					return createRequire(state.profilePackageJson).resolve(source);
				},
				emit: emitPluginEvent,
				resolveService: (owner) => state.context?.get(owner),
				...(telemetry ? { telemetrySink: telemetry } : {}),
			} satisfies PiExtensionResolutionOptions),
			hidden: true as const,
		};
	})();
	const builtIns = [toolExtension, planExtension, hooksExtension];
	if (applyPatchExtension) builtIns.push(applyPatchExtension);
	state.piExtensionFactories.splice(0, state.piExtensionFactories.length, ...builtIns, ...resolution.factories);
  for (const diagnostic of resolution.diagnostics) {
    emitPluginEvent(diagnostic.state === "disabled" ? "pi/extension-disabled" : "pi/extension-failed", diagnostic);
  }
  emitPluginEvent("pi/extensions-resolved", piExtensionsResolvedPayload(resolution));
}

export function reportPiExtensionErrors(): void {
  const errors = new Map<string, string>();
  for (const error of state.piResourceLoader?.getExtensions().errors ?? []) {
    errors.set(error.path, error.error);
    emitPluginEvent("pi/extension-failed", {
      id: error.path,
      state: "failed",
      path: error.path,
      error: error.error,
    });
  }
  state.piExtensionStatuses = state.piExtensionStatuses.map((status) => {
    if (status.state === "disabled" || status.state === "failed") return status;
    const error = status.source ? errors.get(status.source) : undefined;
    return error
      ? { ...status, state: "failed" as const, health: "failed" as const, disabledReason: "load-failed" as const, diagnostics: [error], error }
      : { ...status, state: "loaded" as const, health: "healthy" as const, disabledReason: undefined, diagnostics: undefined, loadedAt: status.loadedAt ?? new Date().toISOString() };
  });
  state.piExtensionStatuses = mergePiExtensionStatuses(
    state.piExtensionStatuses,
    (state.piResourceLoader?.getExtensions().extensions ?? []).map((extension) => ({
      path: extension.path,
      resolvedPath: extension.resolvedPath,
      hidden: extension.hidden,
      sourceInfo: extension.sourceInfo ? {
        scope: extension.sourceInfo.scope,
        origin: extension.sourceInfo.origin,
        ...(extension.sourceInfo.baseDir ? { baseDir: extension.sourceInfo.baseDir } : {}),
      } : undefined,
    })),
    [...errors.entries()].map(([path, error]) => ({ path, error })),
  );
}

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
  installHostModules(state, {
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
  const jobs = {
    register: (job: Omit<HostJobRecord, "finishedAt">) => {
      state.jobsRegistry.set(job.id, { ...job });
      if (job.sessionId) emitPluginEvent("session/jobs", { sessionId: job.sessionId });
      return () => {
        state.jobsRegistry.delete(job.id);
        if (job.sessionId) emitPluginEvent("session/jobs", { sessionId: job.sessionId });
      };
    },
    update: (id: string, patch: Partial<HostJobRecord>) => {
      const current = state.jobsRegistry.get(id);
      if (!current) return;
      Object.assign(current, patch);
      if (current.sessionId) emitPluginEvent("session/jobs", { sessionId: current.sessionId });
    },
    list: (sessionId?: string) => [...state.jobsRegistry.values()]
      .filter((job) => sessionId === undefined || job.sessionId === sessionId)
      .map(({ controller, stop, output, error, ...job }) => job),
    get: (id: string) => state.jobsRegistry.get(id),
  };
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
  const forwardedRemoteEvents = [
    "agent-preset/selected",
    "commands/change",
    "credentials/reference-updated",
    "cordis/request-run",
    "cordis/request-run-resolved",
    "cordis/dynamic-package",
    "cordis/dynamic-retract",
    "cordis/inspect-query",
    "cordis/inspect-query-resolved",
    "llm/adapters-updated",
    "settings/document-updated",
    "workspace/changed",
  ] as const;
  for (const eventName of forwardedRemoteEvents) {
    context.on(eventName, (...args: unknown[]) => {
      emitRendererEvent("openbuddy://plugin-event", {
        eventVersion: 1,
        type: eventName,
        payload: { args: clonePayload(args) },
      });
    });
  }
  state.capabilityEventBridgeUnsubscribe = bindCapabilityEventBridge({
    context,
    getSessionId: () => state.session?.sessionId,
    emitPluginEvent,
    emitRendererEvent,
  });
  // Stage G-1c: openbuddy-automation removed; automation is owned by
  // pi-background-tasks + pi-goal (passthrough). The legacy
  // `automation/run` Cordis event no longer exists; pi-native
  // background-task scheduling fires directly from the pi session.
  await context.start();

  let profilePackageJson: string | undefined;
  // Phase 8.3 Batch L3: profile path resolution extracted to
  // host-modules/bootstrap/profile-options.ts. The resolved profileOptions
  // are passed to ensureOpenBuddyProfile exactly as before.
  const resolvedProfile = resolveProfileOptions(process.env);
  const profileOptions = bootstrapProfileOptions(process.env);
  await ensureOpenBuddyProfile(profileOptions);
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
  state.profileOptions = profileOptions ? {
    ...profileOptions,
    anchors: [fileURLToPath(import.meta.url), join(resolvedProfile.profileDir, "package.json")],
    scope: {
      dshHomePath: (sub: string) => join(piHome(), sub),
      process: { platform: process.platform, env: process.env },
    },
  } : null;
  let profileBundle: PluginProfile | undefined;
  if (profileOptions) {
    try {
      const materialized = await materializeOpenBuddyProfile(state.profileOptions!);
      const runtimeBundle = await runtimeProfileBundle(materialized.bundle);
      profilePackageJson = materialized.profile.packageJson;
      state.profilePackageJson = profilePackageJson;
      state.profilePackagePaths.splice(0, state.profilePackagePaths.length, ...materialized.profile.packagePaths);
      profileBundle = {
        entries: [...runtimeBundle.entries],
        patches: runtimeBundle.patches,
      };
      state.profileBundle = profileBundle;
      state.profilePiExtensions = materialized.profile.piExtensions;
      state.profilePiPackagePaths.splice(0, state.profilePiPackagePaths.length, ...materialized.profile.piPackagePaths);
      setProfilePiResourcePaths(materialized.profile.piResourcePaths);
      await startProfileWatchers();
      emitPluginEvent("profile/loaded", {
        name: materialized.profile.name,
        bundles: materialized.profile.bundles,
        piExtensions: materialized.profile.piExtensions.map((extension) => extension.id),
      });
    } catch (error) {
      emitPluginEvent("profile/failed", { name: resolvedProfile.profileName, error: String(error), profileDir: resolvedProfile.profileDir });
      throw error;
    }
  }
  const loader = new ElectronHarnessPluginLoader({
    context,
    baseUrl: import.meta.url,
    importer: async (specifier, baseUrl) => {
      const compatibilityModule = resolveDeepSeekModule(specifier);
      if (compatibilityModule !== undefined) return compatibilityModule;
      if (specifier === "openbuddy:core") return openBuddyCorePlugin;
      const capability = openBuddyCapabilityPluginIndex.get(specifier);
      if (capability) return capability;
      if (specifier.startsWith(".")) return import(/* @vite-ignore */ new URL(specifier, baseUrl ?? import.meta.url).href);
      if (state.profilePackageJson) {
        try {
          const resolved = createRequire(state.profilePackageJson).resolve(specifier);
          return import(/* @vite-ignore */ pathToFileURL(resolved).href);
        } catch {
          try {
            const packageJsonByName = await artifactPackageJsonByName(state.profilePackagePaths, state.cwd);
            const packageJson = packageJsonByName.get(specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/"));
            if (packageJson) {
              const resolver = createProfileArtifactResolvers({ packageJsonByName, profilePackageJson: state.profilePackageJson });
              const resolved = await resolver.resolveModule(specifier, packageJson);
              return import(/* @vite-ignore */ pathToFileURL(resolved).href);
            }
          } catch {
            // Fall through to the host's normal dependency graph.
          }
        }
      }
      return import(/* @vite-ignore */ specifier);
    },
    logger: (level, message) => {
      console[level](message);
      emitPluginEvent(`plugin/${level}`, { message });
    },
    onEvent: emitPluginEvent,
  });
  state.loader = loader;
  state.pluginState = createPluginStateStore();
  try {
    const stored = await state.pluginState.read();
    state.piExtensionOverrides = stored?.piExtensions ?? {};
    state.pluginCommitGeneration = stored?.commit?.generation ?? 0;
    state.lastPluginCommitTransactionId = stored?.commit?.transactionId;
    state.lastPluginCommitMarker = stored?.commit;
  } catch (error) {
    console.warn("[openbuddy] failed to load Pi extension overrides", error);
  }

  let storedLayers: PluginPatch[][] = [];
  try {
    storedLayers = await state.pluginState.composePatches();
  } catch (error) {
    console.warn("[openbuddy] failed to load stored plugin overrides", error);
  }
  const baseProfile = createOpenBuddyProfile();
  state.storedLayers = storedLayers;
  state.baseProfile = baseProfile;
  const overrideLayers = await readOverridePatches();
  // Phase 8.3 Batch K: 40 个默认 DSH 入口搬到 host-modules/deepseek/host-runner-entries.ts,
  // 这里只组合 baseProfile.entries / profileBundle.entries + normalize。
  const profile: PluginProfile = {
    entries: composeHostRunnerEntries(
      baseProfile.entries,
      profileBundle?.entries ?? [],
    ),
    patches: [
      ...(baseProfile.patches ?? []),
      ...(profileBundle?.patches ?? []),
      ...storedLayers,
      ...(overrideLayers ?? []),
    ],
  };

  try {
    await loader.loadProfile(profile);
    state.activePluginProfile = profile;
    await syncDeepSeekCordisRuntime(deepSeekCoreRuntimeEntries(composePluginPatches(profile.entries, profile.patches ?? [])));
  } catch (error) {
    emitPluginEvent("plugin/failed", { id: "openbuddy-core", error: String(error) });
    throw error;
  }
  await restoreDeepSeekCapabilityServices();
  await ensureTypertReady();
  state.remoteDispatcher.register(deepSeekSessionQueryRemote(), remoteServiceContext());

  // Phase 8.3 §45: workspace-instructions + adapter-commands markdown
  // injection extracted to injectSystemPromptSections(deps). The activeAdapterIds
  // computation stays inline because it walks state.piExtensionStatuses which
  // is the canonical source of truth (not safe to mock in the helper).
  const activeAdapterIds = new Set<string>();
  for (const entry of state.piExtensionStatuses) {
    if (entry.mode !== "adapter") continue;
    activeAdapterIds.add(entry.id);
    if (entry.adapter) activeAdapterIds.add(entry.adapter.replace(/^openbuddy-/, ""));
  }
  await injectSystemPromptSections({
    cwd,
    context: state.context!,
    piResources,
    describeCompatibilityAdapterCommandsMarkdown,
    activeAdapterIds,
  });

  for (const packageName of [
    "@deepseek-ai/dsh-commands",
    "@deepseek-ai/dsh-goal",
    "@deepseek-ai/dsh-file-reference",
    "@deepseek-ai/dsh-host-plugin-inventory",
    "@deepseek-ai/dsh-message-feedback",
    "@deepseek-ai/dsh-session-reference",
    "@deepseek-ai/dsh-cordis-host-runner",
  ]) {
    const remote = deepSeekCapabilityRemote(packageName);
    if (remote) state.remoteDispatcher.register(serializeRemoteContribution(remote), remoteServiceContext());
  }
  await ensureTypertReady();
  await reconcileProfileArtifacts();

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
 * Pi-native fast session switch: reuse the warm host (plugin loader,
 * resource loader, typert, remote dispatcher, event log — none of which
 * depend on which session is open) and swap only the AgentSession via
 * PiSessionRuntime.replace(). Falls back to a full initialize() whenever
 * any cwd-scoped or preset-scoped host state differs from the currently
 * loaded one, because those are baked into the resource loader / preset
 * runtime and cannot be swapped cheaply.
 */
export async function rebindSession(sessionPath: string, cwd: string): Promise<void> {
  const context = state.context;
  const modelRuntime = state.modelRuntime;
  const resourceLoader = state.piResourceLoader;
  if (!state.session || !context || !modelRuntime || !resourceLoader) {
    await initialize({ cwd, sessionPath });
    return;
  }
  if (state.cwd !== cwd) {
    await initialize({ cwd, sessionPath });
    return;
  }
  // Empty / unreadable session files carry no preset hint. Treat them as
  // "inherit whatever is already mounted" instead of falling back to a
  // full initialize() — otherwise every "新建会话" click with a default
  // preset configured would re-bootstrap the entire agent host (~2-5s)
  // instead of taking the ~50ms warm-host rebind path.
  const mountedPresetId = state.presetSessionRuntime?.id ?? null;
  const probedPreset = await sessionPresetSelection(sessionPath);
  const targetPresetId = (probedPreset === undefined || probedPreset === null)
    ? mountedPresetId
    : probedPreset;
  if (targetPresetId !== mountedPresetId) {
    await initialize({ cwd, sessionPath });
    return;
  }
  const session = await piSessionRuntime.replace({
    cwd,
    agentDir: piHome(),
    noTools: "builtin",
    modelRuntime,
    sessionManager: SessionManager.open(sessionPath, undefined, cwd),
    resourceLoader,
  });
  state.session = session;
  state.model = session.model;
  state.queueMirror = [];
  context.provide("piSessionRaw", session);
  context.provide("piExtensionApi", session);
  const uiContext = provideRpcUiContext({
    context,
    session,
    state,
    emitPluginEvent,
    emitRendererEvent,
    questionAnswer,
    createOpenBuddyRpcUiContext,
  } as unknown as ProvideRpcUiContextDeps);
  // Phase 5 — fire-and-forget the bind so `agent:new-session` IPC returns
  // the sessionId immediately. Mutating IPCs await `state.extensionsBound`
  // before issuing their own RPC. See line 217 for the slot contract.
  state.extensionsBound = session
    .bindExtensions({ uiContext, mode: "rpc" })
    .catch((err) => {
      console.warn("[openbuddy] bindExtensions failed", err);
    });
  context.emit("pi/ready", { sessionId: session.sessionId, cwd });
  emitPluginEvent("session/created", { sessionId: session.sessionId, cwd });
  try {
    if (!session.sessionManager.getSessionName()) session.setSessionName("OpenBuddy");
  } catch {
    // Session naming is optional across Pi releases.
  }
}

async function disposeInternal(): Promise<void> {
  disposeActiveHookProcesses();
  await drainActiveHookProcesses();
  // Stage G-1c: openbuddy-automation removed; nothing to stop here.
  // pi-background-tasks disposes itself with the pi session.
  const session = state.session;
  try {
    if (session) {
      state.context?.emit("pi/dispose", { sessionId: session.sessionId });
      emitPluginEvent("session/dispose", { sessionId: session.sessionId });
      await piSessionRuntime.dispose();
    }
  } catch (error) {
    console.warn("[openbuddy] abort on dispose failed", error);
  }
  stopProfileWatchers();
  await state.profileReloadPromise.catch(() => undefined);
  state.capabilityEventBridgeUnsubscribe?.();
  state.capabilityEventBridgeUnsubscribe = null;
  state.typertRegistryUnsubscribe?.();
  state.typertRegistryUnsubscribe = null;
  state.remoteDispatcher.clear();
  await state.presetSessionRuntime?.dispose().catch((error) => {
    console.warn("[openbuddy] preset runtime dispose failed", error);
  });
  state.presetSessionRuntime = null;
  state.profileRemoteContributions.clear();
  disposeProfileTypertRegistrations(state.profileTypertContributions.values());
  state.profileTypertContributions.clear();
  await state.loader?.dispose();
  await state.terminalRuntime?.dispose();
  state.terminalRuntime = null;
  await state.subprocessRuntime?.dispose();
  state.subprocessRuntime = null;
  await state.deepSeekCordisRuntime?.dispose();
  state.deepSeekCordisRuntime = null;
  state.deepSeekCordisSnapshot = null;
  await state.sessionEventLog?.flush();
  state.sessionUnsubscribe = null;
  state.loader = null;
  state.sessionEventLog?.clear();
  state.eventSequence = 0;
  state.sessionSequences.clear();
  state.sessionEventLog = null;
  state.context = null;
  state.session = null;
  state.queueMirror = null;
  state.cwd = null;
  state.model = undefined;
  state.pluginState = null;
  state.pluginCommitGeneration = 0;
  state.lastPluginCommitTransactionId = undefined;
  state.lastPluginCommitMarker = undefined;
  state.modelRuntime = null;
  state.piResourceLoader = null;
  state.piMarketplaceResourcePaths.extensions = [];
  state.piMarketplaceResourcePaths.skills = [];
  state.piMarketplaceResourcePaths.prompts = [];
  state.piMarketplaceResourcePaths.themes = [];
  state.piMarketplaceAgentFiles = [];
  state.hookConfigs = [];
  state.piRefreshPromise = Promise.resolve();
  state.profileOptions = null;
  state.profileBundle = null;
  state.profilePackageJson = undefined;
  state.profilePackagePaths = [];
  state.baseProfile = null;
  state.activePluginProfile = null;
  state.storedLayers = [];
  state.profileReloadPromise = Promise.resolve();
  state.pluginReadiness = { phase: "idle", generation: 0 };
  state.runningTasks.clear();
  state.jobsRegistry.clear();
  for (const child of state.continuableSubagents.values()) {
    child.controller.abort();
    void child.session.abort().catch(() => undefined);
    child.unsubscribe();
    child.session.dispose();
  }
  await Promise.allSettled([...state.deepSeekAgents.values()].map((agent) => agent.dispose()));
  state.deepSeekAgents.clear();
  state.continuableSubagents.clear();
  state.hookPermissionSessionRules.clear();
  for (const request of state.pendingUiRequests.values()) request.resolve(undefined);
  state.pendingUiRequests.clear();
  state.extensionEditorText.clear();
  state.extensionToolsExpanded.clear();
}

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
function assistantMessageText(messages: unknown): string {
  return assistantMessageTextImpl(messages);
}
function createTeamRunner(modelRuntime: ModelRuntime, cwd: string, getModel: () => Model<any> | undefined): TeamRunner {
  return createTeamRunnerImpl(modelRuntime, cwd, getModel);
}

function resolveUiRequest(requestId: string, value: UiRequestValue): boolean {
  const request = state.pendingUiRequests.get(requestId);
  if (!request) return false;
  state.pendingUiRequests.delete(requestId);
  if (request.kind === "permission" && request.permission) {
    const decision = value && typeof value === "object" && "decision" in value
      ? value.decision
      : value === true ? "allow" : "deny";
    if (decision === "allow_always") {
      void permissionHandlers.readRules().then((rules) => permissionHandlers.writeRules([
        ...rules,
        { action: "allow", tool: request.permission?.toolName ?? "", ...(request.permission?.pattern ? { pattern: request.permission.pattern } : {}) },
      ])).catch((error) => console.warn("[openbuddy] failed to persist hook permission", error));
    } else if (decision === "allow") {
      const sessionRules = state.hookPermissionSessionRules.get(request.sessionId) ?? [];
      state.hookPermissionSessionRules.set(request.sessionId, [...sessionRules, {
        action: "allow",
        tool: request.permission.toolName,
        ...(request.permission.pattern ? { pattern: request.permission.pattern } : {}),
      }]);
    }
  }
  const permissionDecision = request.kind === "permission"
    ? value && typeof value === "object" && "decision" in value
      ? value.decision
      : value === true ? "allow" : "deny"
    : undefined;
  emitPluginEvent(request.kind === "permission" ? "session/permission-resolved" : "session/question-resolved", {
    requestId,
    sessionId: request.sessionId,
    answered: value !== undefined,
    ...(typeof value === "boolean" ? { approved: value } : {}),
    ...(permissionDecision ? { approved: permissionDecision !== "deny", decision: permissionDecision } : {}),
    ...(typeof value === "string" ? { answerLength: value.length } : {}),
    ...(value && typeof value === "object" && "answers" in value ? { answerCount: Object.keys(value.answers).length } : {}),
  });
  request.resolve(value);
  return true;
}

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

function listCommands() {
  return listCommandsImpl();
}

function listRunningTasks() {
  return listRunningTasksImpl();
}

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



export async function listSubagentChildren(parentSessionId: string): Promise<HarnessSubagentEntry[]> {
  return listSubagentChildrenImpl(parentSessionId);
}

function listSessionJobs(sessionId: string): HarnessJobView[] {
  return listSessionJobsImpl(sessionId);
}

async function subagentHistory(
  parentSessionId: string,
  childSessionId: string,
  mode: "one-shot" | "continuable",
  beforeSeq?: number,
  maxMessages?: number,
): Promise<{ entries: unknown[]; hasMore: boolean }> {
  return subagentHistoryImpl(parentSessionId, childSessionId, mode, beforeSeq, maxMessages);
}

export async function ensureContinuableSubagent(parentSessionId: string, childSessionId: string): Promise<NonNullable<typeof state.continuableSubagents extends Map<string, infer V> ? V : never>> {
  const live = state.continuableSubagents.get(childSessionId);
  if (live) {
    if (live.parentSessionId !== parentSessionId || live.mode !== "continuable") throw Object.assign(new Error("subagent address does not match"), { code: "session-not-found" });
    return live;
  }
  const sessions = await listAllPiSessions();
  const sessionInfo = sessions.find((entry) => entry.id === childSessionId);
  const parent = sessionInfo ? sessions.find((entry) => entry.path === sessionInfo.parentSessionPath) : undefined;
  if (!sessionInfo || parent?.id !== parentSessionId) throw Object.assign(new Error(`continuable subagent not found: ${childSessionId}`), { code: "lookup-not-found" });
  const manager = SessionManager.open(sessionInfo.path);
  const marker = manager.getEntries().find((entry) => entry.type === "custom" && (entry as { customType?: unknown }).customType === "openbuddy/subagent") as { data?: unknown } | undefined;
  const data = marker?.data && typeof marker.data === "object" ? marker.data as Record<string, unknown> : undefined;
  if (data?.mode !== "continuable") throw Object.assign(new Error("subagent is not continuable"), { code: "method-unavailable" });
  const modelRuntime = state.modelRuntime;
  const model = state.model;
  if (!modelRuntime || !model) throw Object.assign(new Error("Pi model runtime is unavailable"), { code: "service-unavailable" });
  const presetId = typeof data?.presetId === "string" ? data.presetId : undefined;
  const activePresetId = state.presetSessionRuntime?.id ?? undefined;
  if (presetId && presetId !== activePresetId) {
    throw Object.assign(new Error(`subagent preset does not match active preset: ${presetId}`), { code: "session-not-found" });
  }
  const resourceLoader = await createSubagentResourceLoader(sessionInfo.cwd);
  const customTools = modelFacingPresetTools().map((tool) => createTaskAwareTool(
    tool,
    (toolCallId) => state.runningTasks.get(toolCallId)?.abortController?.signal,
  ));
  const customToolNames = customTools.map((tool) => tool.name);
  const { session } = await createAgentSession({
    cwd: sessionInfo.cwd,
    agentDir: piHome(),
    model,
    modelRuntime,
    sessionManager: manager,
    tools: customToolNames,
    customTools,
    ...(resourceLoader ? { resourceLoader } : {}),
  });
  const controller = new AbortController();
  const record = {
    id: childSessionId,
    parentSessionId,
    session,
    role: typeof data.role === "string" ? data.role : "Subagent",
    mode: "continuable" as const,
    startedAt: Date.now(),
    controller,
    unsubscribe: session.subscribe(() => undefined),
  };
  state.continuableSubagents.set(childSessionId, record);
  return record;
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

async function createDeepSeekAgent(options: Parameters<typeof createDeepSeekAgentRuntime>[0]): Promise<DeepSeekPiAgentRuntime> {
  return createDeepSeekAgentImpl(options);
}

async function resumeDeepSeekAgent(options: Parameters<typeof createDeepSeekAgentRuntime>[0]): Promise<DeepSeekPiAgentRuntime> {
  return resumeDeepSeekAgentImpl(options);
}

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

async function killTask(taskId: string): Promise<void> {
  return killTaskImpl(taskId);
}
async function authStatus() { return authStatusImpl(); }
async function providerCatalog() { return providerCatalogImpl(); }

async function loadSession(sessionId: string, cwd: string, options?: { traceId?: string; sessionId?: string }): Promise<void> {
  return loadSessionImpl(sessionId, cwd, options);
}

function sessionInfo(sessionId: string) {
  return sessionInfoImpl(sessionId);
}

function sessionUsage(sessionId: string) {
  return sessionUsageImpl(sessionId);
}

function sessionFile(sessionId: string): string {
  return sessionFileImpl(sessionId);
}

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

async function renameSession(sessionId: string, title: string, cwd: string): Promise<void> {
  return renameSessionImpl(sessionId, title, cwd);
}

async function deleteSession(sessionId: string, cwd: string): Promise<void> {
  return deleteSessionImpl(sessionId, cwd);
}

async function inspirationGenerate(category: string, count: number, cwd?: string): Promise<{ sessionId: string; category: string; count: number }> {
  return inspirationGenerateImpl(category, count, cwd);
}


type ProviderDraft = { id: string; providerKind: string; label?: string; apiKey?: string; baseUrl?: string; apiBackend?: string; authScheme?: string; contextWindow?: number };
type ModelDraft = { modelId: string; providerId: string; name?: string; contextWindow?: number; reasoning?: boolean };

export async function readModelsConfig(): Promise<{ providers: Record<string, any>; [key: string]: any }> {
  try { return JSON.parse(await readFile(join(piHome(), "models.json"), "utf8")); }
  catch { return { providers: {} }; }
}

async function writeModelsConfig(config: { providers: Record<string, any>; [key: string]: any }): Promise<void> {
  await mkdir(piHome(), { recursive: true });
  const file = join(piHome(), "models.json");
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  // Keep the runtime instance that was injected into the active AgentSession.
  // Replacing it here leaves the session checking credentials against the old
  // runtime while setModel() resolves the model from the new one.
  if (state.modelRuntime) {
    await state.modelRuntime.refresh({ allowNetwork: false });
  }
}

async function updateStoredApiKey(providerId: string, apiKey: string | undefined): Promise<void> {
  const authPath = join(piHome(), "auth.json");
  let auth: Record<string, unknown> = {};
  try { auth = JSON.parse(await readFile(authPath, "utf8")); } catch { /* first credential */ }
  if (apiKey) auth[providerId] = { type: "api_key", key: apiKey };
  else delete auth[providerId];
  await mkdir(piHome(), { recursive: true });
  const temporary = `${authPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(auth, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, authPath);
}

async function saveProvider(provider: ProviderDraft): Promise<void> {
  const config = await readModelsConfig();
  const current = config.providers[provider.id] ?? {};
  config.providers[provider.id] = {
    ...current,
    name: provider.label || current.name,
    baseUrl: provider.baseUrl || current.baseUrl,
    api: provider.apiBackend === "messages" ? "anthropic-messages" : provider.apiBackend === "responses" ? "openai-responses" : "openai-completions",
    // `authHeader` is the pi-ai switch for Authorization/Bearer. Native
    // Anthropic Messages providers use x-api-key and therefore leave it off.
    authHeader: provider.authScheme === "bearer",
    models: current.models ?? [],
  };
  await writeModelsConfig(config);
  if (provider.apiKey && !provider.apiKey.startsWith("•")) {
    await updateStoredApiKey(provider.id, provider.apiKey);
    await state.modelRuntime?.setRuntimeApiKey(provider.id, provider.apiKey);
  }
  if (state.modelRuntime) {
    try { await state.modelRuntime.refresh({ allowNetwork: false, providers: [provider.id] }); }
    catch (error) { console.error(`[openbuddy] runtime refresh after save-provider failed`, error); }
  }
}

async function saveModel(model: ModelDraft): Promise<void> {
  const config = await readModelsConfig();
  const provider = config.providers[model.providerId];
  if (!provider) throw new Error(`Pi provider not found: ${model.providerId}`);
  const models = Array.isArray(provider.models) ? provider.models.filter((item: any) => item.id !== model.modelId) : [];
  // Preserve a previously-stored `reasoning` flag when the draft doesn't carry
  // one, so re-saving a model (e.g. renaming it) can't silently strip reasoning
  // support and clamp thinking to "off". An explicit draft value always wins.
  const previous = Array.isArray(provider.models)
    ? provider.models.find((item: any) => item.id === model.modelId)
    : undefined;
  const reasoning = model.reasoning ?? previous?.reasoning ?? false;
  models.push({
    id: model.modelId,
    name: model.name ?? model.modelId,
    contextWindow: model.contextWindow ?? 128000,
    maxTokens: 16384,
    reasoning,
  });
  provider.models = models;
  await writeModelsConfig(config);
  if (state.modelRuntime) {
    try { await state.modelRuntime.refresh({ allowNetwork: false, providers: [model.providerId] }); }
    catch (error) { console.error(`[openbuddy] runtime refresh after save-model failed`, error); }
  }
}

async function deleteModel(providerId: string, modelId: string): Promise<void> {
  const config = await readModelsConfig();
  const provider = config.providers[providerId];
  if (provider) provider.models = (provider.models ?? []).filter((item: any) => item.id !== modelId);
  await writeModelsConfig(config);
  if (state.modelRuntime) {
    try { await state.modelRuntime.refresh({ allowNetwork: false, providers: [providerId] }); }
    catch (error) { console.error(`[openbuddy] runtime refresh after delete-model failed`, error); }
    await restoreActiveModelAfterMutation(providerId, modelId);
  }
}

async function restoreActiveModelAfterMutation(providerId: string, modelId?: string): Promise<void> {
  if (!state.session || !state.model || state.model.provider !== providerId || (modelId && state.model.id !== modelId)) return;
  const fallback = state.modelRuntime?.getAvailableSnapshot().find((candidate) => candidate.provider !== providerId || candidate.id !== modelId);
  if (!fallback) {
    state.model = undefined;
    return;
  }
  try {
    await state.session.setModel(fallback);
    state.model = fallback;
  } catch (error) {
    console.error(`[openbuddy] failed to restore active model after provider mutation`, error);
    state.model = undefined;
  }
}

async function syncAuthCredentials(runtime: ModelRuntime): Promise<void> {
  const authPath = join(piHome(), "auth.json");
  let entries: Record<string, unknown> = {};
  try { entries = JSON.parse(await readFile(authPath, "utf8")); } catch { /* no auth file yet */ }
  for (const [providerId, credential] of Object.entries(entries)) {
    const value = credential as { type?: string; key?: string };
    if (value?.type === "api_key" && typeof value.key === "string" && value.key.length > 0) {
      try { await runtime.setRuntimeApiKey(providerId, value.key); }
      catch (error) { console.error(`[openbuddy] failed to sync credential for ${providerId}`, error); }
    }
  }
}

async function deleteProvider(id: string): Promise<void> {
  const config = await readModelsConfig();
  delete config.providers[id];
  await writeModelsConfig(config);
  await state.modelRuntime?.removeRuntimeApiKey(id).catch(() => undefined);
  await updateStoredApiKey(id, undefined);
  if (state.modelRuntime) {
    try { await state.modelRuntime.refresh({ allowNetwork: false, providers: [id] }); }
    catch (error) { console.error(`[openbuddy] runtime refresh after delete-provider failed`, error); }
    await restoreActiveModelAfterMutation(id);
  }
}

export async function listSessions(cwd: string) {
  return listSessionsImpl(cwd);
}

async function updateSessionMetadata(sessionId: string, update: (metadata: {
  pinned: string[];
  archived: string[];
  experts: Record<string, { expertId: string; expertName: string; avatarLocal?: string }>;
}) => void): Promise<void> {
  return updateSessionMetadataImpl(sessionId, update);
}

async function clearSessionMetadata(): Promise<void> {
  return clearSessionMetadataImpl();
}

function harnessCursorPath(): string {
  return harnessCursorPathImpl();
}
function getHarnessCursorStore(): HarnessCursorStore {
  return getHarnessCursorStoreImpl();
}

function harnessResumeTokenPath(): string {
  return harnessResumeTokenPathImpl();
}

async function getHarnessResumeToken(): Promise<string | undefined> {
  return getHarnessResumeTokenImpl();
}

async function setHarnessResumeToken(token: unknown): Promise<string | undefined> {
  return setHarnessResumeTokenImpl(token);
}

async function readHarnessSessionCursors(): Promise<Record<string, number>> {
  return readHarnessSessionCursorsImpl();
}

async function writeHarnessSessionCursors(cursors: Record<string, unknown>): Promise<void> {
  return writeHarnessSessionCursorsImpl(cursors);
}

async function getHarnessSessionCursors(): Promise<Record<string, number>> {
  return getHarnessSessionCursorsImpl();
}

async function setHarnessSessionCursors(cursors: unknown): Promise<Record<string, number>> {
  return setHarnessSessionCursorsImpl(cursors);
}

async function setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean> {
  const sessions = await listAllPiSessions();
  if (!sessions.some((entry) => entry.id === sessionId)) throw new Error(`Pi session not found: ${sessionId}`);
  await updateSessionMetadataImpl(sessionId, (metadata) => {
    metadata.pinned = metadata.pinned.filter((id) => id !== sessionId);
    if (pinned) metadata.pinned.push(sessionId);
  });
  return pinned;
}

async function setSessionArchived(sessionId: string, archived: boolean): Promise<boolean> {
  return setSessionArchivedImpl(sessionId, archived);
}

async function setAllArchived(archived: boolean): Promise<{ updated: number }> {
  return setAllArchivedImpl(archived);
}

async function setSessionExpert(sessionId: string, expert: { expertId: string; expertName: string; avatarLocal?: string } | null): Promise<void> {
  return setSessionExpertImpl(sessionId, expert);
}

function getToolRegistry(): PiToolRegistry {
  return state.toolRegistry;
}

async function listSkills(requestedCwd?: string | null) {
  return listSkillsImpl(requestedCwd);
}

async function resourceInventory() {
  return resourceInventoryImpl();
}

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

async function pluginSnapshot(): Promise<PluginSnapshot> {
  return pluginSnapshotImpl();
}

function pluginEvents(query?: { sessionId?: string; sinceSequence?: number; limit?: number }): SessionEventRecord[] {
  return pluginEventsImpl(query);
}

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
async function setPluginEnabledInternal(id: string, enabled: boolean, transaction?: PluginTransactionContext): Promise<PluginStatus | null> {
  return setPluginEnabledInternalImpl(id, enabled, transaction);
}

/** Re-import and re-apply a plugin through the same loader lifecycle. */
async function reloadPluginInternal(id: string, transaction?: PluginTransactionContext): Promise<PluginStatus | null> {
  return reloadPluginInternalImpl(id, transaction);
}

/** Re-materialize the profile and reload Pi resources without recreating the AgentSession. */
async function reloadPiExtensionsInternal(transaction?: PluginTransactionContext): Promise<PiExtensionStatus[]> {
  return reloadPiExtensionsInternalImpl(transaction);
}

/** Update a plugin's runtime config; non-disabled entries go through Cordis update. */
async function updatePluginConfigInternal(id: string, config: unknown, transaction?: PluginTransactionContext): Promise<PluginStatus | null> {
  return updatePluginConfigInternalImpl(id, config, transaction);
}

/** Snapshot the persisted plugin-state overrides for UI / IPC inspection. */
async function getStoredPluginState() {
  return getStoredPluginStateImpl(state);
}

/** Clear a single plugin's persisted override (revert to profile defaults). */
async function resetPluginStateInternal(id: string, transaction?: PluginTransactionContext) {
  return resetPluginStateInternalImpl(id, transaction);
}

function setPluginEnabled(id: string, enabled: boolean): Promise<PluginStatus | null> {
  return setPluginEnabledImpl(id, enabled);
}

function reloadPlugin(id: string): Promise<PluginStatus | null> {
  return reloadPluginImpl(id);
}

function reloadPiExtensions(): Promise<PiExtensionStatus[]> {
  return reloadPiExtensionsImpl();
}

async function reloadPiRuntime(reason = "internal-reload"): Promise<void> {
  return reloadPiRuntimeImpl(reason);
}

function updatePluginConfig(id: string, config: unknown): Promise<PluginStatus | null> {
  return updatePluginConfigImpl(id, config);
}

function resetPluginState(id: string) {
  return resetPluginStateImpl(id);
}

function enqueuePluginStateTransaction<T>(
  kind: "plugin-enable" | "plugin-config" | "plugin-reset",
  target: string,
  operation: (transaction: PluginTransactionContext) => Promise<T>,
): Promise<T> {
  return enqueuePluginStateTransactionImpl(kind, target, operation);
}

export async function discoverRendererPluginManifest(): Promise<RendererPluginManifestEntry[]> {
  const cached = state.rendererPluginManifestCache;
  if (cached && cached.generation === state.profileArtifactGeneration) return cached.promise;
  const generation = state.profileArtifactGeneration;
  const promise = discoverRendererPluginManifestUncached();
  state.rendererPluginManifestCache = { generation, promise };
  try {
    return await promise;
  } catch (error) {
    if (state.rendererPluginManifestCache?.promise === promise) state.rendererPluginManifestCache = null;
    throw error;
  }
}

async function discoverRendererPluginManifestUncached(): Promise<RendererPluginManifestEntry[]> {
  const loader = state.loader;
  if (!loader) return [];
  const additionalPackageJson = await artifactPackageJsonByName(state.profilePackagePaths, state.cwd);
  const additionalPackages = [...additionalPackageJson.keys()];
  const resolvers = createProfileArtifactResolvers({
    packageJsonByName: additionalPackageJson,
    profilePackageJson: state.profilePackageJson,
  });
  const discovered = await discoverRendererPluginEntries(
    [...loader.entries()].map((entry) => entry.options),
    {
      additionalPackages,
      resolvePackageJson: resolvers.resolvePackageJson,
      resolveModule: async (specifier, packageJson) => profileArtifactModuleUrl(await resolvers.resolveModule(specifier, packageJson)),
    },
  );
  const existing = new Set(discovered.map((entry) => entry.id));
  const builtinClientEntries: RendererPluginManifestEntry[] = openBuddyDeepSeekRendererEntries.map((entry) => ({
    id: entry.id,
    moduleId: entry.name,
    moduleKey: entry.id,
    name: entry.name,
    ...(Array.isArray(entry.inject) ? { inject: [...entry.inject] } : {}),
    moduleUrl: `openbuddy:static/${entry.id}`,
  }));
  return [...discovered, ...builtinClientEntries.filter((entry) => !existing.has(entry.id))];
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
});



export async function syncWorkbenchScope(force = false): Promise<void> {
  // Minimal real implementation: derive the current Casdoor workbench scope,
  // skip work when nothing changed, and publish a renderer event so the UI
  // can react to scope switches without depending on casdoor branch helpers.
  try {
    const status = casdoorAuth.status();
    const desiredScope = `${status.config.configured ? 'configured' : 'local'}:${status.tenantContext.activeTenantId ?? 'none'}:${status.identity?.subject ?? 'anonymous'}`;
    if (!force && state.scopeKey === desiredScope) return;
    state.scopeKey = desiredScope;
    process.env.OPENBUDDY_WORKBENCH_SCOPE = desiredScope;
    emitRendererEvent("openbuddy://workbench-scope", { scope: desiredScope, at: new Date().toISOString() });
  } catch (error) {
    console.error("[openbuddy] syncWorkbenchScope failed", error);
  }
}

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
