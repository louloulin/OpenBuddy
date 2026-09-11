/**
 * OpenBuddy Pi client — typed wrappers over the versioned Electron preload API.
 *
 * Agent lifecycle calls use `agent:*` IPC and are owned by Electron Main's
 * in-process Pi AgentSession. Legacy capability names remain below only where
 * the existing WorkBuddy UI still consumes them.
 */
import { ensureRendererRpcChannel, invoke, listen, openPiStream, resolveRendererRpcInteraction, type UnlistenFn } from "@/lib/platform/electron-api";
import { createRendererLogger, generateTrace, withTrace } from "@openbuddy/logging-renderer";
import type {
  AgentDefaults,
  AgentEntry,
  Automation,
  ExpertCatalog,
  AutomationSnapshot,
  AutomationStatus,
  ConnectorCatalog,
  ConnectorCliAuthDoneEvent,
  ConnectorCliAuthLogEvent,
  ConnectorCliAuthResult,
  ConnectorCliAuthUrlEvent,
  ConnectorCliStatus,
  InspirationStarted,
  McpAuthStatusEntry,
  McpAuthTriggerResult,
  McpConfigFile,
  McpRuntimeStatus,
  McpServerEntry,
  McpUpsertRequest,
  PermissionRequest,
  PermissionRule,
  PromptComplete,
  RewindPoint,
  RunningTask,
  SearchHit,
  SessionInfoResponse,
  SessionSummary,
  SessionSummaryEvent,
  SessionUpdate,
  SessionUsage,
  SkillCatalog,
  SkillInfo,
  SlashCommand,
  SubagentLiveEvent,
  TurnErrorEvent,
  WorkBuddyImportPreview,
  WorkBuddyImportResult,
  WorkBuddyImportStatus,
} from "@openbuddy/shared-types";
import type { EmailProviderDiagnostic } from "@openbuddy/capability-email";
export type { EmailProviderDiagnostic } from "@openbuddy/capability-email";

export type { McpServerEntry } from "@openbuddy/shared-types";
import { getPiBridge } from "./pi-bridge-client";

const appLogger = createRendererLogger({
  devMode: ((typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) || false),
  name: "pi-client",
});

let currentTurnTrace: { traceId?: string; sessionId?: string } = {};

/**
 * Render-side `__pending_<nonce>` IDs (from `beginPendingNewSession` in App.tsx)
 * are placeholders the renderer uses to focus ChatView before `piNewSession`
 * returns the real id. Pi main has never seen them — the agent session,
 * persisted session directory, and SQLite session catalog all key off the
 * real id. Any session-mutating IPC (pin / archive / expert binding /
 * rename / delete) that leaks the placeholder hits `throw new Error("Pi
 * session not found: __pending_…")` inside the main-process handler.
 *
 * The cleanest defense lives here at the IPC boundary, *before* the
 * `window.api.invoke(...)` call lands in preload: every session-id-keyed
 * wrapper below routes through this guard so the bug cannot surface no
 * matter which UI surface triggers it. The two callers that previously
 * relied on a UI-side `isPending` check (TopbarActions pin/archive) get a
 * belt-and-suspenders duplicate; Sidebar's row context menu is now also
 * covered even if a placeholder ever leaks into `allSessions`.
 */
function assertRealSessionId(sessionId: string, op: string): void {
  // Phase R3.0 (pi-web-alignment) — changed from `throw` to `warn-only` so
  // a placeholder id leak is observable but non-fatal. The proper defense
  // lives in the UI layer (App.tsx disables destructive Sidebar/Topbar
  // actions while `pendingSessionIds.has(id)` is true). This guard remains
  // as a last-resort backstop for paths that didn't propagate the disabled
  // state — keeping it loud (logger.warn) instead of silent so the race
  // shows up in observability tooling.
  if (sessionId.startsWith("__pending_")) {
    appLogger.warn("pi.session.placeholder-leaked", {
      msg: "pi.session.placeholder-leaked",
      op,
      sessionId,
      hint: "Sidebar/Topbar should disable while the session is pending; this warning means a UI path bypassed that gate.",
    });
  }
}

function recordReceipt(event: string, payload: { traceId?: string; sessionId?: string; [key: string]: unknown } | undefined) {
  const traceId = payload?.traceId ?? currentTurnTrace.traceId;
  const sessionId = payload?.sessionId ?? currentTurnTrace.sessionId;
  const child = traceId ? withTrace(appLogger, traceId) : appLogger;
  const extras: Record<string, unknown> = {};
  if (sessionId) extras.sessionId = sessionId;
  child.info(`pi.${event}.received`, { msg: `pi.${event}.received`, ...extras });
}

import type { QuestionRequest } from "@/stores/question-store";
import type { PluginReadinessSnapshot, PluginSnapshot, PluginSnapshotRecovery } from "@openbuddy/plugin-host";

export * from "./pi-client-email";

export * from "./pi-client-collaboration";

// ---------- commands ----------

export interface AuthStatus {
  ready: boolean;
  /** True if ~/.pi/auth.json exists. */
  hasAuthFile: boolean;
  /** Human-readable reason when not ready. */
  reason?: string;
  /** Model ids configured in ~/.pi/agent/models.json (BYOK providers). */
  providers: string[];
}

export interface InitResult {
  /** Whether the agent initialized and authenticated successfully. */
  ok: boolean;
  auth: AuthStatus;
  /** The cwd the agent bound to (echoes the input). */
  cwd: string;
  agentVersion?: string;
  /** Default model id the agent will use. */
  defaultModelId?: string;
}

// ---------- notifications ----------
// Stage C-2: openbuddy-notification Cordis backend removed. Renderer callers
// (App.tsx) still expect a no-op stub so existing call sites compile. New code
// should use the renderer-native `dispatchNotification` from
// `@/lib/notify/notify-channels` (or the IPC bridge in `electron/preload`) instead.
export async function notificationAppend(
  category: string,
  title: string,
  body?: string,
  sessionId?: string,
  level: "info" | "warn" | "error" = "info",
): Promise<void> {
  if (typeof console !== "undefined") {
    const tag = `[${category}]${sessionId ? `(${sessionId})` : ""}`;
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    fn(tag, title, body ?? "");
  }
}

/**
 * Initialize the in-process pi agent. If `cwd` is omitted the backend
 * defaults to the user's home directory.
 */
