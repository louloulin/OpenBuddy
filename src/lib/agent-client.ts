import type { ModelState } from "./types";
export type { ModelState } from "./types";

import { invoke } from "@/lib/ipc";
import { listen, type UnlistenFn } from "@/lib/ipc";
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
  McpServerEntry,
  McpUpsertRequest,
  MemoryEntry,
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
  TurnErrorEvent,
} from "./types";

import type { QuestionRequest, UiDismissReason } from "@/stores/question-store";

// ---------- commands ----------

export interface AuthStatus {
  ready: boolean;
  
  hasAuthFile: boolean;
  /** Human-readable reason when not ready. */
  reason?: string;
  
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
  defaultProviderId?: string;
  defaultModelKey?: string;
  invalidDefault?: boolean;
}


export async function agentInit(cwd?: string): Promise<InitResult> {
  return invoke<InitResult>("agent_init", { cwd: cwd ?? null });
}

export async function agentAuthStatus(): Promise<AuthStatus> {
  return invoke<AuthStatus>("agent_auth_status");
}

// NOTE: the backend `agent_new_session` command returns the session id as a
// bare `String` (see commands.rs agent_new_session). We type it as `string`
// here — do NOT wrap it in `{ sessionId }`, or callers destructuring
// `const { sessionId } = ...` will silently get undefined.
//
// sampling config has no key in a BYOK-only setup).
export async function agentNewSession(cwd: string, modelId?: string): Promise<string> {
  return invoke<string>("agent_new_session", { cwd, modelId: modelId ?? null });
}

// re-emits the persisted transcript as a stream of SessionUpdate messages,
// which our existing `agent://update` listener already funnels into the
// session store. So this command returns nothing — callers just need to
// clear the local transcript first, then await this to confirm the agent
// accepted the load.
export async function agentLoadSession(sessionId: string, cwd: string): Promise<ModelState> {
  return invoke<ModelState>("agent_load_session", { sessionId, cwd });
}

export async function agentListSessions(cwd: string): Promise<SessionSummary[]> {
  return invoke<SessionSummary[]>("agent_list_sessions", { cwd });
}


export interface WorkspaceInfo {
  /** Absolute path of the working directory. */
  cwd: string;
  /** Number of sessions recorded under this cwd. */
  sessionCount: number;
  /** Title of the most recent session under this cwd (optional, for display). */
  lastTitle?: string;
}


export async function agentListWorkspaces(): Promise<WorkspaceInfo[]> {
  return invoke<WorkspaceInfo[]>("agent_list_workspaces");
}


export async function agentSetModel(sessionId: string, modelId: string, providerId?: string): Promise<ModelState> {
  return invoke<ModelState>("agent_set_model", { sessionId, modelId, providerId });
}

export const agentGetModelState = (sessionId: string) => invoke<ModelState>("agent_get_model_state", { sessionId });
export const agentSetThinkingLevel = (sessionId: string, level: string) => invoke<ModelState>("agent_set_thinking_level", { sessionId, level });

/** Send a user prompt; streamed updates arrive via the events below. */
export async function agentSend(sessionId: string, text: string, attachments?: { path: string }[]): Promise<void> {
  await invoke<void>("agent_send", { sessionId, text, ...(attachments?.length ? { attachments } : {}) });
}

export interface AgentQueue { steering: string[]; followUp: string[] }
export const agentGetQueue = (sessionId: string) => invoke<AgentQueue>("agent_get_queue", { sessionId });
export const agentClearQueue = (sessionId: string) => invoke<AgentQueue>("agent_clear_queue", { sessionId });
export const agentSteer = (sessionId: string, text: string, attachments?: { path: string }[]) => invoke<AgentQueue>("agent_steer", { sessionId, text, ...(attachments?.length ? { attachments } : {}) });
export const agentFollowUp = (sessionId: string, text: string, attachments?: { path: string }[]) => invoke<AgentQueue>("agent_follow_up", { sessionId, text, ...(attachments?.length ? { attachments } : {}) });
export const agentForkSession = (sessionId: string) => invoke<string>("agent_fork_session", { sessionId });

export async function agentCancel(sessionId: string): Promise<void> {
  await invoke<void>("agent_cancel", { sessionId });
}

/** Cleanly shut down the agent so `agentInit` can be called again to restart. */
export async function agentShutdown(): Promise<void> {
  await invoke<void>("agent_shutdown");
}


