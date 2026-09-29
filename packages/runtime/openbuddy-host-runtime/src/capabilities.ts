/**
 * Typed capability wrappers for host-core RPC methods.
 *
 * Phase 1 — gives consumers (secrets / permissions / session_search /
 * workspace / audit) a stable TS surface without hand-rolling JSON-RPC
 * envelopes. Mirrors PI-Desktop `apps/desktop/electron/main/host/capabilities.ts`.
 *
 * Each helper is a thin function around `host.call(...)` with typed params +
 * result. Errors propagate from the host as `RpcCallError` (preserved by
 * `host.call`); callers can either handle them or let them bubble.
 */
import type { HostProcess } from "./host-process.js";

// -- secrets ---------------------------------------------------------------

export interface SecretMeta {
  ref: string;
  kind: string;
  backend: string;
  label?: string;
  updatedAt: string;
}

export interface SecretSetResult {
  ref: string;
  backend: string;
  updatedAt: string;
}

export async function callSecretsSet(
  host: HostProcess,
  params: { ref: string; value: string; label?: string; kind?: string },
): Promise<SecretSetResult> {
  return host.call("secrets.set", params);
}

export async function callSecretsGet(host: HostProcess, params: { ref: string }): Promise<{ backend: string; value: string | null }> {
  return host.call("secrets.get", params);
}

export async function callSecretsDelete(host: HostProcess, params: { ref: string }): Promise<{ ok: true }> {
  return host.call("secrets.delete", params);
}

export async function callSecretsList(host: HostProcess): Promise<{ backend: string; secrets: SecretMeta[] }> {
  return host.call("secrets.list");
}

// -- permissions -----------------------------------------------------------

export type PermissionAction = "allow" | "deny" | "ask";
export type PermissionMode = "default" | "acceptEdits" | "dontAsk" | "plan" | "bypassPermissions";

export interface PermissionRule {
  action: PermissionAction;
  tool: string;
  pattern?: string;
}

export interface PermissionDecision {
  action: PermissionAction;
  matchedRule?: string;
}

export async function callPermissionsEvaluate(
  host: HostProcess,
  params: { tool: string; pattern?: string },
): Promise<PermissionDecision> {
  return host.call("permissions.evaluate", params);
}

export async function callPermissionsReadRules(host: HostProcess): Promise<PermissionRule[]> {
  return host.call("permissions.readRules");
}

export async function callPermissionsWriteRules(
  host: HostProcess,
  rules: PermissionRule[],
): Promise<{ ok: true; count: number }> {
  return host.call("permissions.writeRules", { rules });
}

export async function callPermissionsReadMode(host: HostProcess): Promise<PermissionMode> {
  return host.call("permissions.readMode");
}

export async function callPermissionsWriteMode(host: HostProcess, mode: PermissionMode): Promise<{ ok: true; mode: PermissionMode }> {
  return host.call("permissions.writeMode", { mode });
}

// -- session search --------------------------------------------------------

export interface SearchHit {
  sessionId: string;
  title?: string;
  snippet: string;
  rank: number;
  lineNo: number;
  matchedAt?: string;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
}

export interface MessageResult {
  sessionId: string;
  lineNo: number;
  role?: string;
  content: string;
  createdAt?: string;
}

export async function callSessionSearch(
  host: HostProcess,
  params: { query: string; maxResults?: number },
): Promise<SearchResult> {
  return host.call("session.search", params);
}

export async function callSessionMessage(
  host: HostProcess,
  params: { sessionId: string; lineNo: number },
): Promise<MessageResult> {
  return host.call("session.message", params);
}

export async function callSessionSetRoot(
  host: HostProcess,
  params: { sessionsRoot: string },
): Promise<{ ok: true }> {
  return host.call("session.setRoot", params);
}

// -- workspace -------------------------------------------------------------

export interface ResolveResult {
  canonical: string;
  inWorkspace: boolean;
  isDirectory: boolean;
}

export interface CheckResult {
  inWorkspace: boolean;
  isDirectory: boolean;
  isFile: boolean;
  exists: boolean;
  ignored: boolean;
}

export interface IgnoredEntry {
  path: string;
  matchedPattern?: string;
}

export async function callWorkspaceSetRoot(
  host: HostProcess,
  params: { workspaceRoot: string },
): Promise<{ ok: true }> {
  return host.call("workspace.setRoot", params);
}

export async function callWorkspaceResolve(host: HostProcess, params: { path: string }): Promise<ResolveResult> {
  return host.call("workspace.resolve", params);
}

