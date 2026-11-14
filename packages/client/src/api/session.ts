// §5.3 `session` module: agent_init, agent_new_session, agent_load_session, agent_list_sessions, agent_list_workspaces,
// agent_delete_session, agent_rename_session, agent_set_session_pinned/archived, agent_session_info/usage, agent_fork_session,
// tasks_list, task_kill, rewind_points, rewind_execute, agent_regenerate, agent_compact, agent_export_html, agent_set_mode,
// agent_abort_retry, agent_shutdown.
import type { ModelState, PiMessage, RewindPoint, RunningTask, SessionInfoResponse, SessionSummary, SessionUsage } from "@openbuddy/protocol/dto";
import { invoke } from "../ipc";
import type { AgentQueue } from "./turn";

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
/** Live snapshot of a pooled session: model state plus full history (no event replay). */
export interface SessionSnapshot extends ModelState {
  cwd: string;
  messages: PiMessage[];
  busy: boolean;
  status: "running" | "idle" | "failed";
  queue: AgentQueue;
}
export async function agentLoadSession(sessionId: string, cwd: string): Promise<SessionSnapshot> {
  return invoke<SessionSnapshot>("agent_load_session", { sessionId, cwd });
}

export async function agentListSessions(cwd: string, includeArchived = false): Promise<SessionSummary[]> {
  return invoke<SessionSummary[]>("agent_list_sessions", { cwd, ...(includeArchived ? { includeArchived } : {}) });
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

export const agentForkSession = (sessionId: string) => invoke<string>("agent_fork_session", { sessionId });

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

// ---------- rewind ----------

/** List prompts a session can rewind to. */
export async function rewindPoints(sessionId: string): Promise<RewindPoint[]> {
  return invoke<RewindPoint[]>("rewind_points", { sessionId });
}

/** 从这里编辑: drop a prompt and everything after it (conversation only; files are untouched). */
export async function rewindExecute(sessionId: string, entryId: string): Promise<{ editorText: string }> {
  return invoke<{ editorText: string }>("rewind_execute", { sessionId, entryId });
}

/** 重新生成: branch before the last prompt and send it again. */
export async function agentRegenerate(sessionId: string): Promise<void> {
  await invoke<void>("agent_regenerate", { sessionId });
}

/** `/compact [instructions]`: summarise older history to free context. */
export async function agentCompact(sessionId: string, instructions?: string): Promise<{ tokensBefore: number; tokensAfter?: number }> {
  return invoke("agent_compact", { sessionId, ...(instructions ? { instructions } : {}) });
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

export type AgentMode = "craft" | "plan" | "ask";

export const agentSetMode = (sessionId: string, mode: AgentMode) => invoke<void>("agent_set_mode", { sessionId, mode });
export const agentAbortRetry = (sessionId: string) => invoke<void>("agent_abort_retry", { sessionId });
/** `outputPath` must come from the save dialog in this window. */
export const agentExportHtml = (sessionId: string, outputPath: string) => invoke<string>("agent_export_html", { sessionId, outputPath });
