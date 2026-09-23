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

export interface AuditEntry {
  id: string;
  kind: string;
  outcome: string;
  action: string;
  subject?: string;
  payloadHash: string;
  at: string;
}

export async function callAuditAppend(
  host: HostProcess,
  params: { kind: string; outcome: string; action: string; subject?: string; payload?: unknown },
): Promise<AuditEntry> {
  return host.call("audit.append", params);
}

export async function callAuditTail(
  host: HostProcess,
  params: { limit?: number },
): Promise<{ entries: AuditEntry[]; rotatedFiles: number }> {
  return host.call("audit.tail", params);
}
