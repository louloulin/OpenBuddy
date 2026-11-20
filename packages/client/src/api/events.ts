// Event subscription: agent://… and app://… events from the host, fanned out to typed handlers.
import type { ConnectorNeededEvent, McpAuthAttempt, PermissionRequest, PromptComplete, SessionSummaryEvent, SessionUpdate, TurnErrorEvent } from "@openbuddy/protocol/dto";
import type { SessionModelState } from "@openbuddy/protocol/agent-settings";
import type { SubagentEvent } from "@openbuddy/protocol/subagent";
import { listen, type UnlistenFn } from "../ipc";
import type { QuestionRequest, UiDismissReason } from "../types";
import type { ExtensionUiState } from "./approvals";

// ---------- event subscription ----------

export interface AgentEventListeners { unlisten: UnlistenFn }
export async function subscribeAgentEvents(handlers: {
  /** Model, thinking level, mode and bound expert of a session (`agent://model-state`). */
  onModelState?: (state: SessionModelState) => void;
  onUpdate?: (event: SessionUpdate) => void;
  onPermission?: (request: PermissionRequest) => void;
  onComplete?: (complete: PromptComplete) => void;
  onSummary?: (summary: SessionSummaryEvent) => void;
  onMcpStatus?: (payload: unknown) => void;
  /** 授权尝试 (B3a): pending / authorized / failed / expired / cancelled. */
  onMcpAuth?: (attempt: McpAuthAttempt) => void;
  onFolderTrust?: (payload: unknown) => void;
  onPermissionMode?: (payload: unknown) => void;
  onModelsUpdate?: (payload: unknown) => void;
  onQuestion?: (question: QuestionRequest) => void;
  onUiDismiss?: (event: { requestId: string; sessionId: string; reason: UiDismissReason }) => void;
  onUiState?: (event: ExtensionUiState) => void;
  onUiNotification?: (event: { sessionId: string; message: string; severity: "info" | "warning" | "error" }) => void;
  onAgentDied?: (payload: { reason: string }) => void;
  onTurnError?: (error: TurnErrorEvent) => void;
  onSessionStatus?: (event: { sessionId: string; status: "running" | "idle" | "failed" }) => void;
  onPermissionDismiss?: (event: { requestId: string; sessionId: string; reason: string; allowed: boolean }) => void;
  onArtifacts?: (event: { sessionId: string }) => void;
  onFocusSession?: (event: { sessionId: string }) => void;
  /** An MCP tool needs its server authorized (pii W2.5). */
  onConnectorNeeded?: (event: ConnectorNeededEvent) => void;
  /** A sub-agent started / finished (pii W3.4). */
  onSubagent?: (event: SubagentEvent) => void;
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
    await wire<McpAuthAttempt>("agent://mcp-auth", handlers.onMcpAuth);
    await wire("agent://folder-trust", handlers.onFolderTrust);
    await wire("agent://permission-mode", handlers.onPermissionMode);
    await wire("agent://models-update", handlers.onModelsUpdate);
    await wire("agent://model-state", handlers.onModelState);
    await wire("agent://turn-error", handlers.onTurnError);
    await wire("agent://session-status", handlers.onSessionStatus);
    await wire("agent://permission-dismiss", handlers.onPermissionDismiss);
    await wire("agent://artifacts", handlers.onArtifacts);
    await wire("app://focus-session", handlers.onFocusSession);
    await wire<ConnectorNeededEvent>("agent://connector-needed", handlers.onConnectorNeeded);
    await wire<SubagentEvent>("agent://subagent", handlers.onSubagent);
    await wire<{ sessionId: string; message: string }>("agent://error", handlers.onTurnError
      ? ({ sessionId, message }) => handlers.onTurnError!({ sessionId, kind: "error", detail: message })
      : undefined);
    return () => unlisteners.forEach(unlisten => unlisten());
  } catch (error) {
    unlisteners.forEach(unlisten => unlisten());
    throw error;
  }
}

/**
 * Model state of any session (`agent://model-state`): model, thinking level and — since W0.5 — the
 * session's 做一做 / 想一想 / 问一问 mode, restored by the host when a session opens or switches branch.
 */
export async function onSessionModelState(callback: (state: SessionModelState) => void): Promise<UnlistenFn> {
  return listen<SessionModelState>("agent://model-state", (event) => callback(event.payload));
}

/** 授权尝试 (B3a) lifecycle: one event per state change, payload is the attempt. */
export async function onMcpAuthAttempt(callback: (attempt: McpAuthAttempt) => void): Promise<UnlistenFn> {
  return listen<McpAuthAttempt>("agent://mcp-auth", (event) => callback(event.payload));
}
