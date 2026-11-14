// §5.3 `approvals` module: agent_resolve_permission, agent_resolve_ui, agent_resolve_question, permission_list, permission_save,
// permission_mode_get, permission_mode_set, folder_trust_respond.
import type { PermissionRule } from "@openbuddy/protocol/dto";
import { invoke } from "../ipc";

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
