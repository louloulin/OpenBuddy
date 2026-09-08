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

// v6-G M1: facade aliases for plugin lifecycle + profile + session lifecycle + deepseek
import { buildPluginLifecycleFacade } from "./host-modules/facade/plugin-lifecycle-facade";
import { buildProfileFacade } from "./host-modules/facade/profile-facade";
import { buildSessionLifecycleFacade } from "./host-modules/facade/session-lifecycle-facade";
import { buildDeepseekFacade } from "./host-modules/facade/deepseek-facade";

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
// v6-G M1 收尾: 12 个 session capability thin wrapper 搬到 session-capability-wrappers.ts.
// 这里不再 import single-*Impl, 直接通过 buildSessionCapabilityWrappers 解构.
import { buildSessionCapabilityWrappers } from "./host-modules/bootstrap/session-capability-wrappers";
import { createDefaultAgentHostState } from "./host-modules/_default-state";


import { registerLifecycleDefaultState } from "./host-modules/bootstrap/lifecycle-public";
import { installInitOrchestration } from "./host-modules/init-orchestration";

export const state: AgentHostState = {
  ...createDefaultAgentHostState(),
  // Phase 5 — see `_state-shape.ts:extensionsBound`. Initialized to null
  // because no bind is in flight at module load; `rebindSession` / `initialize`
  // set it to the live Promise returned by `bindExtensions`.
  extensionsBound: null,
  toolRegistry: createToolRegistryStub(),
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

// v6-G M1 收尾: module-load 时把 state 注入 lifecycle-public / dsh-bridge-helpers
// 的 default singletons, 这样 syncWorkbenchScope 等 module-load 调用无需等
// installMicrokernelHost 也能工作 (agent-host-workbench-scope-realserver test 用).
registerLifecycleDefaultState(state);

// v6-G M1 收尾 (fix): 必须 module-load 时就把 `initialize` + `enqueueLifecycle`
// 装进 init-orchestration 的 module-level singleton, 否则 IPC handler
// `agent:new-session` 的 ensureAgentHost → waitUntilReady → init() 第一次
// 走到 initializeImpl 时, 它还是 placeholder (async () => undefined),
// pipeline 根本没跑, session-swap / dsh-bridge-helpers 等 host-module 也
// 不会被 installMicrokernelHost 装上. 后续 host-module install 仍然走
// installMicrokernelHost(stage 3), 那里 installInitOrchestration 是 idempotent
// 重写 (覆盖 placeholder).
//
// 这里用 queueMicrotask 延迟到 module body 末尾执行, 此时 `initialize` 和
// `enqueueLifecycle` 已经绑定 (它们是 `const` / `function`, 不参与 hoisting).
queueMicrotask(() => {
  installInitOrchestration({ initialize, enqueueLifecycle });
});

export const lifecycleAppendQueues = new Map<string, Promise<void>>();

// v6-G M1: facade instantiation (zero reverse-dependency)
const pluginLifecycleFacade = buildPluginLifecycleFacade(state);
const profileFacade = buildProfileFacade(state);
const sessionLifecycleFacade = buildSessionLifecycleFacade(state);
const deepseekFacade = buildDeepseekFacade(state);
const { installProfileBundle, removeProfileBundle } = pluginLifecycleFacade;
const {
  profilePatchPaths,
  profileResourceWatchPaths,
  marketplaceArtifactPackagePaths,
  artifactPackagePaths,
  stopProfileWatchers,
  listProfileRemoteContributions,
} = profileFacade;

const piSessionRuntime = new PiSessionRuntime();

const piRuntimeCoordinator = new PiRuntimeCoordinator({
  getSession: () => piSessionRuntime.session,
  getResourceLoader: () => state.piResourceLoader,
});

/**
 * agentHost.publicQueueItems() — 把 Pi session 的 steering + follow-up
 * 消息队列投影成 UI 可见的 items. 实现搬到
 * host-modules/session-queue-items.ts (Phase v4 §L-13 抽取).
 */
import { publicQueueItems as publicQueueItemsImpl } from "./host-modules/session-queue-items";
export function publicQueueItems(activeSession: AgentSession | null): readonly unknown[] {
  return publicQueueItemsImpl(activeSession);
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

/**
 * 转发到 harness/remote-invocation.invokeRemoteImpl, 注入当前 state 的 context
 * + remoteDispatcher + service context.
 */
// Stage F-2 (extended): the local invokeRemote() above uses the live `state`
// context. The bridge.ts implementation reads `typertGateway` off the context;
// if no gateway is installed it falls back to the remoteDispatcher. We delegate
// to bridge.ts (already imported as `invokeRemoteImpl`) rather than calling
/**
 * DSH bridge 辅助函数 cluster (questionAnswer / deepSeekCordisSnapshot /
 * deepSeekPiBridgeDescription / invokeDeepSeekCordis). 实现搬到
 * host-modules/dsh-bridge-helpers.ts (Phase v4 §L-16 抽取).
 */
import {
  questionAnswer as questionAnswerImpl,
  deepSeekCordisSnapshot as deepSeekCordisSnapshotImplFn,
  deepSeekPiBridgeDescription as deepSeekPiBridgeDescriptionImplFn,
  invokeDeepSeekCordis as invokeDeepSeekCordisImplFn,
} from "./host-modules/dsh-bridge-helpers";

function questionAnswer(value: UiRequestValue, questionKey?: string): string | undefined {
  return questionAnswerImpl(value, questionKey);
}

function deepSeekCordisSnapshot(): DeepSeekCordisRuntimeSnapshot | null {
  return deepSeekCordisSnapshotImplFn();
}

function deepSeekPiBridgeDescription(): {
  protocol: typeof DEEPSEEK_PI_BRIDGE_PROTOCOL;
  runtime: "pi";
  capabilities: typeof DEEPSEEK_PI_CAPABILITIES;
} {
  return deepSeekPiBridgeDescriptionImplFn();
}

async function invokeDeepSeekCordis(invocation: DeepSeekCordisInvocation): Promise<unknown> {
  return invokeDeepSeekCordisImplFn(invocation);
}

/**
 * Thin state-aware wrapper around `host-modules/deepseek/bridge.invokeRemote`.
 * The bridge reads `typertGateway` off the context; when no gateway is
 * installed it falls back to the remoteDispatcher.
 */
function invokeRemote(request: unknown): Promise<unknown> {
  return invokeRemoteImpl({
    context: state.context as { get?: (key: string) => unknown } | null,
    remoteDispatcher: state.remoteDispatcher as never,
    remoteServiceContext,
    request,
  });
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
const captureFileSnapshot = captureFileSnapshotImpl;

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
const pluginSnapshot = () => pluginSnapshotImpl();
const pluginEvents = (query?: any) => pluginEventsImpl(query);

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
const getStoredPluginState = () => getStoredPluginStateImpl(state);

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

/**
 * Pi native resource path management. 实现搬到
 * host-modules/profile/resource-paths.ts (Phase v4 §L-2 抽取).
 */
import {
  setProfilePiResourcePaths as setProfilePiResourcePathsImpl,
  refreshMarketplacePiResourcePaths as refreshMarketplacePiResourcePathsImpl,
  nativePiResourcePaths as nativePiResourcePathsImpl,
  profileArtifactModuleUrl as profileArtifactModuleUrlImpl,
} from "./host-modules/profile/resource-paths";

export function setProfilePiResourcePaths(paths: {
  extensions: readonly string[];
  skills: readonly string[];
  prompts: readonly string[];
  themes: readonly string[];
}): void {
  return setProfilePiResourcePathsImpl(paths);
}

export async function refreshMarketplacePiResourcePaths(): Promise<void> {
  return refreshMarketplacePiResourcePathsImpl();
}

function nativePiResourcePaths(): {
  additionalSkillPaths: string[];
  additionalPromptTemplatePaths: string[];
  additionalThemePaths: string[];
} {
  return nativePiResourcePathsImpl();
}

export function profileArtifactModuleUrl(path: string): string {
  return profileArtifactModuleUrlImpl(path);
}

/**
 * 触发 pi-runtime coordinator 重载直到 tool registry revision 稳定.
 * 实现搬到 host-modules/pi-runtime-refresh.ts (Phase v4 §L-17 抽取).
 */
import { refreshPiExtensions as refreshPiExtensionsImpl } from "./host-modules/pi-runtime-refresh";
function refreshPiExtensions(): void {
  return refreshPiExtensionsImpl();
}

/**
 * Cordis context.provide 的 Pi runtime factories (tools / runtime / session).
 * 实现搬到 host-modules/pi-runtime-factories.ts (Phase v4 §L-4 抽取).
 */
import {
  createToolRegistry as createToolRegistryImpl,
  createToolRegistryStub,
  createPiRuntime as createPiRuntimeImpl,
  createPiSessionFacade as createPiSessionFacadeImpl,
  listAllPiSessions as listAllPiSessionsImpl,
  persistedSessionPath as persistedSessionPathImpl,
} from "./host-modules/pi-runtime-factories";

function createToolRegistry(onChange?: () => void) {
  return createToolRegistryImpl(onChange);
}

function createPiRuntime() {
  return createPiRuntimeImpl();
}

function createPiSessionFacade() {
  return createPiSessionFacadeImpl();
}

export async function listAllPiSessions() {
  return listAllPiSessionsImpl();
}

export async function persistedSessionPath(sessionId: string | undefined) {
  return persistedSessionPathImpl(sessionId);
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
// v6-G M1 收尾: 12 个 session capability thin wrapper (compact / fork / etc.)
// 提到 host-modules/bootstrap/session-capability-wrappers.ts, agent-host.ts
// 只剩一行解构 + facade 直接 spread.
const sessionCapabilityWrappers = buildSessionCapabilityWrappers({ state, piSessionDir });
const {
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
} = sessionCapabilityWrappers;

// Stage F-2: PiProfileSnapshot + capturePiProfileSnapshot + restorePiProfileSnapshot
// have moved to host-modules/profile/snapshot.ts. The local bindings
// `capturePiProfileSnapshot` / `restorePiProfileSnapshot` are re-imported
// at the top of this file (see L463-470) so existing callers keep working.

/**
 * context.provide 的 reloadable 服务捕获/恢复 (capture/restore).
 * 实现搬到 host-modules/context-services-snapshot.ts (Phase v4 §L-14 抽取).
 */
import {
  captureReloadableContextServices as captureReloadableContextServicesImpl,
  restoreCapturedContextServices as restoreCapturedContextServicesImpl,
} from "./host-modules/context-services-snapshot";

export function captureReloadableContextServices(): Map<string, unknown> {
  return captureReloadableContextServicesImpl();
}

export function restoreCapturedContextServices(captured: Map<string, unknown>): void {
  return restoreCapturedContextServicesImpl(captured);
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


export async function reloadProfile(): Promise<void> {
  scheduleProfileReload();
  await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 160));
  await state.profileReloadPromise;
}

/**
 * 统一 profile packages 视图 — 把 6 个 surface 的状态合并成 ProfilePackageInfo[].
 * 实现搬到 host-modules/profile/unified-packages.ts (Phase v4 §L-5 抽取).
 */
import { profilePackages as profilePackagesImpl } from "./host-modules/profile/unified-packages";
export async function profilePackages() {
  return profilePackagesImpl();
}

/**
 * C6: Install the curated default Pi package bundle into the current profile.
 * Exposed via the renderer so the OpenBuddyPluginPanel "Enable Default Pi Bundle"
 * button can drive it through the IPC bridge.
 *
 * Returns the per-package status list (installed / skipped / failed) so the
 * renderer can surface a toast without owning the installer logic.
 */
/**
 * 安装"默认 Pi 包"到当前 profile (受 OPENBUDDY_INSTALL_DEFAULT_PI=1 控制).
 * 实现搬到 host-modules/default-pi-package-installer.ts (Phase v4 §L-15 抽取).
 */
import { installDefaultPiPackages as installDefaultPiPackagesImpl } from "./host-modules/default-pi-package-installer";
export async function installDefaultPiPackages(options?: { force?: boolean }): Promise<DefaultPiPackageResult[]> {
  return installDefaultPiPackagesImpl(options);
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
import { installHostModules } from "./host-modules/bootstrap/install-host-modules";
import { buildInstallHostModuleDeps } from "./host-modules/bootstrap/install-host-modules-deps";
import { runInitPipeline, type InitPipelineDeps } from "./host-modules/bootstrap/init-pipeline";
import { syncWorkbenchScope, __registerDefaultState, __registerDefaultCasdoorStatus } from "./host-modules/workbench-scope-sync";
import { __registerDefaultState as __registerDefaultDshState } from "./host-modules/dsh-bridge-helpers";
import { buildInitPipelineDeps } from "./host-modules/bootstrap/init-pipeline-builder";
// v4 sub-stage extractors — initialize() is now an 8-stage orchestrator
// instead of a 300-line wall. Each helper owns one stage of the bootstrap.
import { wireForwardedEvents } from "./host-modules/bootstrap/wire-forwarded-events";
import { setupProfileOptions } from "./host-modules/bootstrap/profile-options-setup";
import { initPluginLoader } from "./host-modules/bootstrap/init-plugin-loader";
import { initDeepSeek } from "./host-modules/bootstrap/init-deepseek";
import { computeActiveAdapterIds } from "./host-modules/bootstrap/compute-active-adapter-ids";
import { initSession } from "./host-modules/bootstrap/init-session";
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
export { pluginLifecycleQueue } from "./host-modules/plugin-event-bus";

/**
 * agent preset 辅助函数 cluster (selectedProfileDirectory / createPiToolExtension /
 * sessionPresetSelection). 实现搬到 host-modules/preset-helpers.ts
 * (Phase v4 §L-6 抽取).
 */
import {
  selectedProfileDirectory as selectedProfileDirectoryImpl,
  createPiToolExtension as createPiToolExtensionImpl,
  sessionPresetSelection as sessionPresetSelectionImpl,
} from "./host-modules/preset-helpers";

function selectedProfileDirectory(): string {
  return selectedProfileDirectoryImpl();
}

function createPiToolExtension(): ExtensionFactory {
  return createPiToolExtensionImpl();
}

async function sessionPresetSelection(sessionPath?: string | null): Promise<string | null | undefined> {
  return sessionPresetSelectionImpl(sessionPath);
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

/**
 * Subagent resource loader (noExtensions + preset prompt override) + pi plan-mode factory.
 * 实现搬到 host-modules/preset-helpers.ts (Phase v4 §L-10 抽取).
 */
import {
  createSubagentResourceLoader as createSubagentResourceLoaderImpl,
  createPiPlanModeFactory as createPiPlanModeFactoryImpl,
} from "./host-modules/preset-helpers";

export async function createSubagentResourceLoader(cwd: string): Promise<DefaultResourceLoader | undefined> {
  return createSubagentResourceLoaderImpl(cwd);
}

function createPiPlanModeFactory(): ExtensionFactory {
  return createPiPlanModeFactoryImpl();
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


const installMicrokernelDepsClosures = {
  piHome, isPathWithin, piSessionDir, emitPluginEvent, emitRendererEvent,
  listAllPiSessions, persistedSessionPath, enqueueLifecycle, lifecycleAppendQueues,
  initialize, rebindSession, dispose: dispose(enqueueLifecycle), piRuntimeCoordinator, piSessionRuntime,
  publicQueueItems, workspaceRegistry, readModelsConfig: readModelsConfigImpl,
  canonicalEventNamespace, eventNamespace, createSubagentResourceLoader,
  createTaskAwareTool, modelFacingPresetTools, runHookPoint,
  profileArtifactModuleUrl, profilePackages, pluginLifecycleQueue,
  setProfilePiResourcePaths, refreshMarketplacePiResourcePaths, sessionPresetSelection,
  provideRpcUiContext, questionAnswer, createOpenBuddyRpcUiContext, requestHookPermission,
  createPiToolExtension, sessionHasConversation,
  capturePiProfileSnapshot, restorePiProfileSnapshot,
  captureDeepSeekCapabilityServices, restoreDeepSeekCapabilityServices,
  materializeOpenBuddyProfile, createOpenBuddyProfile, composePluginPatches,
  syncDeepSeekCordisRuntime, deepSeekCoreRuntimeEntries, reloadMcp: () => reloadMcpImpl(state),
  syncMarketplacePiExtensionStatusesImpl, startProfileWatchers, readOverridePatches,
  runtimeProfileBundle, reconcileProfileArtifacts, configurePiExtensionsImpl: configurePiExtensions,
  reportPiExtensionErrors, captureReloadableContextServices,
  restoreCapturedContextServices, rollbackPiProfile, scheduleProfileReload,
  artifactPackageJsonByName, discoverRendererPluginManifest,
  promptImpl, abortImpl, listSessionsImpl, listSubagentChildrenImpl,
  promptSubagentImpl, interruptSubagentImpl, ensureContinuableSubagentImpl,
  setModel: setModelImpl, getSession: getSessionImpl, getModel: getModelImpl,
  setThinkingLevel: setThinkingLevelImpl, promptContent: promptContentImpl,
  onEvent: onEventImpl, prompt: promptImpl, abort: abortImpl,
  persistPiSessionHeaderImpl, stopProfileWatchers,
  disposeProfileTypertRegistrations, disposeActiveHookProcesses,
  drainActiveHookProcesses, permissionHandlers,
};
const buildMicrokernelHostDeps = () => buildInstallHostModuleDeps(installMicrokernelDepsClosures);

// v6-G M1 收尾 (架构修复): module-load 时立即 installHostModules 一次,
// 消除 "IPC handler 在 stage 3 之前调用 host-module singleton" 的 race condition.
// 后续 installMicrokernelHost(stage 3) 仍然会 idempotent 重装 (microkernel-host 的
// installMicrokernelHost 自己 disposeMicrokernelHost 后再 installHostModules).
// 这里用 queueMicrotask 是为了让 module body 全部跑完 (initialize function 等
// 较后定义的 binding 已初始化) 再 install.
queueMicrotask(() => {
  installHostModules(state, buildMicrokernelHostDeps());
});

export async function initialize(opts?: { cwd?: string; sessionPath?: string; force?: boolean }): Promise<void> {
  if (!opts?.force && state.session && (!opts?.cwd || opts.cwd === state.cwd)
    && (!opts?.sessionPath || isCurrentSessionPath(opts.sessionPath, opts.cwd))) return;
  if (state.session) await disposeInternal();
  const cwd = opts?.cwd ?? process.cwd();
  await runInitPipeline(buildInitPipelineDeps({
    state,
    cwd,
    piHome,
    isPathWithin,
    piSessionDir,
    emitPluginEvent,
    emitRendererEvent,
    piSessionRuntime,
    installMicrokernelHost: (deps) => installMicrokernelHost(state, deps),
    getMicrokernelHostDeps: buildMicrokernelHostDeps,
    openBuddyCorePlugin,
    baseUrl: import.meta.url,
    reportPiExtensionErrors,
    listPlugins,
  }, { sessionPath: opts?.sessionPath }));
}
import { init } from "./host-modules/bootstrap/lifecycle-public";
export { init } from "./host-modules/bootstrap/lifecycle-public";


function waitUntilReady(): Promise<void> {
  if (state.modelRuntime && state.context && state.session) return Promise.resolve();
  return getInitialisationPromise() ?? init();
}

import { rebindSession } from "./host-modules/bootstrap/lifecycle-public";
export { rebindSession } from "./host-modules/bootstrap/lifecycle-public";
/**
 * Stage F-5: disposeInternal moved to host-modules/dispose-internal.ts.
 * The facade re-exports it as part of the lifecycle path.
 */
import { disposeInternal } from "./host-modules/dispose-internal";


import { dispose } from "./host-modules/bootstrap/lifecycle-public";
export { dispose } from "./host-modules/bootstrap/lifecycle-public";

import { bindRendererEventEmitter, emitRendererEvent } from "./host-modules/bootstrap/lifecycle-public";
export { bindRendererEventEmitter, emitRendererEvent } from "./host-modules/bootstrap/lifecycle-public";

/**
 * Sink the bridge forwards pi span events into. Always non-null after
 * `bindRendererEventEmitter` has run; we still null-guard so cold boot
 * (before the renderer registers) cannot crash the agent runtime.
 */
import { telemetrySink } from "./host-modules/bootstrap/lifecycle-public";
export { telemetrySink } from "./host-modules/bootstrap/lifecycle-public";

import { assistantMessageText, createTeamRunner } from "./host-modules/bootstrap/lifecycle-public";
export { assistantMessageText, createTeamRunner } from "./host-modules/bootstrap/lifecycle-public";
import { resolveUiRequest } from "./host-modules/bootstrap/lifecycle-public";
export { resolveUiRequest } from "./host-modules/bootstrap/lifecycle-public";


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


/**
 * Forwarder for ensureContinuableSubagent. Real implementation now lives in
 * `host-modules/deepseek/agent-runtime.ts` (Batch C 收尾).
 */

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


function formatBranchSummaryText(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
  options?: { maxTotal?: number; maxUser?: number; maxAssistant?: number },
): string | null {
  return formatBranchSummaryTextImpl(messages, options);
}


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


function getHarnessCursorStore(): HarnessCursorStore {
  return getHarnessCursorStoreImpl();
}


/** Forwarder for setSessionPinned (real impl in host-modules/session-metadata.ts). */


/** Forwarder for getToolRegistry (real impl lives in tool-registry owner). */
function getToolRegistry(): PiToolRegistry {
  return state.toolRegistry;
}


/** Forwarder for listPlugins (real impl lives in plugin-state). */
function listPlugins(): PluginStatus[] {
  return state.loader?.list() ?? [];
}


/**
 * session projection baseline (sessionBaselines / sessionProjectionBaseline).
 * 实现搬到 host-modules/session-projection.ts (Phase v4 §L-7 抽取).
 */
import {
  sessionBaselines as sessionBaselinesImpl,
  sessionProjectionBaseline as sessionProjectionBaselineImpl,
} from "./host-modules/session-projection";


/** Toggle a single plugin on/off without restarting the agent session. */

/** Re-import and re-apply a plugin through the same loader lifecycle. */

/** Re-materialize the profile and reload Pi resources without recreating the AgentSession. */

/** Update a plugin's runtime config; non-disabled entries go through Cordis update. */

/** Snapshot the persisted plugin-state overrides for UI / IPC inspection. */
/** Clear a single plugin's persisted override (revert to profile defaults). */


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

/**
 * warm-host fast path 的 "新建会话" IPC handler. 实现在
 * host-modules/session-swap.ts (Phase v4 §L-3 抽取).
 */
import {
  newSession as newSessionImpl,
  ensureNewSession as ensureNewSessionImpl,
} from "./host-modules/session-swap";
async function newSession(cwd: string, modelId?: string, options?: { traceId?: string; sessionId?: string }): Promise<{ sessionId?: string; sessionFile?: string; cwd: string; model?: { provider?: string; id?: string } }> {
  return newSessionImpl(cwd, modelId, options);
}
async function ensureNewSession(cwd: string, modelId?: string, options?: { traceId?: string }): Promise<{ sessionId?: string; sessionFile?: string; cwd: string; model?: { provider?: string; id?: string } }> {
  return ensureNewSessionImpl(cwd, modelId, options);
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
  getSession: getSessionImpl,
  extensionsBound,
  onEvent: onEventImpl,
  onPluginEvent: onPluginEventImpl,
  prompt: promptImpl,
  promptContent: promptContentImpl,
  steer: steerImpl,
  followUp: followUpImpl,
  abort: abortImpl,
  setModel: setModelImpl,
  setThinkingLevel: setThinkingLevelImpl,
  getModel: getModelImpl,
  getModelRuntime: getModelRuntimeImpl,
  getCwd: getCwdImpl,
  selectAgentPreset,
  authStatus: authStatusImpl,
  providerCatalog: providerCatalogImpl,
  listPlugins,
  pluginInventory: listPluginInventoryImpl,
  pluginSnapshot: pluginSnapshotImpl,
  pluginEvents: pluginEventsImpl,
  setPluginEnabled: setPluginEnabledImpl,
  reloadPlugin: reloadPluginImpl,
  reloadPiExtensions: reloadPiExtensionsImpl,
  reloadPiRuntime: reloadPiRuntimeImpl,
  updatePluginConfig: updatePluginConfigImpl,
  getStoredPluginState: () => getStoredPluginStateImpl(state),
  resetPluginState: resetPluginStateImpl,
  getToolRegistry,
  profilePackages,
  installDefaultPiPackages,
  installProfileBundle: installProfileBundleImpl,
  removeProfileBundle: removeProfileBundleImpl,
  listRendererPluginEntries,
  rendererPluginBootGraph,
  resolveRendererPluginModule,
  listProfileRemoteContributions,
  ensureTypertReady,
  newSession,
  ensureNewSession,
  loadSession: loadSessionImpl,
  sessionInfo: sessionInfoImpl,
  sessionUsage: sessionUsageImpl,
  sessionFile: sessionFileImpl,
  rewindSession: rewindSessionImpl,
  reloadMcp: () => reloadMcpImpl(state),
  authorizeMcp: (serverName, signal) => authorizeMcpImpl(state, serverName, signal),
  cancelMcpAuthorization: (serverName) => cancelMcpAuthorizationImpl(state, serverName),
  mcpStatus: () => mcpStatusImpl(state),
  mcpCapabilityGovernance: () => mcpCapabilityGovernanceImpl(state),
  resolveUiRequest,
  renameSession: renameSessionImpl,
  deleteSession: deleteSessionImpl,
  setSessionPinned: setSessionPinnedImpl,
  setSessionArchived: setSessionArchivedImpl,
  setAllArchived: setAllArchivedImpl,
  setSessionExpert: setSessionExpertImpl,
  clearSessionMetadata: clearSessionMetadataImpl,
  saveProvider: saveProviderImpl,
  saveModel: saveModelImpl,
  deleteProvider: deleteProviderImpl,
  deleteModel: deleteModelImpl,
  listSessions: listSessionsImpl,
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
  sessionBaselines: sessionBaselinesImpl,
  sessionProjectionBaseline: sessionProjectionBaselineImpl,
  listCommands: listCommandsImpl,
  listSkills: listSkillsImpl,
  resourceInventory: resourceInventoryImpl,
  pluginReadiness: pluginReadinessImpl,
  listRunningTasks: listRunningTasksImpl,
  listSubagentChildren: listSubagentChildrenImpl,
  listSessionJobs: listSessionJobsImpl,
  subagentHistory: subagentHistoryImpl,
  promptSubagent: promptSubagentImpl,
  interruptSubagent: interruptSubagentImpl,
  killTask: killTaskImpl,
  inspirationGenerate,
  getHarnessSessionCursors: getHarnessSessionCursorsImpl,
  setHarnessSessionCursors: setHarnessSessionCursorsImpl,
  getHarnessResumeToken: getHarnessResumeTokenImpl,
  setHarnessResumeToken: setHarnessResumeTokenImpl,
  updateSessionQueue: updateSessionQueueImpl,
  readSessionAttachment: readSessionAttachmentImpl,
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


// syncWorkbenchScope + workbench-scope-sync moved to host-modules/workbench-scope-sync.ts
// before-quit handler + filesystem capability policy moved to host-modules/bootstrap/
import { installBeforeQuitHandler } from "./host-modules/bootstrap/before-quit-handler";
import {
  evaluateFilesystemCapabilityPolicy as evaluateFilesystemCapabilityPolicyImpl,
  DEFAULT_FILESYSTEM_POLICY as DEFAULT_FILESYSTEM_POLICY_IMPL,
  type FilesystemCapabilityPolicy as FilesystemCapabilityPolicyImpl,
} from "./host-modules/bootstrap/filesystem-capability-policy";

export type { AgentSession };

// v6-G M1 收尾: 把 Electron before-quit + filesystem policy 抽到独立模块,
// agent-host.ts 只剩一行 register. Register 在 module-load 即触发, 等价
// 原 inline `app.on("before-quit", ...)` 在模块初始化时的副作用.
installBeforeQuitHandler({ dispose: dispose(enqueueLifecycle) });

export const evaluateFilesystemCapabilityPolicy = evaluateFilesystemCapabilityPolicyImpl;
export const DEFAULT_FILESYSTEM_POLICY = DEFAULT_FILESYSTEM_POLICY_IMPL;
export type FilesystemCapabilityPolicy = FilesystemCapabilityPolicyImpl;
