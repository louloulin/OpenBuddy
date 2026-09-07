/**
 * agent-host-types.ts — typed return shapes for AgentHostFacade.
 *
 * A-1 in the ts-error-architecture-overhaul change. The Facade previously
 * declared every method as `Promise<any>` (63 occurrences) which meant
 * consumers — preload, ipc/agent.ts, ui-* packages — got zero compile-time
 * information. This file collects the public-domain shapes that the
 * Facade's methods actually return so the interface can be typed.
 *
 * Scope:
 *   - Typed: every method called from `electron/main/ipc/agent.ts` and the
 *     few called from `electron/main/ipc/{casdoor,email,collaboration}.ts`.
 *   - Still `Promise<unknown>`: methods that are workspace/plugin internals
 *     and not directly IPC-targeted. Marked with `// TODO typed` in
 *     `build-agent-host-facade.ts` for the next change.
 *
 * Why this doesn't cascade: the `buildAgentHostFacade` deps parameter is
 * typed as `Partial<Record<keyof AgentHostFacade, (...args: any[]) => any>>`
 * — `any` is bidirectionally assignable to any return type, so the
 * concrete implementations in `agent-host.ts` and the host-modules keep
 * their existing loose typing without compile errors. The interface IS
 * the contract; consumers see the typed shape.
 */

// ============================================================================
// 1. Session / model
// ============================================================================

export type SessionId = string;
export type ProviderId = string;
export type ModelId = string;
export type TraceId = string;

export interface AgentSessionInfo {
  sessionId: SessionId;
  cwd?: string;
  createdAt?: string;
  /** Provider name from models.json (e.g. "anthropic", "openai"). */
  provider?: string;
  /** Model identifier within the provider. */
  modelId?: ModelId;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  expertId?: string | null;
}

export interface AgentModelRef {
  provider: ProviderId;
  id: ModelId;
  /** Optional display label. */
  label?: string;
}

export interface AgentModelRuntimeInfo {
  models: ReadonlyArray<AgentModelRef>;
  /** True when the runtime has finished initializing for the active session. */
  ready: boolean;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentSessionStats {
  totalMessages?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  model?: AgentModelRef;
  startedAt?: string;
}

export interface CompactionSettings {
  enabled: boolean;
  threshold?: number;
  preserveCount?: number;
}

export interface QueueItem {
  id: string;
  content: ReadonlyArray<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }>;
  mode: "queue" | "steer";
  createdAt: string;
}

export interface SessionAttachmentReadResult {
  ok: true;
  attachment: {
    id: string;
    contentType: string;
    data: string;
  };
}
export interface SessionAttachmentReadError {
  ok: false;
  error: string;
}
export type SessionAttachmentReadResultUnion = SessionAttachmentReadResult | SessionAttachmentReadError;

// ============================================================================
// 2. Provider / model CRUD (Phase 0 P0 work — formerly stubbed)
// ============================================================================

export interface ProviderConfig {
  id: ProviderId;
  baseUrl?: string;
  apiKey?: string;
  /** Opaque metadata. The shape is owned by the provider descriptor registry. */
  meta?: Record<string, unknown>;
  enabled?: boolean;
}

export interface ModelConfig {
  id: ModelId;
  providerId: ProviderId;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  enabled?: boolean;
  meta?: Record<string, unknown>;
}

export interface ProviderMutationResult {
  ok: boolean;
  providerId?: ProviderId;
  error?: { code: string; message: string };
}

export interface ModelMutationResult {
  ok: boolean;
  modelId?: ModelId;
  error?: { code: string; message: string };
}

// ============================================================================
// 3. Plugins / tools
// ============================================================================

export interface PluginEntry {
  id: string;
  name: string;
  version?: string;
  enabled: boolean;
  description?: string;
  /** Plugin source kind: "manifest" | "module" | "class" */
  kind?: string;
}

export interface ToolEntry {
  name: string;
  label?: string;
  description?: string;
  /** Whether the tool is currently registered with the active runtime. */
  registered: boolean;
}