export async function agentRenameSession(
  sessionId: string,
  title: string,
  cwd?: string,
): Promise<void> {
  await invoke<void>("agent_rename_session", { sessionId, title, cwd: cwd ?? null });
}


export async function agentDeleteSession(sessionId: string, cwd?: string): Promise<void> {
  await invoke<void>("agent_delete_session", { sessionId, cwd: cwd ?? null });
}


export async function agentSetSessionPinned(
  sessionId: string,
  pinned: boolean,
): Promise<boolean> {
  return invoke<boolean>("agent_set_session_pinned", { sessionId, pinned });
}


export async function agentSetSessionArchived(
  sessionId: string,
  archived: boolean,
): Promise<boolean> {
  return invoke<boolean>("agent_set_session_archived", { sessionId, archived });
}

// ---------- context usage (x.ai/session/info + x.ai/session/usage) ----------

/**
 * Fetch the session's context-window snapshot (`x.ai/session/info`) for the
 * composer's context-usage pill/popover. Rejects when the session isn't live
 * in the agent (e.g. an old session never loaded this launch) — callers
 * should treat that as "no data" and hide the pill.
 */
export async function agentSessionInfo(sessionId: string): Promise<SessionInfoResponse> {
  return invoke<SessionInfoResponse>("agent_session_info", { sessionId });
}

/**
 * Fetch the session's cumulative token usage (`x.ai/session/usage`) — the
 * response wraps `PromptUsage` totals; we return the inner `usage` object.
 * Used by the context-usage popover for the average cache hit rate.
 */
export async function agentSessionUsage(sessionId: string): Promise<SessionUsage> {
  const resp = await invoke<{ usage: SessionUsage }>("agent_session_usage", { sessionId });
  return resp.usage;
}

export async function agentResolvePermission(
  requestId: string,
  outcome: { optionId?: string; cancelled?: boolean }
): Promise<void> {
  await invoke<void>("agent_resolve_permission", {
    requestId,
    optionId: outcome.optionId ?? null,
    cancelled: outcome.cancelled ?? false,
  });
}

export const agentResolveUi = (payload: { requestId: string; sessionId: string; value?: string | boolean; cancelled?: boolean }) => invoke<void>("agent_resolve_ui", payload);
export type ExtensionUiState =
  | { sessionId: string; kind: "status"; key: string; text?: string }
  | { sessionId: string; kind: "working"; message?: string; visible?: boolean }
  | { sessionId: string; kind: "title"; title: string }
  | { sessionId: string; kind: "widget"; key: string; lines?: string[]; placement?: "aboveEditor" | "belowEditor" }
  | { sessionId: string; kind: "editor"; action: "set" | "paste"; text: string };

export async function agentResolveQuestion(
  requestId: string,
  outcome: {
    /** Keyed by question text. Values are option labels (or string arrays for multi-select). */
    answers?: Record<string, string | string[]>;
    /** Per-question notes/preview, keyed by question text. Freeform uses notes. */
    annotations?: Record<string, { preview?: string; notes?: string }>;
    cancelled?: boolean;
  }
): Promise<void> {
  await invoke<void>("agent_resolve_question", {
    requestId,
    answers: outcome.answers ?? null,
    annotations: outcome.annotations ?? null,
    cancelled: outcome.cancelled ?? false,
  });
}

// ---------- provider config (BYOK) ----------

export type ProviderKind =
  | "anthropic"
  | "openai"
  | "grok"
  | "deepseek"
  | "qwen"
  | "custom"
  | "custom_anthropic";


export type ApiBackend = "chat_completions" | "responses" | "messages";


export type AuthScheme = "bearer" | "x_api_key";

/**
 * One connection/auth profile — written to `[model_providers.<id>]`. A single
 * provider holds one api_key / base_url shared by every model that references
 * it via `providerId`.
 */
export interface ModelProviderEntry {
  /** Stable id derived from providerKind (e.g. "openai", "custom-2"). */
  id: string;
  providerKind: ProviderKind;
  label?: string;
  /** Masked "••••" when read back; the real secret when saving. */
  apiKey?: string;
  baseUrl?: string;
  apiBackend?: ApiBackend;
  authScheme?: AuthScheme;
  /** Max context window in tokens, shared by all referencing models. */
  contextWindow?: number;
}

/**
 * One model catalog entry — written to `[model.<modelId>]` with a
 * `model_provider = "<providerId>"` reference. Carries only model-specific
 * fields; connection config lives on the provider.
 */