export async function piInit(cwd?: string, options?: { traceId?: string }): Promise<InitResult> {
  const traceId = options?.traceId ?? generateTrace();
  const log = withTrace(appLogger, traceId);
  log.info("pi.init.requested", { msg: "pi.init.requested", cwd: cwd ?? null });
  try {
    const result = await invoke<InitResult>("agent:init", cwd);
    currentTurnTrace = { traceId, sessionId: undefined };
    log.info("pi.init.dispatched", { msg: "pi.init.dispatched" });
    return result;
  } catch (err) {
    log.error("pi.init.failed", { msg: "pi.init.failed", err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function piAuthStatus(): Promise<AuthStatus> {
  return invoke<AuthStatus>("agent:auth-status");
}

export interface PiAgentPreset {
  id: string;
  trust: "system" | "user";
  path: string;
  name?: string;
  description?: string;
  order?: number;
  broken?: string;
}

export async function piListAgentPresets(cwd?: string): Promise<PiAgentPreset[]> {
  return invoke<PiAgentPreset[]>("agent:presets-list", cwd);
}

export async function piCurrentAgentPreset(): Promise<{ id: string | null }> {
  return invoke<{ id: string | null }>("agent:preset-current");
}

export async function piSelectAgentPreset(id: string): Promise<{ id: string; path: string }> {
  return invoke<{ id: string; path: string }>("agent:preset-select", { id });
}

export async function piSaveAgentPresetDefault(id?: string): Promise<{ default?: string }> {
  return invoke<{ default?: string }>("agent:preset-default-save", id === undefined ? undefined : { id });
}

// NOTE: the backend `pi_new_session` command returns the session id as a
// bare `String` (see commands.rs pi_new_session). We type it as `string`
// here — do NOT wrap it in `{ sessionId }`, or callers destructuring
// `const { sessionId } = ...` will silently get undefined.
//
// `modelId` is passed as `_meta.modelId` to pi so the session binds to
// that model from the start (avoids the default `pi-build` model whose
// sampling config has no key in a BYOK-only setup).
export async function piNewSession(cwd: string, modelId?: string, options?: { traceId?: string }): Promise<string> {
  const traceId = options?.traceId ?? generateTrace();
  const log = withTrace(appLogger, traceId);
  log.info("pi.new-session.requested", { msg: "pi.new-session.requested", cwd, modelId });
  try {
    const result = await invoke<{ sessionId?: string }>("agent:new-session", { cwd, traceId });
    if (!result.sessionId) throw new Error("agent:new-session did not return a session id");
    currentTurnTrace = { traceId, sessionId: result.sessionId };
    if (modelId) await invoke("agent:set-model", { sessionId: result.sessionId, modelId, traceId });
    log.info("pi.new-session.dispatched", { msg: "pi.new-session.dispatched", sessionId: result.sessionId });
    return result.sessionId;
  } catch (err) {
    log.error("pi.new-session.failed", { msg: "pi.new-session.failed", err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Coalesced variant of `piNewSession`.
 *
 * Concurrent invocations with the same `${cwd}\0${modelId}` key share one
 * server-side Promise, returning the same sessionId. This is the
 * renderer-side hook for lazy / idempotent new-session requests (e.g.
 * `useAgentSession().ensureNewSession()` for an extension method that
 * needs *a* fresh session but doesn't care which one).
 *
 * The returned `sessionId` is **real** — never a `__pending_*` placeholder.
 * Caller code that wants the optimistic-UI placeholder dance should use
 * `useOptimisticNewSession` (see Phase 1) instead of calling this directly.
 */
export async function piEnsureNewSession(cwd: string, modelId?: string, options?: { traceId?: string }): Promise<string> {
  const traceId = options?.traceId ?? generateTrace();
  const log = withTrace(appLogger, traceId);
  log.info("pi.ensure-new-session.requested", { msg: "pi.ensure-new-session.requested", cwd, modelId });
  try {
    const result = await invoke<{ sessionId?: string }>("agent:ensure-new-session", { cwd, traceId });
    if (!result.sessionId) throw new Error("agent:ensure-new-session did not return a session id");
    currentTurnTrace = { traceId, sessionId: result.sessionId };
    if (modelId) await invoke("agent:set-model", { sessionId: result.sessionId, modelId, traceId });
    log.info("pi.ensure-new-session.dispatched", { msg: "pi.ensure-new-session.dispatched", sessionId: result.sessionId });
    return result.sessionId;
  } catch (err) {
    log.error("pi.ensure-new-session.failed", { msg: "pi.ensure-new-session.failed", err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// `pi_load_session` triggers a history replay on the agent side: pi
// re-emits the persisted transcript as a stream of SessionUpdate messages,
// which our existing `pi://update` listener already funnels into the
// session store. So this command returns nothing — callers just need to
// clear the local transcript first, then await this to confirm the agent
// accepted the load.
export async function piLoadSession(sessionId: string, cwd: string, options?: { traceId?: string }): Promise<void> {
  const traceId = options?.traceId ?? generateTrace();
  const log = withTrace(appLogger, traceId);
  log.info("pi.load-session.requested", { msg: "pi.load-session.requested", sessionId, cwd });
  try {
    await invoke<void>("agent:load-session", { sessionId, cwd, traceId });
    currentTurnTrace = { traceId, sessionId };
    log.info("pi.load-session.dispatched", { msg: "pi.load-session.dispatched", sessionId });
  } catch (err) {
    log.error("pi.load-session.failed", { msg: "pi.load-session.failed", sessionId, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function piListSessions(cwd: string): Promise<SessionSummary[]> {
  return invoke<SessionSummary[]>("sessions:list", cwd);
}

/** A discovered working directory (pi has run sessions in it). */
export interface WorkspaceInfo {
  /** Absolute path of the working directory. */
  cwd: string;
  /** Number of sessions recorded under this cwd. */
  sessionCount: number;
  /** Title of the most recent session under this cwd (optional, for display). */
  lastTitle?: string;
  /** Stable DeepSeek Harness workspace id when the registry is available. */
  workspaceId?: string;
  /** Registry display title; falls back to the cwd basename. */
  title?: string;
  path?: string;
  sessionIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  archivedSessionIds?: string[];
}

export interface WorkspaceRegistryResponse {
  items: WorkspaceInfo[];
  archivedSessionIds: string[];
}

/**
 * List every working directory pi has ever seen (deduplicated), with a
 * session count per cwd. Used to populate the Composer's workspace picker.
 */
export async function piListWorkspaces(): Promise<WorkspaceInfo[]> {
  return invoke<WorkspaceInfo[]>("sessions:list-workspaces");
}

export async function piListWorkspaceRegistry(): Promise<WorkspaceRegistryResponse> {
  return invoke<WorkspaceRegistryResponse>("workspace:list");
}

export async function piCreateWorkspace(path: string, title?: string): Promise<{ workspace: WorkspaceInfo; created: boolean }> {
  return invoke("workspace:create", { path, ...(title === undefined ? {} : { title }) });
}

export async function piRenameWorkspace(workspaceId: string, title: string): Promise<{ workspace: WorkspaceInfo }> {
  return invoke("workspace:rename", { workspaceId, title });
}

export async function piDeleteWorkspace(workspaceId: string): Promise<{ deleted: boolean }> {
  return invoke("workspace:delete", { workspaceId });
}

export async function piReorderWorkspace(workspaceId: string, beforeWorkspaceId?: string): Promise<{ workspaceIds: string[] }> {
  return invoke("workspace:insert-before", { workspaceId, ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }) });
}

/**
 * Switch the model used by an existing session (pi's `session/set_model`).
 * May reject with `MODEL_SWITCH_INCOMPATIBLE_AGENT` if the session has turns
 * and the new model requires a different agent harness — surface that error
 * to the user (suggest starting a new session).
 */
export async function piSetModel(sessionId: string, modelId: string, options?: { traceId?: string }): Promise<void> {
  const traceId = options?.traceId ?? currentTurnTrace.traceId ?? generateTrace();
  const log = withTrace(appLogger, traceId);
  log.info("pi.set-model.requested", { msg: "pi.set-model.requested", sessionId, modelId });
  try {
    await invoke<void>("agent:set-model", { sessionId, modelId, traceId });
    log.info("pi.set-model.dispatched", { msg: "pi.set-model.dispatched", sessionId, modelId });
  } catch (err) {
    log.error("pi.set-model.failed", { msg: "pi.set-model.failed", sessionId, modelId, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** Send a user prompt; streamed updates arrive via the events below. */
export async function piSend(sessionId: string, text: string, options?: { traceId?: string }): Promise<void> {
  const traceId = options?.traceId ?? generateTrace();
  const log = withTrace(appLogger, traceId);
  log.info("pi.send.requested", { msg: "pi.send.requested", sessionId, textLength: text?.length ?? 0 });
  try {
    await invoke<void>("agent:prompt", { sessionId, text, traceId });
    log.info("pi.send.dispatched", { msg: "pi.send.dispatched", sessionId });
  } catch (err) {
    log.error("pi.send.failed", { msg: "pi.send.failed", sessionId, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function piSteer(sessionId: string, text: string, options?: { traceId?: string }): Promise<void> {
  const traceId = options?.traceId ?? generateTrace();
  const log = withTrace(appLogger, traceId);
  log.info("pi.steer.requested", { msg: "pi.steer.requested", sessionId, textLength: text?.length ?? 0 });
  try {
    await invoke<void>("agent:steer", { sessionId, text, traceId });
    log.info("pi.steer.dispatched", { msg: "pi.steer.dispatched", sessionId });
  } catch (err) {
    log.error("pi.steer.failed", { msg: "pi.steer.failed", sessionId, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function piFollowUp(sessionId: string, text: string, options?: { traceId?: string }): Promise<void> {
  const traceId = options?.traceId ?? generateTrace();
  const log = withTrace(appLogger, traceId);
  log.info("pi.follow-up.requested", { msg: "pi.follow-up.requested", sessionId, textLength: text?.length ?? 0 });
  try {
    await invoke<void>("agent:follow-up", { sessionId, text, traceId });
    log.info("pi.follow-up.dispatched", { msg: "pi.follow-up.dispatched", sessionId });
  } catch (err) {
    log.error("pi.follow-up.failed", { msg: "pi.follow-up.failed", sessionId, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function piCancel(sessionId: string, options?: { traceId?: string }): Promise<void> {
  const traceId = options?.traceId ?? currentTurnTrace.traceId ?? generateTrace();
  const log = withTrace(appLogger, traceId);
  log.info("pi.cancel.requested", { msg: "pi.cancel.requested", sessionId });
  try {
    await invoke<void>("agent:abort", { sessionId, traceId });
    log.info("pi.cancel.dispatched", { msg: "pi.cancel.dispatched", sessionId });
  } catch (err) {
    log.error("pi.cancel.failed", { msg: "pi.cancel.failed", sessionId, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** Cleanly shut down the agent so `piInit` can be called again to restart. */
export interface OpenBuddyWorkspaceHit {
  kind: "file" | "symbol" | "folder";
  path: string;
  absPath: string;
  preview: string;
  score: number;
}

/** Search the workspace for files/folders/symbols that match `query`. Used
 *  by the Composer's @-mention picker. */
export async function workspaceSearch(
    query: string,
    cwd: string,
    options?: { limit?: number; kinds?: Array<"file" | "folder" | "symbol">; traceId?: string },
): Promise<{ hits: OpenBuddyWorkspaceHit[]; duration_ms: number; source: "rg" | "grep" | "walk" | "none" }> {
    const traceId = options?.traceId ?? generateTrace();
    const log = withTrace(appLogger, traceId);
    log.info("workspace-search.requested", { msg: "workspace-search.requested", query, cwd });
    try {
        const result = await invoke<{ hits: OpenBuddyWorkspaceHit[]; duration_ms: number; source: "rg" | "grep" | "walk" | "none" }>(
            "agent:workspace-search",
            { query, cwd, ...(options?.limit !== undefined ? { limit: options.limit } : {}), ...(options?.kinds ? { kinds: options.kinds } : {}), traceId },
        );
        log.info("workspace-search.dispatched", { msg: "workspace-search.dispatched", hits: result.hits.length, duration_ms: result.duration_ms });
        return result;
    } catch (err) {
        log.error("workspace-search.failed", { msg: "workspace-search.failed", err: err instanceof Error ? err.message : String(err) });
        throw err;
    }
}

export type OpenBuddyThinkingLevel = "off" | "low" | "medium" | "high";
export type OpenBuddyPermissionMode = "default" | "acceptEdits" | "dontAsk" | "plan" | "bypassPermissions";

/** Send a user prompt as a content array (text + image parts). Streams updates
 *  via the standard pi:// events. Falls back to text-only piSend when the
 *  payload is a single text part. */
export async function piSendContent(
    sessionId: string,
    content: Array<
        | { type: "text"; text: string }
        | { type: "image"; mediaType: string; data: string; name?: string }
    >,
    options?: { traceId?: string; mode?: "queue" | "steer" },
): Promise<{ ok: true; itemId?: string }> {
    const traceId = options?.traceId ?? generateTrace();
    const log = withTrace(appLogger, traceId);
    log.info("pi.send-content.requested", { msg: "pi.send-content.requested", sessionId, parts: content.length });
    try {
        const result = await invoke<{ ok: true; itemId?: string }>("agent:prompt-content", {
            sessionId,
            content,
            mode: options?.mode ?? "queue",
            traceId,
        });
        log.info("pi.send-content.dispatched", { msg: "pi.send-content.dispatched", sessionId });
        return result;
    } catch (err) {
        log.error("pi.send-content.failed", { msg: "pi.send-content.failed", sessionId, err: err instanceof Error ? err.message : String(err) });
        throw err;
    }
}

/** Set the active thinking level for the current session. Persists as a
 *  thinking_level_change entry in the session tree. */
export async function piSetThinkingLevel(
    sessionId: string,
    level: OpenBuddyThinkingLevel,
    options?: { traceId?: string },
): Promise<{ ok: true; level: OpenBuddyThinkingLevel }> {
    const traceId = options?.traceId ?? generateTrace();
    const log = withTrace(appLogger, traceId);
    log.info("pi.set-thinking-level.requested", { msg: "pi.set-thinking-level.requested", sessionId, level });
    try {
        const result = await invoke<{ ok: true; level: OpenBuddyThinkingLevel }>("agent:set-thinking-level", { sessionId, level, traceId });
        log.info("pi.set-thinking-level.dispatched", { msg: "pi.set-thinking-level.dispatched", sessionId, level });
        return result;
    } catch (err) {
        log.error("pi.set-thinking-level.failed", { msg: "pi.set-thinking-level.failed", sessionId, err: err instanceof Error ? err.message : String(err) });
        throw err;
    }
}

/** Set the public 5 档 permission mode (default/acceptEdits/dontAsk/plan/bypassPermissions).
 *  Persists via the Cordis permission service so Pi's tool interceptor and
 *  OpenBuddy's permission rules see a consistent view. */
export async function piSetPermissionMode(
    sessionId: string,
    mode: OpenBuddyPermissionMode,
    options?: { traceId?: string },
): Promise<{ ok: true; mode: OpenBuddyPermissionMode }> {
    const traceId = options?.traceId ?? generateTrace();
    const log = withTrace(appLogger, traceId);
    log.info("pi.set-permission-mode.requested", { msg: "pi.set-permission-mode.requested", sessionId, mode });
    try {
        const result = await invoke<{ ok: true; mode: OpenBuddyPermissionMode }>("agent:set-permission-mode", { sessionId, mode, traceId });
        log.info("pi.set-permission-mode.dispatched", { msg: "pi.set-permission-mode.dispatched", sessionId, mode });
        return result;
    } catch (err) {
        log.error("pi.set-permission-mode.failed", { msg: "pi.set-permission-mode.failed", sessionId, err: err instanceof Error ? err.message : String(err) });
        throw err;
    }
}

export async function piShutdown(): Promise<void> {
  await invoke<void>("agent:dispose");
}

export const agentInit = piInit;
export const agentNewSession = piNewSession;
export const agentSetModel = piSetModel;
export const agentPrompt = piSend;
export const agentAbort = piCancel;
export const agentDispose = piShutdown;

// ---------- openbuddy plugin runtime (renderer-side mirror of main) ----------

export type OpenBuddyPluginState = "pending" | "loaded" | "disabled" | "failed" | "unloaded";

export interface OpenBuddyPluginStatus {
  id: string;
  name: string;
  state: OpenBuddyPluginState;
  error?: string;
  kind?: "cordis" | "pi";
  source?: string;
  builtIn?: boolean;
  managed?: boolean;
  sourceScope?: "user" | "project" | "temporary";
  sourceOrigin?: "package" | "top-level";
  sourceBaseDir?: string;
  mode?: "native" | "adapter";
  adapter?: string;
  /** Slash commands projected onto Pi by the compatibility adapter. */
  commands?: readonly string[];
  health?: "healthy" | "degraded" | "failed";
  packageName?: string;
  version?: string;
  diagnostics?: readonly string[];
  disabledReason?: "user" | "policy" | "load-failed";
  toolCount?: number;
  hookCount?: number;
  loadedAt?: string;
}

export interface OpenBuddyProviderInventoryEntry {
  id: string;
  source: "pi-extension" | "user-config" | "builtin";
  extensionPath?: string;
}

export interface OpenBuddyPluginInventory {
  entries: OpenBuddyPluginStatus[];
  piExtensions: OpenBuddyPluginStatus[];
  renderers: OpenBuddyRendererPluginEntry[];
  packages: OpenBuddyProfilePackage[];
  providers: OpenBuddyProviderInventoryEntry[];
  terminals?: {
    backends: string[];
    sessionCount: number;
  };
}

export interface OpenBuddyResourceInventory {
  extensions: Array<{
    id: string;
    name: string;
    path: string;
    resolvedPath?: string;
    state: OpenBuddyPluginState;
    source?: string;
    builtIn?: boolean;
    managed?: boolean;
    sourceScope?: "user" | "project" | "temporary";
    sourceOrigin?: "package" | "top-level";
    sourceBaseDir?: string;
    packageName?: string;
    version?: string;
    diagnostics?: readonly string[];
    disabledReason?: "user" | "policy" | "load-failed";
    mode?: "native" | "adapter";
    adapter?: string;
    commands: string[];
    tools: string[];
    commandCount: number;
    toolCount: number;
    health: "healthy" | "degraded" | "failed";
    error?: string;
  }>;
  agents: Array<{ name: string; path: string }>;
  skills: Array<{ name: string; path: string }>;
  prompts: Array<{ name: string; path: string }>;
  themes: Array<{ name: string; path: string }>;
  hooks: Array<{ packageName: string; packageRoot: string; dialect: string; points: string[]; diagnostics: Array<{ level: string; message: string; event?: string; matcher?: string }> }>;
  diagnostics: Array<{ type: string; path?: string; message: string }>;
}

export interface OpenBuddyPluginEvent {
  type: string;
  payload: unknown;
  eventVersion?: 1;
  sequence?: number;
  timestamp?: string;
  sessionId?: string;
}

export interface OpenBuddySessionEventRecord extends OpenBuddyPluginEvent {
  sequence: number;
  sessionSequence?: number;
  timestamp: string;
}

export interface OpenBuddyRendererPluginEntry {
  id: string;
  moduleId?: string;
  moduleKey?: string;
  name: string;
  inject?: string[];
  external?: string[];
  immediately?: boolean;
  config?: unknown;
  disabled?: boolean;
  moduleUrl?: string;
}

export interface OpenBuddyRendererPluginBootGraph {
  rev: string;
  entries: Array<{
    id: string;
    url: string;
    rev: string;
    inject?: string[];
    external?: string[];
    immediately?: boolean;
  }>;
}

export interface OpenBuddyRemoteContribution {
  package: string;
  descriptors: Array<{
    namespace: string;
    method: string;
    [key: string]: unknown;
  }>;
}

/** Snapshot of every Harness plugin the main agent has loaded so far. */
export async function agentListPlugins(): Promise<OpenBuddyPluginStatus[]> {
  return invoke<OpenBuddyPluginStatus[]>("agent:plugin-list");
}

export async function agentPluginInventory(): Promise<OpenBuddyPluginInventory> {
  return invoke<OpenBuddyPluginInventory>("agent:plugin-inventory");
}

export async function agentPluginSnapshot(): Promise<PluginSnapshot> {
  return invoke<PluginSnapshot>("agent:plugin-snapshot");
}

export async function agentPluginReadiness(): Promise<PluginReadinessSnapshot> {
  return invoke<PluginReadinessSnapshot>("agent:plugin-readiness");
}

export interface AgentToolDescriptor {
  name: string;
  label: string;
  description: string;
  /** `"pi"` for built-in / extension tools; `"openbuddy"` for G-1d compatibilityAdapter tools. */
  source: "pi" | "openbuddy";
  /** Upstream pi package that provides the tool (null when source = "openbuddy"). */
  piPackageHint: string | null;
}

/**
 * Snapshot of every tool the active Pi runtime exposes (G-1d adapter tools
 * + built-in tools). Renderer-side menus use this to surface the same tool
 * list the model sees, grouped by source.
 */
export async function agentToolsList(): Promise<AgentToolDescriptor[]> {
  return invoke<AgentToolDescriptor[]>("agent:tools-list");
}

export async function agentDeepSeekCordisSnapshot(): Promise<unknown> {
  return invoke<unknown>("agent:deepseek-cordis-snapshot");
}

export interface HarnessRecoveryIntent {
  rpcId: string;
  method: string;
  status: "pending" | "uncertain";
  createdAt: number;
  expiresAt: number;
  claimedBy?: string;
  claimExpiresAt?: number;
}

export interface HarnessRecoveryClaim {
  rpcId: string;
  method: string;
  status: "claimed";
  claimant: string;
  expiresAt: number;
  token: string;
}

export interface HarnessRecoveryResolve {
	rpcId: string;
	status: "committed" | "aborted";
	claimant?: string;
	receipt: { recovered: true; rpcId: string; status: "committed" | "aborted"; claimant?: string };
}

/** Snapshot of the durable side-effect RPC recovery queue (no auth roundtrip). */
export async function harnessRecoveryStatus(): Promise<PluginSnapshotRecovery> {
  return invoke<PluginSnapshotRecovery>("harness:recovery-status");
}

/** List every persisted recovery intent (pending + uncertain). */
export async function harnessRecoveryList(): Promise<{ intents: readonly HarnessRecoveryIntent[] }> {
  return invoke<{ intents: readonly HarnessRecoveryIntent[] }>("harness:recovery-list");
}

/** Claim an uncertain intent, returning an HMAC-signed token usable in `harnessRecoveryResolve`. */
export async function harnessRecoveryClaim(rpcId: string, claimant: string): Promise<HarnessRecoveryClaim> {
  return invoke<HarnessRecoveryClaim>("harness:recovery-claim", { rpcId, claimant });
}

/** Resolve a previously-claimed intent as either committed or aborted; the host persists a recovery receipt. */
export async function harnessRecoveryResolve(rpcId: string, token: string, action: "committed" | "aborted"): Promise<HarnessRecoveryResolve> {
  return invoke<HarnessRecoveryResolve>("harness:recovery-resolve", { rpcId, token, action });
}

export type DeepSeekPiBridgeDescription = {
  protocol: "openbuddy.pi.v1";
  runtime: "pi";
  capabilities: Record<string, readonly string[]>;
};

export async function agentDeepSeekPiBridgeDescription(): Promise<DeepSeekPiBridgeDescription> {
  return invoke<DeepSeekPiBridgeDescription>("agent:deepseek-pi-describe");
}

export async function agentDeepSeekPiCapability<T = unknown>(
  capability: "session" | "web" | "subagent",
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const bridge = await agentDeepSeekPiBridgeDescription();
  if (!bridge.capabilities[capability]?.includes(method)) {
    throw new Error(`DeepSeek Pi capability is unavailable: ${capability}/${method}`);
  }
  return agentDeepSeekCordisInvoke({
    service: "pi",
    method: "invokeCapability",
    args: { capability, method, args },
  }) as Promise<T>;
}

export async function agentDeepSeekCordisInvoke(request: { service: string; method: string; args?: readonly unknown[] | Record<string, unknown>; parameters?: readonly string[] }): Promise<unknown> {
  return invoke<unknown>("agent:deepseek-cordis-invoke", request);
}

export async function agentResourceInventory(): Promise<OpenBuddyResourceInventory> {
  return invoke<OpenBuddyResourceInventory>("agent:resource-inventory");
}

export async function agentListRendererPluginEntries(): Promise<OpenBuddyRendererPluginEntry[]> {
  return invoke<OpenBuddyRendererPluginEntry[]>("agent:renderer-plugin-entries");
}

export async function agentRendererPluginBootGraph(): Promise<OpenBuddyRendererPluginBootGraph> {
  return invoke<OpenBuddyRendererPluginBootGraph>("agent:renderer-plugin-boot");
}

export async function agentResolveRendererPluginModule(moduleKey: string): Promise<string> {
  return invoke<string>("agent:renderer-plugin-module", { moduleKey });
}

export async function agentListRemoteContributions(): Promise<OpenBuddyRemoteContribution[]> {
  return invoke<OpenBuddyRemoteContribution[]>("agent:remote-contributions");
}

export interface OpenBuddyTypertCatalog {
  packages: Array<{
    package: string;
    face: "host";
    key: string;
    model: Record<string, unknown>;
    invocations: unknown[];
    schemas: Array<{ key: string; name: string; schema?: Record<string, unknown> }>;
  }>;
  diagnostics: Array<{ package: string; key: string; message: string }>;
}

/** Read the live DeepSeek Harness/Typert package catalog from Main. */
export async function agentTypertCatalog(): Promise<OpenBuddyTypertCatalog> {
  return invoke<OpenBuddyTypertCatalog>("dsh:rpc", {
    type: "client-request",
    rpcId: `typert-catalog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method: "typert.catalog",
    payload: {},
  }).then((response) => {
    const result = response as { result?: { ok?: boolean; value?: OpenBuddyTypertCatalog; error?: { message?: string } } };
    if (!result.result?.ok) throw new Error(result.result?.error?.message ?? "Typert catalog is unavailable");
    return result.result.value as OpenBuddyTypertCatalog;
  });
}

/** Replayable ring buffer of plugin events captured by main (max 2000). */
export async function agentPluginEvents(): Promise<OpenBuddyPluginEvent[]> {
  return invoke<OpenBuddyPluginEvent[]>("agent:plugin-events");
}

/**
 * Pull persisted session entries (user / assistant / tool messages) for a
 * loaded session. Used by App.tsx after piLoadSession to repopulate the
 * transcript mirror when switching to a historical session — Phase 4
 * delegated transcript ownership to pi, so the renderer has to fetch it
 * explicitly on every session switch.
 *
 * Returns raw SessionEntry[]; callers map them to ChatMessage[] with
 * the helper  in pi-client.
 */
export interface PiSessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  // For type === "message":
  message?: {
    role: "user" | "assistant" | "tool";
    content: Array<
      | { type: "text"; text: string }
      | { type: "thinking"; text: string }
      | { type: "toolCall"; id: string; name: string; arguments: unknown; result?: unknown }
      | { type: string; [key: string]: unknown }
    >;
    timestamp?: number;
  };
  // For type === "model_change":
  provider?: string;
  modelId?: string;
  // For type === "thinking_level_change":
  thinkingLevel?: string;
  // For type === "custom":
  customType?: string;
  data?: unknown;
}

export async function agentSessionMessages(sessionId: string): Promise<PiSessionEntry[]> {
  return invoke<PiSessionEntry[]>("agent:session-messages", { sessionId });
}

/**
 * Map pi SessionEntry[] to ChatMessage[] used by session-store.
 *
 * Filters to entries with type === "message"; user / assistant roles become
 * ChatMessage; tool role collapses to an assistant message carrying the tool
 * result text (so the existing MessageItem renderer does not need a new
 * branch). The last seen sequence of model_change entries is returned as a
 * sibling field so the UI can recover model identity without a second IPC.
 */
export interface SessionEntriesProjection {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    parts: Array<
      | { kind: "text"; text: string }
      | { kind: "thought"; text: string }
      | { kind: "tool_call"; toolCall: { toolCallId: string; title: string; kind: string; status: "completed" | "failed"; content: unknown[] } }
    >;
    complete: boolean;
  }>;
  model?: { provider: string; modelId: string };
}

export function sessionEntriesToChatMessages(entries: readonly PiSessionEntry[]): SessionEntriesProjection {
  const messages: SessionEntriesProjection["messages"] = [];
  let model: SessionEntriesProjection["model"];
  for (const entry of entries) {
    if (entry.type === "message" && entry.message) {
      const role = entry.message.role;
      if (role !== "user" && role !== "assistant") continue;
      const parts: SessionEntriesProjection["messages"][number]["parts"] = [];
      for (const part of entry.message.content ?? []) {
        if (part.type === "text" && typeof (part as { text?: string }).text === "string") {
          parts.push({ kind: "text", text: (part as { text: string }).text });
        } else if (part.type === "thinking" && typeof (part as { text?: string }).text === "string") {
          parts.push({ kind: "thought", text: (part as { text: string }).text });
        } else if (part.type === "toolCall") {
          const tc = part as { id?: string; name?: string; arguments?: unknown; result?: unknown };
          const toolCallId = tc.id ?? `tc-${entry.id}-${parts.length}`;
          parts.push({
            kind: "tool_call",
            toolCall: {
              toolCallId,
              title: tc.name ?? "tool",
              kind: tc.name ?? "tool",
              status: tc.result === undefined ? "completed" : "completed",
              content: Array.isArray(tc.result)
                ? (tc.result as unknown[])
                : tc.result !== undefined
                  ? [{ type: "text", text: typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result) }]
                  : [],
            },
          });
        }
      }
      messages.push({ id: entry.id, role, parts, complete: true });
    } else if (entry.type === "model_change" && entry.provider && entry.modelId) {
      model = { provider: entry.provider, modelId: entry.modelId };
    }
  }
  return { messages, model };
}

export async function agentSessionEventLog(query?: { sessionId?: string; sinceSequence?: number; limit?: number }): Promise<OpenBuddySessionEventRecord[]> {
  return invoke<OpenBuddySessionEventRecord[]>("agent:event-log", query);
}

export async function agentCurrentModel(): Promise<unknown> {
  return invoke("agent:current-model");
}

export async function agentListCommands(): Promise<unknown[]> {
  return invoke<unknown[]>("agent:commands-list");
}

/** Subscribe to live plugin events streamed from main. Returns an unlisten fn. */
export async function agentOnPluginEvent(
  handler: (event: OpenBuddyPluginEvent) => void,
): Promise<UnlistenFn> {
  return listen<OpenBuddyPluginEvent>("openbuddy://plugin-event", (e) => handler(e.payload));
}

/** Subscribe to the structured Pi AgentSession event stream. */
export async function agentOnEvent(
  handler: (event: OpenBuddyPluginEvent) => void,
): Promise<UnlistenFn> {
  return listen<OpenBuddyPluginEvent>("openbuddy://agent-event", (e) => handler(e.payload));
}

/**
 * Subscribe to pi telemetry events streamed from main so the renderer can
 * funnel them through the existing `reportEvent(...)` provider pipeline.
 * Backed by `pi://telemetry`; the listener is best-effort and survives a
 * missing payload by calling the handler with `null`.
 */
export async function agentOnPiTelemetryEvent(
  handler: (event: { name: string; level: "debug" | "info" | "warn" | "error"; props?: Record<string, unknown>; ts?: number }) => void,
): Promise<UnlistenFn> {
  return listen<{ name: string; level: "debug" | "info" | "warn" | "error"; props?: Record<string, unknown>; ts?: number }>("pi://telemetry", (e) => handler(e.payload));
}

/** Toggle a single plugin on/off through `HarnessPluginLoader.update`. */
export async function agentSetPluginEnabled(
  id: string,
  enabled: boolean,
): Promise<OpenBuddyPluginStatus | null> {
  return invoke<OpenBuddyPluginStatus | null>("agent:plugin-enable", { id, enabled });
}

/** Re-import + re-apply a plugin through the same loader lifecycle. */
export async function agentReloadPlugin(id: string): Promise<OpenBuddyPluginStatus | null> {
  return invoke<OpenBuddyPluginStatus | null>("agent:plugin-reload", { id });
}

/** Replace a plugin's runtime config; loader drives Cordis update + cleanup. */
export async function agentUpdatePluginConfig(
  id: string,
  config: unknown,
): Promise<OpenBuddyPluginStatus | null> {
  return invoke<OpenBuddyPluginStatus | null>("agent:plugin-config", { id, config });
}

export interface OpenBuddyPluginTransactionReceiptResult {
  ok: boolean;
  transactionId?: string;
  surface?: string;
  error?: string;
}

export interface OpenBuddyPluginActiveTransaction {
  transactionId: string;
  kind: string;
  target: string;
  requiredReceipts: readonly string[];
}

/**
 * Renderer → Main 通道:把 renderer side 的 receipt 写入到当前活跃事务。
 *
 * 在 `profile/reloaded` / `pi/extensions-reloaded` / `typert/registry-changed`
 * 触发的 `reloadDiscoveredProfile()` 完成后调用一次,用于关闭 "renderer" surface。
 *
 * Main 端的 `awaitSurfaceReceipt("renderer", 5000)` 会在 receipt 到达时
 * resolve;如果超时,该次事务 commit 会失败并回滚到上一次已提交状态。
 */
export async function agentReportTransactionReceipt(
  transactionId: string,
  surface: string,
  details?: Record<string, unknown>,
): Promise<OpenBuddyPluginTransactionReceiptResult> {
  return invoke<OpenBuddyPluginTransactionReceiptResult>("agent:transaction-receipt", {
    transactionId,
    surface,
    ...(details ? { details } : {}),
  });
}

/** 当前 Main 端活跃的事务列表(只用于调试与 UI 提示)。 */
export async function agentListActiveTransactions(): Promise<OpenBuddyPluginActiveTransaction[]> {
  return invoke<OpenBuddyPluginActiveTransaction[]>("agent:transaction-list");
}

export interface OpenBuddyPluginStateSnapshot {
  updatedAt: string;
  overrides: Record<string, { disabled?: boolean; config?: unknown }>;
  piExtensions?: Record<string, { enabled?: boolean; config?: unknown }>;
}

export interface OpenBuddyProfilePackage {
  name: string;
  version?: string;
  path: string;
  installed: boolean;
  bundle: boolean;
  client: boolean;
  pi: boolean;
  remote: boolean;
  typert: boolean;
  cordis: boolean;
  listed: boolean;
  health: "healthy" | "degraded";
  dependencies: OpenBuddyProfileDependencyDiagnostic[];
  manifest: {
    schema: "openbuddy.plugin.v1";
    name: string;
    path: string;
    version?: string;
    namespaces: Array<"openbuddy" | "dsh" | "pi">;
    surfaces: Array<{ kind: "bundle" | "pi" | "renderer" | "remote" | "typert" | "cordis"; namespace: "openbuddy" | "dsh" | "pi"; resources?: string[] }>;
    listed: boolean;
    health: "healthy" | "degraded";
    loaded: Array<"bundle" | "pi" | "renderer" | "remote" | "typert" | "cordis">;
    missing: Array<"bundle" | "pi" | "renderer" | "remote" | "typert" | "cordis">;
  };
}

export interface OpenBuddyProfileDependencyDiagnostic {
  name: string;
  requested: string;
  installed?: string;
  kind: "dependency" | "optional" | "peer";
  health: "ok" | "missing" | "version-mismatch" | "invalid";
  message: string;
}

export async function agentProfilePackages(): Promise<OpenBuddyProfilePackage[]> {
  return invoke<OpenBuddyProfilePackage[]>("agent:profile-packages");
}

export async function agentInstallProfilePackage(source: string): Promise<OpenBuddyProfilePackage> {
	return invoke<OpenBuddyProfilePackage>("agent:profile-install", { source });
}

export async function agentRemoveProfilePackage(name: string): Promise<void> {
  await invoke("agent:profile-remove", { name });
}

/** C6: Trigger install of the curated default Pi package bundle via IPC.
 *  Returns the per-package status list — already-installed packages are skipped
 *  unless `force` is true. */
export interface OpenBuddyDefaultPiPackageResult {
  spec: string;
  status: "installed" | "skipped" | "failed";
  error?: string;
}
export async function agentInstallDefaultPiPackages(
  options: { force?: boolean } = {},
): Promise<OpenBuddyDefaultPiPackageResult[]> {
  return invoke<OpenBuddyDefaultPiPackageResult[]>("agent:profile-install-default-pi", options);
}

/** Snapshot the persisted plugin overrides — UI surface for the "saved" badge. */
export async function agentGetStoredPluginState(): Promise<OpenBuddyPluginStateSnapshot | null> {
  return invoke<OpenBuddyPluginStateSnapshot | null>("agent:plugin-state-get");
}

/** Remove a single plugin's persisted override (revert to profile defaults). */
export async function agentResetPluginState(
  id: string,
): Promise<OpenBuddyPluginStateSnapshot> {
  return invoke<OpenBuddyPluginStateSnapshot>("agent:plugin-state-reset", { id });
}

/**
 * Rename a session via pi's `x.ai/session/rename` extension method. pi
 * writes `generated_title` + `title_is_manual=true` to summary.json and
 * broadcasts `SessionSummaryGenerated`, which we also pick up via the
 * `pi://summary` event — so callers don't strictly need to optimistically
 * update the title, but doing so avoids a flicker while the event round-trips.
 *
 * `cwd` is optional but narrows pi's on-disk session lookup.
 */
export async function piRenameSession(
  sessionId: string,
  title: string,
  cwd?: string,
): Promise<void> {
  assertRealSessionId(sessionId, "piRenameSession");
  await invoke<void>("sessions:rename", { sessionId, title, cwd: cwd ?? null });
}

/**
 * Delete a session's persisted history via pi's `x.ai/session/delete`.
 * Removes the on-disk session directory; the caller should drop the sidebar
 * entry on success.
 */
export async function piDeleteSession(sessionId: string, cwd?: string): Promise<void> {
  assertRealSessionId(sessionId, "piDeleteSession");
  await invoke<void>("sessions:delete", { sessionId, cwd: cwd ?? null });
}

/**
 * Pin/unpin a session. pi's Summary has no pinned field, so this is
 * OpenBuddy-only metadata stored in the SQLite session catalog; the legacy
 * `~/.pi/openbuddy-state.json` file is only a compatibility mirror. Returns the
 * new pinned value.
 */
export async function piSetSessionPinned(
  sessionId: string,
  pinned: boolean,
): Promise<boolean> {
  assertRealSessionId(sessionId, "piSetSessionPinned");
  return invoke<boolean>("sessions:set-pinned", { id: sessionId, pinned });
}

/**
 * Archive/unarchive a session. pi's Summary has no archived field, so this is
 * OpenBuddy-only metadata stored in the SQLite session catalog; the legacy
 * `~/.pi/openbuddy-state.json` file is only a compatibility mirror. Archived
 * sessions are kept in the sidebar (R2.5) — they're rendered in a dedicated
 * "已归档" group with a one-click 恢复 action so an accidental bulk archive
 * is recoverable through the UI. Returns the new archived value.
 */
export async function piSetSessionArchived(
  sessionId: string,
  archived: boolean,
): Promise<boolean> {
  assertRealSessionId(sessionId, "piSetSessionArchived");
  return invoke<boolean>("sessions:set-archived", { id: sessionId, archived });
}

/**
 * Bulk archive/unarchive every session known to the agent host. Used by the
 * Sidebar's "恢复全部" / "归档全部" buttons so a 70+ session recovery is a
 * single click instead of N. Returns the count of sessions whose archived
 * flag actually changed (the toast in the UI surfaces this).
 */
export async function piSetAllSessionsArchived(
  archived: boolean,
): Promise<{ updated: number }> {
  return invoke<{ updated: number }>("sessions:set-all-archived", { archived });
}

// ---------- context usage (x.ai/session/info + x.ai/session/usage) ----------

/**
 * Fetch the session's context-window snapshot (`x.ai/session/info`) for the
 * composer's context-usage pill/popover. Returns null when the session is
 * persisted but not live in the current agent process.
 */
export async function piSessionInfo(sessionId: string): Promise<SessionInfoResponse | null> {
	return invoke<SessionInfoResponse>("agent:session-info", { sessionId });
}

/**
 * Fetch the session's cumulative token usage (`x.ai/session/usage`). Returns
 * null when the session is persisted but not live in the current process.
 */
export async function piSessionUsage(sessionId: string): Promise<SessionUsage | null> {
	const resp = await invoke<{ usage: SessionUsage } | null>("agent:session-usage", { sessionId });
	return resp?.usage ?? null;
}

export async function piResolvePermission(
  requestId: string,
  outcome: { optionId?: string; cancelled?: boolean }
): Promise<void> {
	const handledByRpc = resolveRendererRpcInteraction(requestId, {
		optionId: outcome.optionId,
		cancelled: outcome.cancelled ?? false,
	});
	if (handledByRpc) return;
	await invoke<void>("agent:resolve-permission", {
    requestId,
    optionId: outcome.optionId ?? null,
    cancelled: outcome.cancelled ?? false,
  });
}

export async function piResolveQuestion(
  requestId: string,
  outcome: {
    /** Keyed by question text. Values are option labels (or string arrays for multi-select). */
    answers?: Record<string, string | string[]>;
    /** Per-question notes/preview, keyed by question text. Freeform uses notes. */
    annotations?: Record<string, { preview?: string; notes?: string }>;
    cancelled?: boolean;
  }
): Promise<void> {
	const handledByRpc = resolveRendererRpcInteraction(requestId, {
		answers: outcome.answers ?? {},
		annotations: outcome.annotations ?? {},
		cancelled: outcome.cancelled ?? false,
	});
	if (handledByRpc) return;
	await invoke<void>("agent:resolve-question", {
    requestId,
    answers: outcome.answers ?? null,
    annotations: outcome.annotations ?? null,
    cancelled: outcome.cancelled ?? false,
  });
}

export * from "./pi-client-providers";
// ---------- skills (x.ai/skills/*) ----------

/** List all skills pi has discovered (user / project / bundled scopes). */
export async function skillsList(cwd?: string): Promise<SkillInfo[]> {
  return invoke<SkillInfo[]>("skills:list", { cwd: cwd ?? null });
}

/** Add a skill path (directory or file) to `[skills].paths` and rescan. */
export async function skillsAdd(path: string, cwd?: string): Promise<void> {
  await invoke<void>("skills:add", { path, cwd: cwd ?? null });
}

/** Remove a skill path from `[skills].paths`. */
export async function skillsRemove(path: string, cwd?: string): Promise<void> {
  await invoke<void>("skills:remove", { path, cwd: cwd ?? null });
}

/** Enable or disable a skill by name (writes `[skills] disabled`). */
export async function skillsToggle(name: string, enabled: boolean): Promise<void> {
  await invoke<void>("skills:toggle", { name, enabled });
}

// ---------- connectors / MCP (x.ai/mcp/*) ----------

/** List configured MCP servers. Pass the live sessionId to enrich entries
 *  with session state (pi's list accepts it optionally). */
export async function mcpList(sessionId?: string): Promise<McpServerEntry[]> {
  return invoke<McpServerEntry[]>("mcp:list", { sessionId: sessionId ?? null });
}

export async function mcpStatus(): Promise<McpRuntimeStatus[]> {
  return invoke<McpRuntimeStatus[]>("mcp:status");
}

/** Add or update an MCP server. pi's upsert is session-scoped — a live
 *  sessionId is required. */
export async function mcpUpsert(sessionId: string, server: McpUpsertRequest): Promise<void> {
  await invoke<void>("mcp:upsert", { sessionId, server });
}

/** Delete an MCP server by name. */
export async function mcpDelete(sessionId: string, name: string): Promise<void> {
  await invoke<void>("mcp:delete", { sessionId, name });
}

/** Enable or disable an MCP server at runtime. */
export async function mcpToggle(sessionId: string, name: string, enabled: boolean): Promise<void> {
  await invoke<void>("mcp:toggle", { sessionId, name, enabled });
}

/** Resolved absolute path of the standalone mcp.json (for the editor header). */
export async function mcpConfigPath(): Promise<string> {
  return invoke<string>("mcp:config-path");
}

/** Read the standalone mcp.json (returns an empty template if missing). */
export async function mcpConfigRead(): Promise<McpConfigFile> {
  return invoke<McpConfigFile>("mcp:config-read");
}

/** Validate + write the standalone mcp.json. When a sessionId is given each
 *  server is also synced live into pi (its upsert is session-scoped). */
export async function mcpConfigSave(content: string, sessionId?: string): Promise<void> {
  await invoke<void>("mcp:config-save", { content, sessionId: sessionId ?? null });
}

// ---------- MCP OAuth authorization (x.ai/mcp/auth_*) ----------

/** Kick off the Electron Main MCP OAuth flow for one server. The access token
 * never crosses the preload boundary; Main persists it through SecretStore. */
export async function mcpAuthTrigger(
  sessionId: string,
  serverName: string,
): Promise<McpAuthTriggerResult> {
  return invoke<McpAuthTriggerResult>("mcp_auth_trigger", { sessionId, serverName });
}

/** Cancel a browser OAuth flow running in Electron Main. */
export async function mcpAuthCancel(serverName: string): Promise<{ cancelled: boolean }> {
  return invoke<{ cancelled: boolean }>("mcp_auth_cancel", { serverName });
}

/** List servers pi has flagged `needs_auth` for this session. */
export async function mcpAuthStatus(sessionId: string): Promise<McpAuthStatusEntry[]> {
  return invoke<McpAuthStatusEntry[]>("mcp_auth_status", { sessionId });
}

// ---------- CLI-type connector authorization (cli.json driven) ----------

/** Probe a CLI connector: has cli.json / CLI installed / currently authed. */
export async function connectorsCliStatus(
  root: string,
  source: string,
): Promise<ConnectorCliStatus> {
  return invoke<ConnectorCliStatus>("connectors_cli_status", { root, source });
}

/** Run the full CLI authorization flow (install → auth steps → verify).
 *  Long-running; auth URLs arrive via `onConnectorCliAuthUrl`. */
export async function connectorsCliAuth(
  root: string,
  source: string,
): Promise<ConnectorCliAuthResult> {
  return invoke<ConnectorCliAuthResult>("connectors_cli_auth", { root, source });
}

/** Cancel an in-flight CLI authorization (kills the child process tree). */
export async function connectorsCliAuthCancel(source: string): Promise<void> {
  await invoke<void>("connectors_cli_auth_cancel", { source });
}

/** Run the connector's unAuth command (logout / credential wipe). */
export async function connectorsCliUnauth(root: string, source: string): Promise<void> {
  await invoke<void>("connectors_cli_unauth", { root, source });
}

/** Absolute path of the connector's bundled skills/ dir (null if none). */
export async function connectorsCliSkillsDir(
  root: string,
  source: string,
): Promise<string | null> {
  return invoke<string | null>("connectors_cli_skills_dir", { root, source });
}

/** Subscribe to CLI auth URL events (show QR / open browser). */
export function onConnectorCliAuthUrl(
  cb: (e: ConnectorCliAuthUrlEvent) => void,
): Promise<UnlistenFn> {
  return listen<ConnectorCliAuthUrlEvent>("connector://cli-auth-url", (ev) => cb(ev.payload));
}

/** Subscribe to CLI auth log lines (progress display in the QR modal). */
export function onConnectorCliAuthLog(
  cb: (e: ConnectorCliAuthLogEvent) => void,
): Promise<UnlistenFn> {
  return listen<ConnectorCliAuthLogEvent>("connector://cli-auth-log", (ev) => cb(ev.payload));
}

/** Subscribe to CLI auth completion events. */
export function onConnectorCliAuthDone(
  cb: (e: ConnectorCliAuthDoneEvent) => void,
): Promise<UnlistenFn> {
  return listen<ConnectorCliAuthDoneEvent>("connector://cli-auth-done", (ev) => cb(ev.payload));
}

// ---------- connector marketplace (live local data dir) ----------

/** First existing candidate marketplace root ("" if none found). */
export async function connectorsDefaultRoot(): Promise<string> {
  return invoke<string>("connectors_default_root");
}

/** Marketplace roots under `root` that contain the connectors manifest. */
export async function connectorsListRoots(root: string): Promise<string[]> {
  return invoke<string[]>("connectors_list_roots", { root });
}

/** Load categories + connectors from the marketplace manifest. */
export async function connectorsLoad(root?: string): Promise<ConnectorCatalog> {
  return invoke<ConnectorCatalog>("connectors_load", { root: root ?? null });
}

/** Read a local icon file as a `data:` URL (svg/png). */
export async function connectorsIcon(path: string, root?: string): Promise<string> {
  return invoke<string>("connectors_icon", { path, root: root ?? null });
}

/** Read `<root>/connectors/<source>/mcp.json` raw text ("" if missing). */
export async function connectorsReadMcpConfig(root: string, source: string): Promise<string> {
  return invoke<string>("connectors_read_mcp_config", { root, source });
}

/** Open a URL in the system browser (scheme-whitelisted backend command). */
export async function openUrl(url: string): Promise<void> {
  await invoke<void>("open_url", { url });
}

// ---------- skill catalog (runtime scan of agents + builtin dirs) ----------

/** First existing candidate agents data root ("" if none found). */
export async function skillsCatalogDefaultRoot(): Promise<string> {
  return invoke<string>("skills_catalog_default_root");
}

/** Agents roots under `root` that look scannable. */
export async function skillsCatalogListRoots(root: string): Promise<string[]> {
  return invoke<string[]>("skills_catalog_list_roots", { root });
}

/** Scan both sources and return the merged, deduped skill catalog. */
export async function skillsCatalogLoad(
  root?: string,
  builtinRoot?: string,
): Promise<SkillCatalog> {
  return invoke<SkillCatalog>("skills_catalog_load", {
    root: root ?? null,
    builtinRoot: builtinRoot ?? null,
  });
}

/** Read the full SKILL.md text for a directory. */
export async function skillsCatalogReadSkill(dir: string, root?: string, builtinRoot?: string): Promise<string> {
  return invoke<string>("skills_catalog_read_skill", { dir, root: root ?? null, builtinRoot: builtinRoot ?? null });
}

/**
 * Parse SKILL.md frontmatter via the pi-bridge IPC (Phase E.3 of
 * docs/OPENBUDDY_PI_NATIVE_PLAN.md). The renderer used to ship a
 * hand-rolled YAML-ish parser inline; this re-uses pi-coding-agent's
 * real YAML parser and lets the IPC layer own the (Node-only) import.
 *
 * Falls back to an empty `{ frontmatter: {}, body }` result when the
 * bridge is unavailable (e.g. unit tests without a preload stub) so
 * SkillDetailModal never crashes.
 */
export interface ParsedSkillFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

export async function parseSkillFrontmatter(raw: string): Promise<ParsedSkillFrontmatter> {
  const bridge = getPiBridge();
  if (!bridge) return { frontmatter: {}, body: raw };
  try {
    return await bridge.text.parseFrontmatter(raw);
  } catch {
    return { frontmatter: {}, body: raw };
  }
}

/**
 * Strip SKILL.md frontmatter via the pi-bridge IPC (Round 22 — G4 PR 1,
 * plan4.1.md §9.12). Use this when a caller needs *just the body* and
 * doesn't care about frontmatter parsing — e.g. previews, search
 * snippets, or plugin README rendering. Cheaper than `parseSkillFrontmatter`
 * for body-only consumers (one round-trip vs the same round-trip +
 * a YAML parse).
 *
 * Falls back to the raw string when the bridge is unavailable so unit
 * tests without a preload stub don't crash. The fallback is intentionally
 * the original input — for these "no frontmatter" cases the raw text
 * is what the caller would have wanted anyway.
 */
export async function stripSkillFrontmatter(raw: string): Promise<string> {
  const bridge = getPiBridge();
  if (!bridge?.text?.stripFrontmatter) return raw;
  try {
    return await bridge.text.stripFrontmatter(raw);
  } catch {
    return raw;
  }
}

// ---------- expert marketplace (live local data dir) ----------

/** First existing candidate data root ("" if none found). */
export async function expertsDefaultRoot(): Promise<string> {
  return invoke<string>("experts_default_root");
}

/** Data roots under `root` that contain the marketplace manifest. */
export async function expertsListRoots(root: string): Promise<string[]> {
  return invoke<string[]>("experts_list_roots", { root });
}

/** Load categories + experts by merging the manifest with each plugin.json. */
export async function expertsLoad(root?: string): Promise<ExpertCatalog> {
  return invoke<ExpertCatalog>("experts_load", { root: root ?? null });
}

/** Small base64 JPEG thumbnail for a local avatar path (cached server-side). */
export async function expertsThumbnail(path: string, root?: string): Promise<string> {
  return invoke<string>("experts_thumbnail", { path, root: root ?? null });
}

/** Full-size local image as a `data:` URL (used for 精选场景 banners). */
export async function expertsImageBytes(path: string, root?: string): Promise<string> {
  return invoke<string>("experts_image_bytes", { path, root: root ?? null });
}

/** Read the full agent prompt markdown from an expert's package directory. */
export async function expertsReadAgentPrompt(
  root: string,
  plugin: string,
  agentName: string,
): Promise<string> {
  return invoke<string>("experts_read_agent_prompt", { root, plugin, agentName });
}

/** Link a team expert's agents/*.md into ~/.pi/agents/ for pi sub-agent discovery. */
export async function expertsLinkAgents(root: string, plugin: string): Promise<number> {
  return invoke<number>("experts_link_agents", { root, plugin });
}

export async function workbuddyImportPreview(sourceRoot: string, pluginId: string): Promise<WorkBuddyImportPreview> {
  return invoke<WorkBuddyImportPreview>("workbuddy_import_preview", { sourceRoot, pluginId });
}

export async function workbuddyImportConfirm(previewToken: string): Promise<WorkBuddyImportResult> {
  return invoke<WorkBuddyImportResult>("workbuddy_import_confirm", { previewToken });
}

export async function workbuddyImportStatus(importId: string): Promise<WorkBuddyImportStatus | undefined> {
  return invoke<WorkBuddyImportStatus | undefined>("workbuddy_import_status", { importId });
}

export async function workbuddyImportRollback(importId: string): Promise<WorkBuddyImportResult> {
  return invoke<WorkBuddyImportResult>("workbuddy_import_rollback", { importId });
}

/** Bind an expert to a session (OpenBuddy-only state). */
export async function piSetSessionExpert(
  sessionId: string,
  expertId: string,
  expertName: string,
  source: string,
  avatarLocal?: string,
): Promise<boolean> {
  assertRealSessionId(sessionId, "piSetSessionExpert");
  return invoke<boolean>("pi_set_session_expert", { sessionId, expertId, expertName, source, avatarLocal: avatarLocal ?? null });
}

/** Remove the expert binding from a session. */
export async function piClearSessionExpert(sessionId: string): Promise<boolean> {
  return invoke<boolean>("pi_clear_session_expert", { sessionId });
}

// ---------- experts / assistants (~/.pi/agents/*.md) ----------

/** List all agent definitions visible to OpenBuddy. */
export async function agentsList(cwd?: string): Promise<AgentEntry[]> {
  return invoke<AgentEntry[]>("agents_list", { cwd: cwd ?? null });
}

/** Fetch a single agent file's full contents. */
export async function agentsGet(path: string): Promise<string> {
  return invoke<string>("agents_get", { path });
}

/** Save an agent file (create or overwrite) to ~/.pi/agents/<name>.md. */
export async function agentsSave(name: string, raw: string): Promise<AgentEntry> {
  return invoke<AgentEntry>("agents_save", { name, raw });
}

/** Delete an agent file by path. */
export async function agentsDelete(path: string): Promise<void> {
  await invoke<void>("agents_delete", { path });
}

/** Render a starter agent markdown body from name/description/system prompt.
 *  Optional avatar (1-20) and modelTags are written to frontmatter. */
export async function agentsTemplate(
  name: string,
  description: string,
  systemPrompt: string,
  avatar?: number,
  modelTags?: string[],
): Promise<string> {
  return invoke<string>("agents_template", {
    name,
    description,
    systemPrompt,
    avatar: avatar ?? null,
    modelTags: modelTags ?? null,
  });
}

// ---------- permission rules (~/.pi/config.toml [permission]) ----------

/** List the current permission rules (allow/deny/ask) from config.toml. */
export async function permissionList(): Promise<PermissionRule[]> {
  return invoke<PermissionRule[]>("permission_list");
}

/** Replace all permission rules. Writes to config.toml atomically.
 *  NOTE: requires a pi restart to take effect. */
export async function permissionSave(rules: PermissionRule[]): Promise<void> {
  await invoke<void>("permission_save", { rules });
}

// ---------- permission mode (~/.pi/config.toml [ui].permission_mode) ----------

/** OpenBuddy public permission modes; Main maps these to Pi-native modes. */
// Renderer-side PermissionMode aligned with Pi native 5档 (see packages/auth/openbuddy-permission/src/index.ts:43-54).
// The legacy 3档 (ask / auto / always-approve) shim has been replaced by direct 1:1 mapping at the IPC layer
// (electron/main/ipc.ts `permissionModes` and `toPiPermissionMode` / `fromPiPermissionMode`).
export type PermissionMode = "default" | "acceptEdits" | "dontAsk" | "plan" | "bypassPermissions";

/** Read the configured permission mode (default "default"). */
export async function permissionModeGet(): Promise<PermissionMode> {
  return invoke<PermissionMode>("permission:mode-get");
}

/** Set the permission mode: persists to config.toml and live-notifies the
 *  running agent via pi's `x.ai/yolo_mode_changed` extension notification. */
export async function permissionModeSet(mode: PermissionMode): Promise<void> {
  await invoke<void>("permission:mode-set", mode);
}

// ---------- memory (资料库 — ~/.pi/memory/) ----------


// ---------- session search (FTS5) ----------

/** Full-text search across all sessions. */
export async function sessionSearch(
  query: string,
  cwd?: string,
  limit?: number,
): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("session_search", { query, cwd: cwd ?? null, limit: limit ?? null });
}

// ---------- rewind ----------

/** List prompts a session can rewind to. */
export async function rewindPoints(sessionId: string): Promise<RewindPoint[]> {
  return invoke<RewindPoint[]>("rewind_points", { sessionId });
}

/** Rewind a session to a specific prompt index. */
export async function rewindExecute(
  sessionId: string,
  targetPromptIndex: number,
  mode?: string,
  force?: boolean,
): Promise<void> {
  await invoke<void>("rewind_execute", {
    sessionId,
    targetPromptIndex,
    mode: mode ?? null,
    force: force ?? null,
  });
}

// ---------- session fork ----------

/** Fork a session: copy history to a new session id. Returns the new id. */
export async function sessionFork(sessionId: string, cwd?: string): Promise<string> {
  return invoke<string>("session_fork", { sessionId, cwd: cwd ?? null });
}

// ---------- slash commands + prompt history ----------

/** List slash commands (builtin + skills + plugins). Powers "/" autocomplete. */
export async function commandsList(): Promise<SlashCommand[]> {
  return invoke<SlashCommand[]>("agent:commands-list");
}

/** Cross-session prompt history. */
export async function promptHistory(limit?: number): Promise<string[]> {
  return invoke<string[]>("prompt_history", { limit: limit ?? null });
}

// ---------- tasks / subagents ----------

/** List running background tasks / subagents. */
export async function tasksList(): Promise<RunningTask[]> {
  return invoke<RunningTask[]>("tasks_list");
}

/** List tasks scoped to a single session (used by unified search). */
export async function tasksListForSession(sessionId: string): Promise<RunningTask[]> {
  return invoke<RunningTask[]>("tasks:list", { sessionId });
}

/** Add a task entry scoped to the given session. */
export async function tasksAddForSession(sessionId: string, title: string): Promise<{ id: string } | null> {
  return invoke<{ id: string } | null>("tasks:add", { sessionId, title });
}

/** Kill a running task or subagent. */
export async function taskKill(taskId: string): Promise<void> {
  await invoke<void>("task_kill", { taskId });
}

// ---------- folder trust ----------

/** Respond to a folder-trust request from pi. */
export async function folderTrustRespond(cwd: string, trusted: boolean): Promise<void> {
  await invoke<void>("folder_trust_respond", { cwd, trusted });
}

// ---------- plan mode ----------
//
// Stage G-1b: openbuddy-plan deleted. Plan-mode is fully owned by
// pi-plan-mode (passthrough). The renderer no longer drives the toggle
// through an OpenBuddy IPC channel — pi-plan-mode handles enable/disable
// natively and the agent reflects state through `pi://plan-mode`
// (handlers.onPlanMode). We keep the function as a documented no-op so
// older callers continue to compile; new code should drop it entirely.

/** Toggle plan mode for a session (no-op after Stage G-1b). */
export async function togglePlanMode(_sessionId: string, _enabled: boolean): Promise<void> {
  // Plan-mode is owned by pi-plan-mode; the legacy OpenBuddy IPC channel
  // `toggle_plan_mode` was removed. The agent now controls plan-mode via
  // pi's native RPC and emits `pi://plan-mode` events to the renderer.
  return;
}

// ---------- internal reload ----------

/** Hot-reload pi's view of config/skills/mcp/models. `kind` ∈
 *  "mcp_all" | "mcp_project" | "skills" | "models". */
export async function internalReload(kind: "mcp_all" | "mcp_project" | "skills" | "models"): Promise<void> {
  await invoke<void>("internal_reload", { kind });
}

// ---------- automations (UI shells preserved per user directive;
//          backend removed in Stage G-1c — automation is owned by
//          pi-background-tasks + pi-goal (passthrough). The IPC bridges
//          below exist so the UI shells compile; runtime calls throw
//          until pi-native bridges are wired.) ----------

/** Full snapshot: automations (next runs recomputed) + run records. */
export async function automationsSnapshot(): Promise<AutomationSnapshot> {
  return invoke<AutomationSnapshot>("automations_snapshot");
}

/** Create or update an automation. */
export async function automationsSave(automation: Automation): Promise<Automation> {
  return invoke<Automation>("automations_save", { automation });
}

/** Delete an automation by id. */
export async function automationsDelete(id: string): Promise<void> {
  await invoke<void>("automations_delete", { id });
}

/** Set an automation's status ("ACTIVE" | "PAUSED"). */
export async function automationsSetStatus(id: string, status: AutomationStatus): Promise<void> {
  await invoke<void>("automations_set_status", { id, status });
}

/** Manually fire an automation now (test run). Opens a new pi session. */
export async function automationsRun(id: string): Promise<void> {
  await invoke<void>("automations_run", { id });
}

/** Archive / unarchive a run record. */
export async function automationRecordsArchive(id: string, archived: boolean): Promise<void> {
  await invoke<void>("automation_records_archive", { id, archived });
}

/** Delete a run record. */
export async function automationRecordsDelete(id: string): Promise<void> {
  await invoke<void>("automation_records_delete", { id });
}

export async function inspirationGenerate(
  category: string,
  cwd?: string,
  count?: number,
): Promise<InspirationStarted> {
  return invoke<InspirationStarted>("inspiration_generate", {
    request: { category, cwd: cwd ?? null, count: count ?? null },
  });
}

// ---------- agent / assistant defaults (~/.pi/config.toml) ----------

/** Read the new-session defaults (model + permission + remember-tool-approvals). */
export async function agentsDefaultsGet(): Promise<AgentDefaults> {
  return invoke<AgentDefaults>("agents_defaults_get");
}

/** Save the new-session defaults. Atomic write to config.toml. */
export async function agentsDefaultsSave(defaults: AgentDefaults): Promise<void> {
  await invoke<void>("agents_defaults_save", { defaults });
}

// ---------- plugins + marketplace (x.ai/plugins/*, x.ai/marketplace/*) ----------

import type {
  MarketplaceActionResult,
  MarketplaceListResponse,
  PluginsListResponse,
} from "@openbuddy/shared-types";

/** List installed plugins via `x.ai/plugins/list`. */
export async function pluginsList(sessionId?: string): Promise<PluginsListResponse> {
  return invoke<PluginsListResponse>("plugins_list", { sessionId: sessionId ?? null });
}

/** Execute a plugin action (enable/disable/install/etc). */
export async function pluginsAction(
  sessionId: string,
  action: unknown,
): Promise<unknown> {
  return invoke("plugins_action", { sessionId, action });
}

/** Re-materialize and reload the active Pi extension resources in place. */
export async function reloadPiExtensions(): Promise<unknown[]> {
  return invoke<unknown[]>("agent:extensions-reload");
}

/** List marketplace sources + plugins via `x.ai/marketplace/list`. */
export async function marketplaceList(sessionId?: string): Promise<MarketplaceListResponse> {
  return invoke<MarketplaceListResponse>("marketplace_list", { sessionId: sessionId ?? null });
}

/** Execute a marketplace action (install/uninstall/refresh/add_source/remove_source).
 *  sessionId is optional: marketplace operations are profile-scoped and run
 *  independently of any active Pi conversation. Callers without a session
 *  (e.g. the Marketplace tab on the WorkBuddy home page) can pass `null` or
 *  omit it. */
export async function marketplaceAction(
  sessionId: string | null | undefined,
  action: unknown,
): Promise<MarketplaceActionResult> {
  return invoke<MarketplaceActionResult>("marketplace_action", { sessionId: sessionId ?? null, action });
}

// ---------- export ----------

/** Export text content to an absolute path chosen by the user via the save
 *  dialog (e.g. "导出会话为 Markdown"). Unlike write_text_file, this is NOT
 *  restricted to the workspace — the path comes from explicit user consent
 *  in the native save dialog. */
export async function exportTextFile(path: string, content: string): Promise<string> {
  return invoke<string>("export_text_file", { path, content });
}

// ---------- filesystem: directory listing (file-tree sidebar) ----------

/** A single directory entry returned by `list_dir`. */
export interface DirEntry {
  /** File/dir basename. */
  name: string;
  /** Absolute path of the entry. */
  path: string;
  /** "directory" | "file" | "other". */
  kind: string;
  /** File size in bytes (directories report 0). */
  size: number;
}

/**
 * List the immediate children of a directory (non-recursive).
 * Hidden entries and noisy build/VCS directories (.git/node_modules/…) are
 * skipped server-side. Capped at `maxEntries` (default 2000).
 */
export async function listDir(
  path: string,
  cwd?: string,
  maxEntries?: number,
): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", {
    path,
    cwd: cwd ?? null,
    maxEntries: maxEntries ?? null,
  });
}

// ---------- event subscription ----------

export interface PiEventListeners {
  unlisten: UnlistenFn;
}

export interface PiExtensionUiEvent {
  sessionId?: string;
  method: string;
  key?: string;
  text?: string;
  value?: string;
  message?: string;
  label?: string;
  visible?: boolean;
  expanded?: boolean;
  title?: string;
  theme?: string;
  supported?: boolean;
  content?: string[];
  options?: unknown;
}

/** Subscribe to all pi events, dispatching into the provided callbacks. */
export async function subscribePiEvents(handlers: {
  onUpdate?: (u: SessionUpdate & { __sessionId?: string }) => void;
  onPermission?: (p: PermissionRequest) => void;
  onComplete?: (p: PromptComplete) => void;
  /** Fired when pi generates or renames a session title
   *  (`x.ai/session_notification` → `SessionSummaryGenerated`). */
  onSummary?: (s: SessionSummaryEvent) => void;
  /** Fired on MCP connector status / init-progress notifications. */
  onMcpStatus?: (p: unknown) => void;
  /** Fired when pi asks us to trust a folder (`x.ai/folder_trust/request`). */
  onFolderTrust?: (p: unknown) => void;
  /** Fired when plan mode is toggled (`x.ai/toggle_plan_mode`). */
  onPlanMode?: (p: unknown) => void;
  /** Fired when the permission mode (auto/yolo) changes. */
  onPermissionMode?: (p: unknown) => void;
  /** Fired when the model list updates. */
  onModelsUpdate?: (p: unknown) => void;
  /** Fired on background task lifecycle (`task_backgrounded`/`task_completed`). */
  onTaskUpdate?: (p: unknown) => void;
  /** Fired when the agent asks a question (`x.ai/question`). */
  onQuestion?: (q: QuestionRequest) => void;
  /** Fired when the agent thread dies unexpectedly (panic/crash). */
  onAgentDied?: (p: { reason: string }) => void;
  /** Fired on subagent lifecycle (spawned/progress/finished). */
  onSubagent?: (e: SubagentLiveEvent) => void;
  /** Fired when a turn ends abnormally (`stopReason: "rate_limit" | "error"`).
   *  pi reports mid-stream failures via `prompt_complete` with these stop
   *  reasons rather than as a thrown error, so this event lets the UI show a
   *  friendly message instead of silently marking the turn complete. */
  onTurnError?: (e: TurnErrorEvent) => void;
  onExtensionUi?: (event: PiExtensionUiEvent) => void;
  onPluginEvent?: (event: OpenBuddyPluginEvent) => void;
}, options?: { updateTransport?: "auto" | "ipc" | "port" }): Promise<UnlistenFn> {
	ensureRendererRpcChannel();
	const unlisteners: UnlistenFn[] = [];
  const wire = async <T>(event: string, cb: ((p: T) => void) | undefined) => {
    if (!cb) return;
    const eventName = event.replace(/^pi:\/\//, "");
    unlisteners.push(
      await listen<T>(event, (e) => {
        // R6.8 — handler 同步抛错不能让 IPC 通道死亡。listen() 内部已包了一层
        // try/catch(electron/preload/index.ts:324),但 `e.payload` 可能本身为
        // 异常结构 (例如 harness 反序列化失败),所以 cb 调用再套一层防御。
        try {
          recordReceipt(eventName, e.payload as { traceId?: string; sessionId?: string; [k: string]: unknown });
          cb(e.payload);
        } catch (error) {
          console.error(`[OpenBuddy] ${event} handler threw:`, error);
          // 不向用户弹 toast —— 这里失败通常是 harness 协议层 bug, 频繁弹会刷屏;
          // 但要保证通道存活,后续事件继续投递。
        }
      }),
    );
  };

  const acceptUpdate = (raw: unknown, source: "ipc" | "port"): void => {
    // R6.8 — 同步防御,确保 handler 抛错时通道不被掐断。
    try {
      if (!raw || typeof raw !== "object") return;
      const asRecord = raw as { sessionId?: unknown; traceId?: unknown };
      const { sessionId, traceId, ...update } = asRecord as Record<string, unknown>;
      const sessionIdText = typeof sessionId === "string" ? sessionId : undefined;
      const traceIdText = typeof traceId === "string" ? traceId : undefined;
      recordReceipt("update", { sessionId: sessionIdText, traceId: traceIdText, ...update });
      const out = update as SessionUpdate & { __sessionId?: string };
      out.__sessionId = sessionIdText;
      handlers.onUpdate!(out);
    } catch (error) {
      console.error(`[OpenBuddy] pi://update (${source}) handler threw:`, error);
    }
  };
  if (handlers.onUpdate) {
    const transport = options?.updateTransport ?? "auto";
    if (transport === "port" || transport === "auto") {
      const unlisten = await openPiStream((batch) => {
        const events = batch && typeof batch === "object" && Array.isArray((batch as { events?: unknown }).events)
          ? (batch as { events: unknown[] }).events
          : [batch];
        for (const event of events) acceptUpdate(event, "port");
      });
      if (unlisten) {
        unlisteners.push(unlisten);
      } else {
        // Port transport unavailable (older preload / jsdom) — never let the
        // subscription silently drop live updates; fall back to IPC.
        unlisteners.push(
          await listen<SessionUpdate & { sessionId?: string; traceId?: string }>("pi://update", (e) => acceptUpdate(e.payload, "ipc")),
        );
      }
    } else {
      unlisteners.push(
        await listen<SessionUpdate & { sessionId?: string; traceId?: string }>("pi://update", (e) => acceptUpdate(e.payload, "ipc")),
      );
    }
  }
  await wire<PermissionRequest>("pi://permission", handlers.onPermission);
  await wire<PromptComplete>("pi://complete", handlers.onComplete);
  await wire<SessionSummaryEvent>("pi://summary", handlers.onSummary);
  await wire("pi://mcp-status", handlers.onMcpStatus);
  await wire("pi://folder-trust", handlers.onFolderTrust);
  await wire("pi://plan-mode", handlers.onPlanMode);
  await wire("pi://permission-mode", handlers.onPermissionMode);
  await wire("pi://models-update", handlers.onModelsUpdate);
  await wire("pi://task-update", handlers.onTaskUpdate);
  await wire<QuestionRequest>("pi://question", handlers.onQuestion);
  await wire<{ reason: string }>("pi://agent-died", handlers.onAgentDied);
  await wire<SubagentLiveEvent>("pi://subagent", handlers.onSubagent);
  await wire<TurnErrorEvent>("pi://turn-error", handlers.onTurnError);
  await wire<PiExtensionUiEvent>("pi://extension-ui", handlers.onExtensionUi);
  if (handlers.onPluginEvent) unlisteners.push(await agentOnPluginEvent(handlers.onPluginEvent));

  return () => unlisteners.forEach((u) => u());
}

// ---------- MVP-9 — Renderer-side wrapper for the durable storage gateway ----------
// The main process already exposes namespace-scoped, versioned KV through
// `storage:renderer-{read,list,write,remove}` (see
// electron/main/ipc/storage.ts → electron/main/storage/renderer-storage.ts).
// These thin wrappers give the renderer a typed, promise-returning surface
// without forcing every store to know about IPC.

export interface RendererStorageReadResult<T = unknown> {
  ok: boolean;
  value?: T;
  version?: number;
  error?: string;
}
export interface RendererStorageListEntry<T = unknown> {
  key: string;
  value: T;
  version: number;
}
export interface RendererStorageListResult<T = unknown> {
  ok: boolean;
  values: RendererStorageListEntry<T>[];
  error?: string;
}

export async function rendererStorageRead<T = unknown>(
  namespace: string,
  key: string,
): Promise<RendererStorageReadResult<T>> {
  const res = await invoke<{ ok: boolean; value?: { value: T; version: number }; error?: string }>(
    "storage:renderer-read",
    { namespace, key },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return res.value
    ? { ok: true, value: res.value.value, version: res.value.version }
    : { ok: true };
}

export async function rendererStorageList<T = unknown>(
  namespace: string,
): Promise<RendererStorageListResult<T>> {
  const res = await invoke<{ ok: boolean; values?: Array<{ key: string; value: T; version: number }>; error?: string }>(
    "storage:renderer-list",
    { namespace },
  );
  if (!res.ok || !res.values) return { ok: false, values: [], error: res.error };
  return { ok: true, values: res.values };
}

export async function rendererStorageWrite<T = unknown>(
  namespace: string,
  key: string,
  value: T,
  options: { expectedVersion?: number } = {},
): Promise<RendererStorageReadResult<T>> {
  const res = await invoke<{ ok: boolean; value?: { value: T; version: number }; error?: string; currentVersion?: number }>(
    "storage:renderer-write",
    { namespace, key, value, ...(options.expectedVersion !== undefined ? { expectedVersion: options.expectedVersion } : {}) },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return res.value
    ? { ok: true, value: res.value.value, version: res.value.version }
    : { ok: true };
}

export async function rendererStorageRemove(
  namespace: string,
  key: string,
): Promise<{ ok: boolean; removed: boolean; error?: string }> {
  const res = await invoke<{ ok: boolean; removed: boolean; error?: string }>(
    "storage:renderer-remove",
    { namespace, key },
  );
  return res;
}