export interface PluginEventRecord {
  id: string;
  type: string;
  payload: unknown;
  emittedAt: string;
  /** Plugin that emitted the event, if any. */
  pluginId?: string;
}

export interface PluginInventoryEntry {
  id: string;
  path?: string;
  type: "profile" | "marketplace" | "built-in" | "user";
  enabled: boolean;
  version?: string;
}

export interface PluginSnapshot {
  inventory: ReadonlyArray<PluginInventoryEntry>;
  enabledIds: ReadonlyArray<string>;
  config: Record<string, unknown>;
  /** Schema version of the snapshot format. */
  schemaVersion: number;
}

export interface RendererPluginEntry {
  id: string;
  /** Public path on disk for dynamic import. */
  moduleUrl: string;
  /** Optional mount target. */
  surface?: string;
  enabled: boolean;
}

export interface RendererPluginBootGraph {
  /** Ordered list of plugin ids to boot. */
  order: ReadonlyArray<string>;
  /** Map of plugin id to its declared dependencies (plugin ids). */
  edges: Record<string, ReadonlyArray<string>>;
}

// ============================================================================
// 4. MCP
// ============================================================================

export type McpAuthStatus = "authorized" | "declined" | "pending" | "expired" | "unknown";

export interface McpServerStatus {
  name: string;
  status: "connecting" | "ready" | "error" | "disabled";
  lastError?: string;
  tools: ReadonlyArray<ToolEntry>;
}

export interface McpCapabilityGovernance {
  /** Allow-listed tool patterns for this session. */
  allowPatterns: ReadonlyArray<string>;
  /** Deny-listed tool patterns (take precedence over allow). */
  denyPatterns: ReadonlyArray<string>;
  /** Per-server overrides. */
  perServer: Record<string, { allowed: boolean; reason?: string }>;
}

export interface McpAuthorizationResult {
  ok: boolean;
  serverName: string;
  status: McpAuthStatus;
  error?: { code: string; message: string };
}

// ============================================================================
// 5. Workspaces / sessions
// ============================================================================

export interface WorkspaceInfo {
  id: string;
  name: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
}

export interface SessionListEntry {
  sessionId: SessionId;
  cwd?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  pinned: boolean;
  modelRef?: AgentModelRef;
  workspaceId?: string;
  expertId?: string | null;
}

export interface SessionTreeNode {
  session: SessionListEntry;
  children: ReadonlyArray<SessionTreeNode>;
}

export type SessionListResult = ReadonlyArray<SessionListEntry>;

export interface ForkSessionResult {
  ok: boolean;
  error?: string;
  sessionPath?: string;
  entryId?: string;
}

export interface SessionUsageInfo {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  model?: AgentModelRef;
  startedAt?: string;
  durationMs?: number;
}

export interface SessionReadEntriesResult {
  ok: boolean;
  entries: ReadonlyArray<unknown>;
  cursor?: string;
  hasMore: boolean;
  error?: string;
}

export interface SessionFileResult {
  ok: boolean;
  path?: string;
  sizeBytes?: number;
  error?: string;
}

export interface RewindSessionResult {
  ok: boolean;
  error?: string;
  rewoundToEntryId?: string;
}

export interface RenameSessionResult {
  ok: boolean;
  error?: string;
}

export interface DeleteSessionResult {
  ok: boolean;
  error?: string;
}

export interface SetSessionFlagResult {
  ok: boolean;
  error?: string;
}

export interface SetAllArchivedResult {
  ok: boolean;
  archivedCount: number;
  error?: string;
}

export interface BindTenantResult {
  ok: boolean;
  error?: string;
  boundAt?: string;
}

export interface UpsertExpertResult {
  ok: boolean;
  error?: string;
}

// ============================================================================
// 6. Subagents / tasks
// ============================================================================

export interface SubagentChildInfo {
  id: string;
  parentSessionId: SessionId;
  path: string;
  cwd: string;
}

