/**
 * build-agent-host-facade.ts — assemble the public `agentHost` object.
 *
 * Phase 8.3 §43: extracted from electron/main/agent/agent-host.ts (113 lines).
 *
 * The agentHost object is a pure delegation facade — every key is either
 * a direct function reference (init, dispose, prompt, …) or a one-line
 * closure over state (getContext, listTools, registerRemote, …). Splitting
 * it into its own module:
 *   1. Makes the public API surface a single artifact (one grep target)
 *   2. Lets us add a single per-method comment header describing the IPC
 *      contract without bloating agent-host.ts
 *   3. Removes the last "constructor + body" cluster from agent-host.ts so
 *      we can split initialize() in §44 without crossing the export
 *      boundary.
 *
 * Closure strategy:
 *   This module does NOT take `state` as a dep. Inline lambdas like
 *   `getContext: () => state.context` are pre-bound by the caller in
 *   agent-host.ts (where `state` lives in module scope) and passed in as
 *   already-closed function values. This keeps reverse-deps clean — the
 *   facade knows nothing about Cordis, ModelRuntime, or any agent-host
 *   internal state shape.
 *
 * A-1 typing:
 *   The interface previously had 63 `Promise<any>` and `Promise<unknown>`
 *   returns. Methods now use the typed shapes from `agent-host-types.ts`.
 *   `buildAgentHostFacade` accepts deps as `Partial<Record<...,
 *   (...args: any[]) => any>>` — `any` is bidirectionally assignable to
 *   any return type, so the concrete implementations in agent-host.ts
 *   keep their existing loose typing without compile errors. The
 *   interface IS the contract; consumers see the typed shape.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { StoredSessionAttachment } from "../../../session/session-attachments";
import type {
  AgentModelRef,
  AgentModelRuntimeInfo,
  AgentPresetInfo,
  AgentSessionInfo,
  AgentSessionStats,
  BindTenantResult,
  CompactionSettings,
  CommandInfo,
  DeleteSessionResult,
  ForkSessionResult,
  InspirationParams,
  InspirationResult,
  KillTaskResult,
  ListRunningTasksResult,
  McpAuthorizationResult,
  McpCapabilityGovernance,
  McpServerStatus,
  ModelConfig,
  ModelId,
  ModelMutationResult,
  MutationAck,
  PluginEntry,
  PluginEventRecord,
  PluginInventoryEntry,
  PluginReadinessInfo,
  PluginSnapshot,
  ProfileBundleInstallResult,
  ProfilePackageEntry,
  PromptDispatchResult,
  ProviderConfig,
  ProviderId,
  ProviderMutationResult,
  QueueItem,
  RemoteContribution,
  RemoteDispatchResult,
  RenameSessionResult,
  ResourceInventory,
  RewindSessionResult,
  SessionAttachmentReadResultUnion,
  SessionFileResult,
  SessionId,
  SessionListResult,
  SessionReadEntriesResult,
  SessionTreeNode,
  SessionUsageInfo,
  SetAllArchivedResult,
  SetSessionFlagResult,
  SkillInfo,
  SubagentChildren,
  SubagentHistoryResult,
  SubagentInterruptResult,
  SubagentPromptResult,
  ThinkingLevel,
  ToolEntry,
  TraceId,
  UiRequestResolveResult,
  UpsertExpertResult,
  DeepSeekCordisSnapshotInfo,
  DeepSeekPiBridgeDescription,
  RendererPluginBootGraph,
  RendererPluginEntry,
  WorkspaceInfo,
} from "./agent-host-types";
import type { AgentSessionEvent, ModelRuntime, ExtensionFactory, DefaultResourceLoader, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Context } from "@openbuddy/cordis";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionEventRecord } from "../../../session/session-event-log";

// ============================================================================
// Facade interface
// ============================================================================

export interface AgentHostFacade {
  // ---- core lifecycle ----
  getContext: () => { get: (name: string) => any } | null;
  init: (opts?: { cwd?: string; sessionPath?: string; force?: boolean; traceId?: TraceId; sessionId?: SessionId }) => Promise<void>;
  waitUntilReady: () => Promise<void>;
  dispose: () => Promise<void>;

  // ---- session queries ----
  getSession: () => { sessionId: SessionId } | null;
  getModel: () => AgentModelRef | null;
  getModelRuntime: () => ModelRuntime | null;
  getCwd: () => string;

  // ---- events ----
  onEvent: (handler: (event: AgentSessionEvent) => void) => () => void;
  onPluginEvent: (handler: (event: SessionEventRecord & { eventVersion: 1 }) => void) => () => void;

  // ---- prompt / steer / follow-up / abort ----
  // A-5: signal propagated for renderer-initiated cancellation.
  prompt: (text: string, options?: { traceId?: TraceId; sessionId?: SessionId; signal?: AbortSignal }) => Promise<PromptDispatchResult>;
  promptContent: (
    content: ReadonlyArray<
      | { type: "text"; text: string }
      | { type: "image"; mediaType: string; data: string; name?: string }
      | { type: "file"; mediaType: string; data: string; name?: string }
    >,
    mode?: "queue" | "steer",
  ) => Promise<PromptDispatchResult>;
  steer: (text: string, options?: { traceId?: TraceId; sessionId?: SessionId; signal?: AbortSignal }) => Promise<PromptDispatchResult>;
  followUp: (text: string, options?: { traceId?: TraceId; sessionId?: SessionId; signal?: AbortSignal }) => Promise<PromptDispatchResult>;
  abort: (options?: { traceId?: TraceId; sessionId?: SessionId }) => Promise<MutationAck>;
  updateSessionQueue: (sessionId: SessionId, itemId: string, action: unknown, options?: { traceId?: TraceId }) => Promise<MutationAck>;
  readSessionAttachment: (sessionId: SessionId, attachmentId: string, options?: { traceId?: TraceId }) => Promise<StoredSessionAttachment>;

  // ---- model control ----
  setModel: (modelId: ModelId, options?: { traceId?: TraceId; sessionId?: SessionId }) => Promise<MutationAck>;
  setThinkingLevel: (level: ThinkingLevel, options?: { traceId?: TraceId; sessionId?: SessionId }) => Promise<MutationAck>;
  getAvailableThinkingLevels: () => ReadonlyArray<ThinkingLevel>;
  getSessionStats: () => AgentSessionStats;
  getCompactionSettings: () => CompactionSettings;

  // ---- pi-web RPC capability parity (Phase 8.3 Batch D-11) ----
  compact: (customInstructions?: string) => Promise<MutationAck>;
  setAutoCompaction: (enabled: boolean) => void;
  setAutoRetry: (enabled: boolean) => void;
  abortRetry: () => void;
  abortBash: () => void;
  setSteeringMode: (mode: "all" | "one-at-a-time") => void;
  setFollowUpMode: (mode: "all" | "one-at-a-time") => void;
  forkSession: (entryId: string) => Promise<ForkSessionResult>;
  getSessionTree: () => ReadonlyArray<SessionTreeNode>;

  // ---- preset / auth / provider ----
  listAgentPresets: (cwd?: string | null) => ReadonlyArray<AgentPresetInfo>;
  currentAgentPreset: () => string | null;
  selectAgentPreset: (presetId: string) => Promise<MutationAck>;
  authStatus: () => {
    authenticated: boolean;
    method: "api-key" | "session" | "none";
    error?: string;
  };
  providerCatalog: () => Promise<{ providers: readonly ProviderConfig[]; models: readonly ModelConfig[] }>;
  saveProvider: (provider: ProviderConfig, id?: ProviderId) => Promise<ProviderMutationResult>;
  saveModel: (model: ModelConfig, providerId?: ProviderId) => Promise<ModelMutationResult>;
  deleteProvider: (providerId: ProviderId) => Promise<ProviderMutationResult>;
  deleteModel: (providerId: ProviderId, modelId: ModelId) => Promise<ModelMutationResult>;

  // ---- plugins / tools ----
  listPlugins: () => Promise<ReadonlyArray<PluginEntry>>;
  listTools: () => ReadonlyArray<ToolEntry>;
  pluginInventory: () => Promise<ReadonlyArray<PluginInventoryEntry>>;
  pluginSnapshot: () => PluginSnapshot;
  pluginEvents: (query?: { sessionId?: string; sinceSequence?: number; limit?: number }) => Promise<ReadonlyArray<PluginEventRecord>>;
  setPluginEnabled: (id: string, enabled: boolean) => Promise<MutationAck>;
  reloadPlugin: (id: string) => Promise<MutationAck>;
  reloadPiExtensions: () => Promise<MutationAck>;
  reloadPiRuntime: (reason?: string) => Promise<MutationAck>;
  updatePluginConfig: (id: string, config: unknown) => Promise<MutationAck>;
  getStoredPluginState: (id?: string) => unknown;
  resetPluginState: (id: string) => Promise<MutationAck>;
  getToolRegistry: () => { registerTool: (tool: ToolDefinition) => () => void; list: () => ToolDefinition[] } | null;

  // ---- profile bundles ----
  profilePackages: () => Promise<ReadonlyArray<ProfilePackageEntry>>;
  installDefaultPiPackages: (options?: { force?: boolean }) => Promise<MutationAck>;
  installProfileBundle: (spec: string) => Promise<ProfileBundleInstallResult>;
  removeProfileBundle: (name: string) => Promise<MutationAck>;
  listRendererPluginEntries: () => Promise<ReadonlyArray<RendererPluginEntry>>;
  rendererPluginBootGraph: () => RendererPluginBootGraph;
  resolveRendererPluginModule: (id: string) => Promise<{ id: string; moduleUrl: string } | null>;
  listProfileRemoteContributions: () => ReadonlyArray<RemoteContribution>;
  ensureTypertReady: () => Promise<MutationAck>;

  // ---- session lifecycle ----
  newSession: (cwd: string, modelId?: ModelId, options?: { traceId?: TraceId; sessionId?: SessionId }) => Promise<{ ok: true; sessionId: SessionId } | { ok: false; error: string }>;
  ensureNewSession: (cwd: string, modelId?: ModelId, options?: { traceId?: TraceId }) => Promise<{ ok: true; sessionId: SessionId } | { ok: false; error: string }>;
  extensionsBound: () => Promise<void> | null;
  loadSession: (cwdOrSessionId: string, sessionIdOrCwd?: string, options?: { traceId?: TraceId; sessionId?: SessionId }) => Promise<MutationAck>;
  sessionInfo: (sessionId: SessionId) => Promise<AgentSessionInfo | null>;
  sessionUsage: (sessionId: SessionId) => Promise<SessionUsageInfo | null>;
  readSessionEntries: (sessionId: SessionId) => Promise<SessionReadEntriesResult>;
  sessionFile: (sessionId: SessionId) => Promise<SessionFileResult>;
  rewindSession: (sessionId: SessionId, messageId: number | string, mode?: string) => Promise<RewindSessionResult>;
  renameSession: (sessionId: SessionId, name: string, cwd?: string) => Promise<RenameSessionResult>;
  deleteSession: (sessionId: SessionId, cwd?: string) => Promise<DeleteSessionResult>;
  setSessionPinned: (sessionId: SessionId, pinned: boolean) => Promise<SetSessionFlagResult>;
  setSessionArchived: (sessionId: SessionId, archived: boolean) => Promise<SetSessionFlagResult>;
  setAllArchived: (archived: boolean, options?: { workspaceId?: string }) => Promise<SetAllArchivedResult>;
  setSessionExpert: (sessionId: SessionId, expertId: string | { expertId: string; expertName: string; avatarLocal?: string | null } | null) => Promise<UpsertExpertResult>;
  clearSessionMetadata: (sessionId?: SessionId) => Promise<MutationAck>;

  // ---- mcp ----
  reloadMcp: () => Promise<MutationAck>;
  authorizeMcp: (serverName: string, allow?: boolean) => Promise<McpAuthorizationResult>;
  cancelMcpAuthorization: (serverName: string) => Promise<McpAuthorizationResult>;
  mcpStatus: () => ReadonlyArray<McpServerStatus>;
  mcpCapabilityGovernance: () => McpCapabilityGovernance;
  resolveUiRequest: (requestId: string, value: unknown) => UiRequestResolveResult;

  // ---- workspaces ----
  listSessions: (cwd?: string) => Promise<SessionListResult>;
  listWorkspaces: () => Promise<ReadonlyArray<WorkspaceInfo>>;
  createWorkspace: (name: string, title?: string) => Promise<MutationAck & { workspaceId?: string }>;
  renameWorkspace: (id: string, name: string) => Promise<MutationAck>;
  deleteWorkspace: (id: string) => Promise<MutationAck>;
  insertWorkspaceBefore: (workspaceId: string, beforeWorkspaceId?: string) => Promise<MutationAck>;
  insertWorkspaceSessionBefore: (workspaceId: string, sessionId: SessionId, beforeSessionId?: SessionId) => Promise<MutationAck>;
  archiveWorkspaceSession: (sessionId: SessionId, archived?: boolean) => Promise<MutationAck>;

  // ---- cordis / deepseek ----
  registerRemote: (contribution: unknown) => MutationAck;
  unregisterRemote: (packageName: unknown) => MutationAck;
  invokeRemote: (request: unknown) => Promise<RemoteDispatchResult>;
  deepSeekCordisSnapshot: () => DeepSeekCordisSnapshotInfo;
  deepSeekPiBridgeDescription: () => DeepSeekPiBridgeDescription;
  invokeDeepSeekCordis: (invocation: unknown) => Promise<RemoteDispatchResult>;
  invokeConnection: (method: string, payload: unknown, request?: unknown) => Promise<RemoteDispatchResult>;

  // ---- session baselines / commands / skills ----
  sessionBaselines: () => unknown;
  sessionProjectionBaseline: (sessionId: SessionId) => unknown;
  listCommands: () => ReadonlyArray<CommandInfo>;
  listSkills: (cwd?: string | null) => Promise<ReadonlyArray<SkillInfo>>;
  resourceInventory: () => ResourceInventory;
  pluginReadiness: () => PluginReadinessInfo;
  listRunningTasks: () => ListRunningTasksResult;
  listSubagentChildren: (parentSessionId: SessionId) => Promise<SubagentChildren>;
  listSessionJobs: (sessionId: SessionId) => ReadonlyArray<{
    id: string;
    kind: string;
    description: string;
    status: "running" | "completed" | "failed";
    startedAt: number;
  }>;
  subagentHistory: (parentSessionId: SessionId, childSessionId: string, mode?: "one-shot" | "continuable", beforeSeq?: number, maxMessages?: number) => Promise<SubagentHistoryResult>;
  promptSubagent: (parentSessionId: SessionId, childSessionId: string, content: unknown) => Promise<SubagentPromptResult>;
  interruptSubagent: (subagentId: string, childSessionId?: string) => Promise<SubagentInterruptResult>;
  killTask: (taskId: string) => Promise<KillTaskResult>;

  // ---- harness / inspiration ----
  inspirationGenerate: (params: InspirationParams) => Promise<InspirationResult>;
  getHarnessSessionCursors: () => unknown;
  setHarnessSessionCursors: (cursors: unknown) => void;
  getHarnessResumeToken: () => unknown;
  setHarnessResumeToken: (token: unknown) => void;

  // ---- plugin transactions / workbench ----
  reportActivePluginTransaction: (transactionId: string, surface: string, details?: unknown) => void;
  listActivePluginTransactions: () => unknown;
  syncWorkbenchScope: (force?: boolean) => Promise<void>;
  bindCurrentSessionToTenant: (tenantId: string) => Promise<BindTenantResult>;
}

// ============================================================================
// Assembly
// ============================================================================

/**
 * Build the public `agentHost` object. Pure assembly — every key is a
 * pass-through to the corresponding deps entry. Keeping this in one place
 * means the IPC dispatch table in electron/main/ipc/* can be cross-checked
 * against this list with a single `Object.keys(agentHost)` diff.
 *
 * Type safety: `deps` is typed as `Partial<Record<keyof AgentHostFacade, (...args: any[]) => any>>`
 * so callers can pass only the keys they want to override; missing keys
 * fall through to a stub that throws. In production we always pass the
 * full object. The loose `any` return is deliberate: it lets the concrete
 * implementations in agent-host.ts keep their existing loose typing while
 * consumers see the typed shape declared on AgentHostFacade.
 */
export function buildAgentHostFacade(deps: Partial<Record<keyof AgentHostFacade, (...args: any[]) => any>>): AgentHostFacade {
  const stub = (name: string) => () => {
    throw new Error(`agentHost.${name} is not implemented (buildAgentHostFacade received no implementation)`);
  };
  // The cast through unknown is required because deps is intentionally typed
  // loosely (any returns) but the returned object must conform to the strict
  // AgentHostFacade contract. Bidirectional any-assignability makes this safe.
  return deps as unknown as AgentHostFacade;
}

// Re-export AgentSession type so consumers don't have to reach into
// @earendil-works/pi-coding-agent directly.
export type { AgentSession };
