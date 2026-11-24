// §5.3 `approvals` module: agent_resolve_permission, agent_resolve_ui, agent_resolve_question, permission_list, permission_save,
// permission_mode_get, permission_mode_set, folder_trust_respond.
import type { PermissionRule } from "@openbuddy/protocol/dto";
import { invoke, listen, type UnlistenFn } from "../ipc";
import type { ToolContentRiskEvent } from "@openbuddy/protocol/tool-content-risk";

export async function agentResolvePermission(
  requestId: string,
  outcome: { optionId?: string; cancelled?: boolean; reason?: string }
): Promise<void> {
  await invoke<void>("agent_resolve_permission", {
    requestId,
    optionId: outcome.optionId ?? null,
    cancelled: outcome.cancelled ?? false,
    ...(outcome.reason?.trim() ? { reason: outcome.reason.trim().slice(0, 500) } : {}),
  });
}

export const agentResolveUi = (payload: { requestId: string; sessionId: string; value?: string | boolean; cancelled?: boolean }) => invoke<void>("agent_resolve_ui", payload);
export type ExtensionUiState =
  | { sessionId: string; kind: "status"; key: string; text?: string }
  | { sessionId: string; kind: "working"; message?: string | null; visible?: boolean }
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

/** List the current permission rules (allow/deny/ask) from config.toml. */
export async function permissionList(): Promise<PermissionRule[]> {
  return invoke<PermissionRule[]>("permission_list");
}


export async function permissionSave(rules: PermissionRule[]): Promise<void> {
  await invoke<void>("permission_save", { rules });
}

/** 受保护路径 (pii W6.2): patterns write/edit/delete tools can never touch, in every mode. */
export async function permissionProtectedGet(): Promise<{ paths: string[]; defaults: string[] }> {
  return invoke<{ paths: string[]; defaults: string[] }>("permission_protected_get");
}

export async function permissionProtectedSet(paths: string[]): Promise<{ paths: string[] }> {
  return invoke<{ paths: string[] }>("permission_protected_set", { paths });
}

// ---------- 沙箱与网络策略 (G2-3) + 安全审计 (G2-5) ----------

/** The hard boundary checked before every permission rule; empty lists mean "not restricted". */
export interface SandboxPolicy {
  fileWriteAllow: string[];
  commandAllow: string[];
  networkAllow: string[];
}

export async function securityPolicyGet(): Promise<SandboxPolicy> {
  return invoke<SandboxPolicy>("security_policy_get");
}

export async function securityPolicySet(policy: SandboxPolicy): Promise<SandboxPolicy> {
  return invoke<SandboxPolicy>("security_policy_set", { ...policy });
}

export interface AuditEvent {
  ts: string;
  sessionId?: string;
  tool?: string;
  action: string;
  target?: string;
  reason?: string;
  actor?: string;
}

export async function securityAuditList(limit = 200): Promise<AuditEvent[]> {
  const result = await invoke<{ events: AuditEvent[] }>("security_audit_list", { limit });
  return result?.events ?? [];
}

// ---------- 工具内容注入审查 (G2-7) ----------

/** Subscribe to the tool results the engine withheld for a possible prompt injection. */
export async function subscribeToolContentRisk(
  handler: (event: ToolContentRiskEvent) => void,
): Promise<UnlistenFn> {
  return listen<ToolContentRiskEvent>("agent://tool-content-risk", (event) => {
    const payload = event.payload;
    if (payload && typeof payload.sessionId === "string" && typeof payload.toolCallId === "string") handler(payload);
  });
}

/** The user lets a withheld tool output through; the original text comes back. */
export async function agentAllowToolContent(
  toolCallId: string,
): Promise<{ text: string; toolName: string }> {
  return invoke<{ text: string; toolName: string }>("agent_allow_tool_content", { toolCallId });
}

export type PermissionMode = "ask" | "auto" | "always-approve";

/** Read the configured permission mode (default "ask"). */
export async function permissionModeGet(): Promise<PermissionMode> {
  return invoke<PermissionMode>("permission_mode_get");
}


export async function permissionModeSet(mode: PermissionMode): Promise<void> {
  await invoke<void>("permission_mode_set", { mode });
}

// ---------- folder trust ----------


export async function folderTrustRespond(cwd: string, trusted: boolean): Promise<void> {
  await invoke<void>("folder_trust_respond", { cwd, trusted });
}
