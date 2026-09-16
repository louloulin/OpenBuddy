/**
 * Renderer-side wrappers for the local Audit Trail IPC.
 *
 * R17 / Phase D — 严格本地;不向任何远端发送。
 */
import { invoke } from "@/lib/platform/electron-api";

export type AuditOutcome = "allow" | "deny" | "success" | "failure" | "info";
export type AuditSource = "renderer" | "main" | "ipc" | "plugin" | "casdoor";

export interface AuditEvent {
  id: string;
  at: string;
  event: string;
  outcome: AuditOutcome;
  source: AuditSource;
  subject?: string;
  detail?: Record<string, unknown>;
  hash?: string;
}

export function auditList(args?: { limit?: number; cursor?: string }): Promise<{ events: AuditEvent[]; nextCursor?: string }> {
  return invoke("audit:list", args);
}

export function auditRecord(args: { event: string; outcome?: AuditOutcome; subject?: string; detail?: Record<string, unknown> }): Promise<{ ok: true; id: string; at: string } | { ok: false; error: string }> {
  return invoke("audit:record", args);
}

export function auditClear(): Promise<{ ok: true }> {
  return invoke("audit:clear");
}