export async function callWorkspaceCheck(host: HostProcess, params: { path: string }): Promise<CheckResult> {
  return host.call("workspace.check", params);
}

export async function callWorkspaceListIgnored(
  host: HostProcess,
  params: { max?: number } = {},
): Promise<IgnoredEntry[]> {
  return host.call("workspace.listIgnored", params);
}

// -- audit -----------------------------------------------------------------
//
// Wire shape (v1, 与 crates/openbuddy-host-core/src/audit/mod.rs::AuditLogLine 对齐):
//
//   写入: audit.append
//     params = { kind, outcome, action, subject?, tenant_id?, resource?,
//                reason?, code?, provider?, target? }
//     result = { id, at, payloadHash }   ← AppendResult(payloadHash 字段名保留,
//                                              用于响应 ID + 给调用方做引用)
//
//   读取: audit.tail
//     params = { limit? }
//     result = { entries: AuditEntry[], rotatedFiles }
//
// AuditEntry(Tail 返回的 wire shape,与磁盘 audit.jsonl 每行一致):
//   {
//     id: string,
//     at: string,                         // ISO-8601 UTC
//     event: string,                      // 来自 AuditEntry.action(如 "bash.run")
//     outcome: "success" | "failure" | "deny" | "info",
//                                         // Rust 侧映射:
//                                         //   Success → "success"
//                                         //   Failure → "failure"
//                                         //   Denied  → "deny"
//                                         //   Timeout → "failure"
//     source: "main" | "renderer" | ...,  // 当前 Rust 写入固定为 "main"
//     subject?: string,
//     detail: {
//       kind: "Auth" | "Permission" | "FolderTrust" | "Tool" | "Plugin"
//            | "Secret" | "Host" | "Other",
//       tenant_id?: string,
//       resource?: string,
//       reason?: string,
//       code?: string,
//       provider?: string,
//       target?: string,
//     },
//     hash: string,                       // SHA-256(前 12 字节 hex)
//   }
//
// ADR-0012: 此 wire shape 同步双向契约,Rust ↔ TS 字段一致;
// 旧 shape ({kind, outcome, action, subject?, payloadHash}) 在 R97/S5 中废弃。

// Rust 端用 #[serde(rename_all = "snake_case")] 序列化,所以 wire shape 是 snake_case:
//   Auth → "auth" / Permission → "permission" / FolderTrust → "folder_trust" /
//   Tool → "tool" / Plugin → "plugin" / Secret → "secret" / Host → "host" /
//   额外预留 "other" 给 renderer-only 事件(不来自 host-core)。
export type AuditKind =
  | "auth"
  | "permission"
  | "folder_trust"
  | "tool"
  | "plugin"
  | "secret"
  | "host"
  | "other";

// outcome 字符串来自 AuditLogLine::From<&AuditEntry>:
//   Success → "success" / Failure → "failure" / Denied → "deny" / Timeout → "failure"。
// "info" 留给 renderer-only 软事件(进度 / 通知 / debug)。
export type AuditOutcome =
  | "success"
  | "failure"
  | "deny"
  | "info";

export interface AuditEntry {
  id: string;
  at: string;
  event: string;
  outcome: AuditOutcome;
  source: string;
  subject?: string;
  detail: AuditEntryDetail;
  hash: string;
}

export interface AuditEntryDetail {
  kind: AuditKind;
  tenant_id?: string;
  resource?: string;
  reason?: string;
  code?: string;
  provider?: string;
  target?: string;
}

export interface AuditAppendParams {
  kind: string;
  outcome: string;
  action: string;
  subject?: string;
  tenant_id?: string;
  resource?: string;
  reason?: string;
  code?: string;
  provider?: string;
  target?: string;
}

/**
 * audit.append 返回的是 AppendResult(id/at/payloadHash),不是 AuditEntry。
 * append 路径是「写一条记录」,不返回完整 wire shape — 调用方拿 id + at +
 * payloadHash 即可做引用 / 校验。完整 AuditEntry(带 detail 聚合)只在 tail
 * 路径返回。
 */
export interface AuditAppendResult {
  id: string;
  at: string;
  payloadHash: string;
}

export async function callAuditAppend(
  host: HostProcess,
  params: AuditAppendParams,
): Promise<AuditAppendResult> {
  return host.call("audit.append", params);
}

export async function callAuditTail(
  host: HostProcess,
  params: { limit?: number } = {},
): Promise<{ entries: AuditEntry[]; rotatedFiles: number }> {
  return host.call("audit.tail", params);
}