export type SubagentChildren = ReadonlyArray<SubagentChildInfo>;

export interface SubagentHistoryResult {
  entries: ReadonlyArray<unknown>;
  hasMore: boolean;
}

export interface SubagentPromptResult {
  ok: boolean;
  acceptedAt?: string;
  error?: string;
}

export interface SubagentInterruptResult {
  ok: boolean;
  error?: string;
}

export interface KillTaskResult {
  ok: boolean;
  error?: string;
}

export interface ListRunningTasksResult {
  tasks: ReadonlyArray<{
    id: string;
    kind: string;
    description: string;
    status: "running" | "completed" | "failed";
    sessionId?: SessionId;
    startedAt: number;
  }>;
}

// ============================================================================
// 7. Capabilities / Cordis
// ============================================================================

export interface RemoteContribution {
  packageName: string;
  kind: string;
  apply: (...args: unknown[]) => unknown;
}

export interface RemoteDispatchResult {
  handled: boolean;
  value?: unknown;
}

export interface DeepSeekCordisSnapshotInfo {
  /** Number of services currently bound to the deepseek cordis context. */
  services: number;
  /** Last snapshot epoch. */
  capturedAt: number;
  /** Optional public snapshot payload. */
  snapshot?: unknown;
}

export interface DeepSeekPiBridgeDescription {
  tools: ReadonlyArray<ToolEntry>;
  extensions: ReadonlyArray<string>;
  model?: AgentModelRef;
}

// ============================================================================
// 8. Profile / bundles
// ============================================================================

export interface ProfilePackageEntry {
  name: string;
  version: string;
  installed: boolean;
  source: "profile" | "marketplace" | "user";
  description?: string;
}

export interface ProfileBundleInstallResult {
  ok: boolean;
  bundleName?: string;
  installedCount?: number;
  error?: string;
}

// ============================================================================
// 9. Prompts / commands / skills / resources
// ============================================================================

export interface CommandInfo {
  name: string;
  description?: string;
  source: "user" | "profile" | "built-in";
}

export interface SkillInfo {
  name: string;
  description?: string;
  source: "user" | "profile" | "built-in";
  path?: string;
}

export interface ResourceInventory {
  skills: ReadonlyArray<SkillInfo>;
  commands: ReadonlyArray<CommandInfo>;
  themes: ReadonlyArray<{ name: string; source: "user" | "profile" | "built-in" }>;
}

export interface PluginReadinessInfo {
  phase: "pending" | "loading" | "ready" | "error";
  generation: number;
  transaction?: { id: string; kind: string; target: string; phase?: string; surface?: string };
  error?: string;
}

export interface AgentPresetInfo {
  id: string;
  name: string;
  description?: string;
  default?: boolean;
  modelRef?: AgentModelRef;
  toolAllowList?: ReadonlyArray<string>;
}

// ============================================================================
// 10. Harness / inspiration
// ============================================================================

export interface InspirationParams {
  topic: string;
  context?: string;
  count?: number;
  source?: "user" | "profile" | "mixed";
}

export interface InspirationResult {
  inspirations: ReadonlyArray<{
    id: string;
    title: string;
    body: string;
    tags: ReadonlyArray<string>;
  }>;
}

// ============================================================================
// 11. Dispatch helpers
// ============================================================================

/**
 * Concrete return type for prompt/steer/follow-up. The implementation
 * returns the full stream; consumers (ipc/agent.ts) translate that to
 * the renderer's channel-payload format.
 */
export interface PromptDispatchResult {
  ok: true;
  sessionId: SessionId;
  /** Whether the request was accepted into the queue. */
  queued: boolean;
  /** Trace correlation id. */
  traceId?: TraceId;
}

/**
 * Generic mutation result used by setModel, setThinkingLevel, etc.
 */
export interface MutationAck {
  ok: boolean;
  error?: { code: string; message: string };
}

export interface UiRequestResolveResult {
  ok: boolean;
  error?: string;
}