export interface ModelEntry {
  modelKey?: string;
  availableThinkingLevels?: string[];
  /** The `[model.<id>]` key AND the model slug sent in requests. */
  modelId: string;
  /** References a ModelProviderEntry.id. */
  providerId: string;
  
  name?: string;
  /** Per-model context-window override (wins over the provider's value). */
  contextWindow?: number;
  input?: ("text" | "image")[];
  reasoning?: boolean;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  pricingKnown?: boolean;

}

/** Result of providers_list: every provider + every model, joined by providerId. */
export interface ProviderListModel {
  providers: ModelProviderEntry[];
  models: ModelEntry[];
}

/**
 * Convenience: flatten the joined list back into per-model option rows for
 * pickers that only need { id, label }. Each model is joined with its
 * provider so consumers keep using a flat array.
 */
export interface ModelOptionRow {
  id: string;
  modelId: string;
  providerLabel: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  availableThinkingLevels?: string[];
  label: string;
  providerKind: ProviderKind;
  providerId: string;
}

/** Flatten a ProviderListModel into per-model rows (id + label + provider). */
export function flattenModels(list: ProviderListModel): ModelOptionRow[] {
  return list.models.map((m) => {
    const provider = list.providers.find((p) => p.id === m.providerId);
    return {
      id: m.modelKey ?? `model:${encodeURIComponent(m.providerId)}/${encodeURIComponent(m.modelId)}`,
      modelId: m.modelId,
      providerLabel: provider?.label || provider?.id || m.providerId,
      reasoning: m.reasoning,
      input: m.input,
      contextWindow: m.contextWindow ?? provider?.contextWindow,
      availableThinkingLevels: m.availableThinkingLevels,
      label: m.name || m.modelId,
      providerKind: (provider?.providerKind ?? "custom") as ProviderKind,
      providerId: m.providerId,
    };
  });
}

export async function providersList(): Promise<ProviderListModel> {
  return invoke<ProviderListModel>("providers_list");
}

export async function providersSaveProvider(provider: ModelProviderEntry): Promise<void> {
  await invoke<void>("providers_save_provider", { provider });
}

export async function providersSaveModel(model: ModelEntry): Promise<void> {
  await invoke<void>("providers_save_model", { model });
}

export async function providersDeleteProvider(id: string): Promise<void> {
  await invoke<void>("providers_delete_provider", { id });
}

export async function providersDeleteModel(modelId: string, providerId?: string): Promise<void> {
  await invoke<void>("providers_delete_model", { modelId, providerId });
}

/** One model entry returned by a provider's GET /models endpoint. */
export interface FetchedModel {
  id: string;
  ownedBy?: string;
}

/**
 * Fetch the list of available models from a provider's `/models` endpoint.
 * Works for any OpenAI-compatible endpoint and for Anthropic. The `apiKey` is
 * used only for this request — it is never persisted. Pass `baseUrl` to
 * override the provider's preset (required for `custom`).
 */
export async function providersFetchModels(
  providerKind: ProviderKind,
  apiKey: string,
  baseUrl?: string,
): Promise<FetchedModel[]> {
  return invoke<FetchedModel[]>("providers_fetch_models", {
    providerKind,
    apiKey,
    baseUrl: baseUrl ?? null,
  });
}

// ---------- skills (x.ai/skills
export async function skillsList(cwd?: string): Promise<SkillInfo[]> {
  return invoke<SkillInfo[]>("skills_list", { cwd: cwd ?? null });
}

/** Add a skill path (directory or file) to `[skills].paths` and rescan. */
export async function skillsAdd(path: string, cwd?: string): Promise<void> {
  await invoke<void>("skills_add", { path, cwd: cwd ?? null });
}

/** Remove a skill path from `[skills].paths`. */
export async function skillsRemove(path: string, cwd?: string): Promise<void> {
  await invoke<void>("skills_remove", { path, cwd: cwd ?? null });
}

/** Enable or disable a skill by name (writes `[skills] disabled`). */
export async function skillsToggle(name: string, enabled: boolean): Promise<void> {
  await invoke<void>("skills_toggle", { name, enabled });
}

// ---------- connectors / MCP (x.ai/mcp
export async function mcpList(sessionId?: string): Promise<McpServerEntry[]> {
  return invoke<McpServerEntry[]>("mcp_list", { sessionId: sessionId ?? null });
}


