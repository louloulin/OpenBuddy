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

export type AuditExportFormat = "jsonl" | "json";

export interface AuditExportOutcome {
  ok: boolean;
  /** 实际写入的路径(成功时)。 */
  path?: string;
  count?: number;
  bytes?: number;
  format?: AuditExportFormat;
  /** 失败原因(未审批的路径 / 写盘失败 / 缺参数)。 */
  error?: string;
}

/**
 * 导出本地审计日志(R41)。
 *
 * `path` **必须**来自 `save()`(原生保存对话框)—— 主进程会校验这一点
 * (一次性审批,见 `electron/main/ipc/save-path-approval.ts`);随手传一个绝对
 * 路径会被拒绝,这是防止渲染层被攻破后往 ~/.zshrc 之类的地方写文件。
 */
export function auditExport(args: { path: string; format?: AuditExportFormat; limit?: number }): Promise<AuditExportOutcome> {
  return invoke("audit:export", args);
}