export async function mcpUpsert(sessionId: string, server: McpUpsertRequest): Promise<void> {
  await invoke<void>("mcp_upsert", { sessionId, server });
}

/** Delete an MCP server by name. */
export async function mcpDelete(sessionId: string, name: string): Promise<void> {
  await invoke<void>("mcp_delete", { sessionId, name });
}

/** Enable or disable an MCP server at runtime. */
export async function mcpToggle(sessionId: string, name: string, enabled: boolean): Promise<void> {
  await invoke<void>("mcp_toggle", { sessionId, name, enabled });
}

/** Resolved absolute path of the standalone mcp.json (for the editor header). */
export async function mcpConfigPath(): Promise<string> {
  return invoke<string>("mcp_config_path");
}

/** Read the standalone mcp.json (returns an empty template if missing). */
export async function mcpConfigRead(): Promise<McpConfigFile> {
  return invoke<McpConfigFile>("mcp_config_read");
}


export async function mcpConfigSave(content: string, sessionId?: string): Promise<void> {
  await invoke<void>("mcp_config_save", { content, sessionId: sessionId ?? null });
}

// ---------- MCP OAuth authorization (x.ai/mcp/auth_*) ----------


export async function mcpAuthTrigger(
  sessionId: string,
  serverName: string,
): Promise<McpAuthTriggerResult> {
  return invoke<McpAuthTriggerResult>("mcp_auth_trigger", { sessionId, serverName });
}


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
export async function connectorsIcon(path: string): Promise<string> {
  return invoke<string>("connectors_icon", { path });
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
export async function skillsCatalogReadSkill(dir: string): Promise<string> {
  return invoke<string>("skills_catalog_read_skill", { dir });
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
export async function expertsThumbnail(path: string): Promise<string> {
  return invoke<string>("experts_thumbnail", { path });
}

/** Full-size local image as a `data:` URL (used for 精选场景 banners). */
export async function expertsImageBytes(path: string): Promise<string> {
  return invoke<string>("experts_image_bytes", { path });
}

/** Read the full agent prompt markdown from an expert's package directory. */
export async function expertsReadAgentPrompt(
  root: string,
  plugin: string,
  agentName: string,
): Promise<string> {
  return invoke<string>("experts_read_agent_prompt", { root, plugin, agentName });
}


export async function expertsLinkAgents(root: string, plugin: string): Promise<number> {
  return invoke<number>("experts_link_agents", { root, plugin });
}

/** Bind an expert to a session (OpenBuddy-only state). */
export async function agentSetSessionExpert(
  sessionId: string,
  expertId: string,
  expertName: string,
  source: string,
  avatarLocal?: string,
): Promise<boolean> {
  return invoke<boolean>("agent_set_session_expert", { sessionId, expertId, expertName, source, avatarLocal: avatarLocal ?? null });
}

/** Remove the expert binding from a session. */
export async function agentClearSessionExpert(sessionId: string): Promise<boolean> {
  return invoke<boolean>("agent_clear_session_expert", { sessionId });
}


/** List all agent definitions visible to OpenBuddy. */
export async function agentsList(cwd?: string): Promise<AgentEntry[]> {
  return invoke<AgentEntry[]>("agents_list", { cwd: cwd ?? null });
}

/** Fetch a single agent file's full contents. */
export async function agentsGet(path: string): Promise<string> {
  return invoke<string>("agents_get", { path });
}


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


/** List the current permission rules (allow/deny/ask) from config.toml. */
export async function permissionList(): Promise<PermissionRule[]> {
  return invoke<PermissionRule[]>("permission_list");
}


export async function permissionSave(rules: PermissionRule[]): Promise<void> {
  await invoke<void>("permission_save", { rules });
}



export type PermissionMode = "ask" | "auto" | "always-approve";

/** Read the configured permission mode (default "ask"). */
export async function permissionModeGet(): Promise<PermissionMode> {
  return invoke<PermissionMode>("permission_mode_get");
}


export async function permissionModeSet(mode: PermissionMode): Promise<void> {
  await invoke<void>("permission_mode_set", { mode });
}


/** List memory notes from global + workspace scope. */
export async function memoryList(cwd?: string): Promise<MemoryEntry[]> {
  return invoke<MemoryEntry[]>("memory_list", { cwd: cwd ?? null });
}

/** Read a single memory file. */
export async function memoryGet(scope: string, path: string, cwd?: string): Promise<string> {
  return invoke<string>("memory_get", { scope, path, cwd: cwd ?? null });
}

/** Create or overwrite a memory note. */
export async function memorySave(
  scope: string,
  path: string,
  content: string,
  cwd?: string,
): Promise<MemoryEntry> {
  return invoke<MemoryEntry>("memory_save", { scope, path, content, cwd: cwd ?? null });
}

/** Delete a memory note. */
export async function memoryDelete(scope: string, path: string, cwd?: string): Promise<void> {
  await invoke<void>("memory_delete", { scope, path, cwd: cwd ?? null });
}


export async function memoryRewrite(): Promise<void> {
  await invoke<void>("memory_rewrite");
}

/** Flush in-flight memory writes to disk (`x.ai/memory/flush`). */
export async function memoryFlush(): Promise<void> {
  await invoke<void>("memory_flush");
}

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
  return invoke<SlashCommand[]>("commands_list");
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

/** Kill a running task or subagent. */
export async function taskKill(taskId: string): Promise<void> {
  await invoke<void>("task_kill", { taskId });
}

// ---------- folder trust ----------


export async function folderTrustRespond(cwd: string, trusted: boolean): Promise<void> {
  await invoke<void>("folder_trust_respond", { cwd, trusted });
}

// ---------- plan mode ----------


export async function togglePlanMode(sessionId: string, enabled: boolean): Promise<void> {
  await invoke<void>("toggle_plan_mode", { sessionId, enabled });
}

// ---------- internal reload ----------


export async function internalReload(kind: "mcp_all" | "mcp_project" | "skills" | "models"): Promise<void> {
  await invoke<void>("internal_reload", { kind });
}

// ---------- automations (local scheduler, WorkBuddy 1:1) ----------

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

// ---------- inspiration (灵感面板) ----------


export async function inspirationGenerate(
  category: string,
  cwd?: string,
  count?: number,
): Promise<InspirationStarted> {
  return invoke<InspirationStarted>("inspiration_generate", {
    request: { category, cwd: cwd ?? null, count: count ?? null },
  });
}

// ---------- xAI API Key 管理 (x.ai/getApiKey / x.ai/setApiKey) ----------
// accountGetAuthUrl/accountCancelAuth）已随 OAuth 功能移除。OpenBuddy 仅保留
// xAI API Key（BYOK）认证路径。


export async function accountGetApiKey(): Promise<string | null> {
  return invoke<string | null>("account_get_api_key");
}

/** Set or clear the xAI API key. Empty/null clears it. */
export async function accountSetApiKey(key: string | null): Promise<void> {
  await invoke<void>("account_set_api_key", { key });
}


/** Read the new-session defaults (model + permission + remember-tool-approvals). */
export async function agentsDefaultsGet(): Promise<AgentDefaults> {
  return invoke<AgentDefaults>("agents_defaults_get");
}

/** Save the new-session defaults. Atomic write to config.toml. */
export async function agentsDefaultsSave(defaults: AgentDefaults): Promise<void> {
  await invoke<void>("agents_defaults_save", { defaults });
}


/** `[subagents]` config — currently exposes `max_depth` (nesting depth). */
export interface SubagentsConfig {
  
  maxDepth: number;
}

/** Read `[subagents].max_depth`. Returns 1 when unset. */
export async function subagentsConfigGet(): Promise<SubagentsConfig> {
  return invoke<SubagentsConfig>("subagents_config_get");
}

/** Write `[subagents].max_depth` (clamped ≥1). Requires agent restart. */
export async function subagentsConfigSave(maxDepth: number): Promise<number> {
  return invoke<number>("subagents_config_save", { maxDepth });
}


/** `[models].web_search` config — derived enabled flag + model id. */
export interface WebSearchConfig {
  /** true when a web_search model is set. */
  enabled: boolean;
  /** Configured web_search model id (empty = none). */
  model: string;
}

/** Read the web_search model. `enabled` is derived from whether a model is set. */
export async function webSearchConfigGet(): Promise<WebSearchConfig> {
  return invoke<WebSearchConfig>("web_search_config_get");
}

/** Enable/disable web search by setting/clearing `[models].web_search`.
 *  When enabling, `model` must be a non-empty model id. Requires agent restart. */
export async function webSearchConfigSave(
  enable: boolean,
  model?: string,
): Promise<boolean> {
  return invoke<boolean>("web_search_config_save", { enable, model });
}

// ---------- plugins + marketplace (x.ai/plugins/*, x.ai/marketplace/*) ----------

import type {
  MarketplaceListResponse,
  PluginsListResponse,
} from "./types";

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

/** List marketplace sources + plugins via `x.ai/marketplace/list`. */
export async function marketplaceList(sessionId?: string): Promise<MarketplaceListResponse> {
  return invoke<MarketplaceListResponse>("marketplace_list", { sessionId: sessionId ?? null });
}

/** Execute a marketplace action (install/uninstall/refresh/add_source/remove_source). */
export async function marketplaceAction(
  sessionId: string,
  action: unknown,
): Promise<unknown> {
  return invoke("marketplace_action", { sessionId, action });
}

// ---------- notification log (智能体邮箱) ----------

import type { NotificationEntry, NotificationKind } from "./types";


export async function notificationAppend(
  kind: NotificationKind | string,
  title: string,
  body?: string,
  sessionId?: string,
  severity?: "info" | "warn" | "error",
): Promise<void> {
  await invoke<void>("notification_append", {
    kind,
    title,
    body: body ?? null,
    sessionId: sessionId ?? null,
    severity: severity ?? null,
  });
}

/** List notifications (newest first). */
export async function notificationList(): Promise<NotificationEntry[]> {
  return invoke<NotificationEntry[]>("notification_list");
}

/** Mark a notification as read. */
export async function notificationMarkRead(id: number): Promise<void> {
  await invoke<void>("notification_mark_read", { id });
}

/** Mark all as read. */
export async function notificationMarkAllRead(): Promise<void> {
  await invoke<void>("notification_mark_all_read");
}

/** Clear all notifications. */
export async function notificationClear(): Promise<void> {
  await invoke<void>("notification_clear");
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

export interface AgentEventListeners { unlisten: UnlistenFn }
export async function subscribeAgentEvents(handlers: {
  onModelState?: (state: ModelState) => void;
  onUpdate?: (event: SessionUpdate) => void;
  onPermission?: (request: PermissionRequest) => void;
  onComplete?: (complete: PromptComplete) => void;
  onSummary?: (summary: SessionSummaryEvent) => void;
  onMcpStatus?: (payload: unknown) => void;
  onFolderTrust?: (payload: unknown) => void;
  onPermissionMode?: (payload: unknown) => void;
  onModelsUpdate?: (payload: unknown) => void;
  onQuestion?: (question: QuestionRequest) => void;
  onUiDismiss?: (event: { requestId: string; sessionId: string; reason: UiDismissReason }) => void;
  onUiState?: (event: ExtensionUiState) => void;
  onUiNotification?: (event: { sessionId: string; message: string; severity: "info" | "warning" | "error" }) => void;
  onAgentDied?: (payload: { reason: string }) => void;
  onTurnError?: (error: TurnErrorEvent) => void;
}): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = [];
  const wire = async <T>(event: string, callback: ((payload: T) => void) | undefined) => {
    if (callback) unlisteners.push(await listen<T>(event, e => callback(e.payload)));
  };
  try {
    await wire<{ sessionId: string; event: SessionUpdate }>("agent://event", ({ sessionId, event }) => {
      if (!sessionId) return;
      handlers.onUpdate?.({ ...event, sessionId });
      if (event.type === "agent_settled" && !event.replay) handlers.onComplete?.({ sessionId, promptId: "", stopReason: event.aborted ? "cancelled" : "end_turn" });
    });
    await wire("agent://permission", handlers.onPermission);
    await wire("agent://ui-request", handlers.onQuestion);
    await wire("agent://ui-dismiss", handlers.onUiDismiss);
    await wire("agent://ui-state", handlers.onUiState);
    await wire("agent://ui-notification", handlers.onUiNotification);
    await wire("agent://summary", handlers.onSummary);
    await wire("agent://mcp-status", handlers.onMcpStatus);
    await wire("agent://folder-trust", handlers.onFolderTrust);
    await wire("agent://permission-mode", handlers.onPermissionMode);
    await wire("agent://models-update", handlers.onModelsUpdate);
    await wire("agent://model-state", handlers.onModelState);
    await wire("agent://turn-error", handlers.onTurnError);
    await wire<{ sessionId: string; message: string }>("agent://error", handlers.onTurnError
      ? ({ sessionId, message }) => handlers.onTurnError!({ sessionId, kind: "error", detail: message })
      : undefined);
    return () => unlisteners.forEach(unlisten => unlisten());
  } catch (error) {
    unlisteners.forEach(unlisten => unlisten());
    throw error;
  }
}
