/**
 * agent-audit-bridge — Audit log 双路径适配层 (P2.1-audit)
 *
 * 与 permission/secret bridge 同款模式:
 *   - audit.append
 *   - 优先 host-core IPC,失败静默降级到 JSONL 文件 fallback
 *   - 5 秒 backoff
 *
 * 注意: 这与 casdoor-audit.jsonl 是独立的两条审计流,本桥接器针对
 *       Rust host-core 实现的 audit.jsonl (统一审计日志)。
 *
 * 单元测试: `electron/main/agent/__tests__/agent-audit-bridge.test.ts`
 */

import { appendFile, mkdir, rename } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type { AuditOutcome } from "@openbuddy/host-runtime";
import { dirname, join } from "node:path";

import {
  callAuditAppend,
  type AuditEntry,
  type HostProcess,
} from "@openbuddy/host-runtime";

interface BridgeState {
  host: HostProcess | null;
  available: boolean;
  lastFailureMs: number;
  readonly backoffMs: number;
  /** Fallback JSONL path (set via attachHostCoreAudit). */
  fallbackPath: string | null;
}

const INITIAL_STATE: BridgeState = {
  host: null,
  available: true,
  lastFailureMs: 0,
  backoffMs: 5_000,
  fallbackPath: null,
};

let state: BridgeState = { ...INITIAL_STATE };

export function attachHostCoreAudit(host: HostProcess | null, options: { fallbackPath?: string } = {}): void {
  state = {
    ...state,
    host,
    available: host !== null,
    lastFailureMs: 0,
    fallbackPath: options.fallbackPath ?? state.fallbackPath,
  };
}

export function resetAgentAuditBridge(): void {
  state = { ...INITIAL_STATE };
}

function shouldTryHostCore(): boolean {
  if (!state.host || !state.available) return false;
  const now = Date.now();
  if (state.lastFailureMs > 0 && now - state.lastFailureMs < state.backoffMs) return false;
  return true;
}

function recordHostCoreFailure(err: unknown): void {
  state = { ...state, available: false, lastFailureMs: Date.now() };
  // eslint-disable-next-line no-console
  console.warn(
    "[agent-audit-bridge] host-core IPC failed, falling back to JSONL:",
    err instanceof Error ? err.message : String(err),
  );
}

function recordHostCoreSuccess(): void {
  if (!state.available || state.lastFailureMs > 0) {
    state = { ...state, available: true, lastFailureMs: 0 };
  }
}

export interface AppendParams {
  kind: string;
  outcome: "allow" | "deny" | "success" | "failure" | "info";
  action: string;
  subject?: string;
  resource?: string;
  reason?: string;
  code?: string;
  provider?: string;
  target?: string;
  tenantId?: string;
  detail?: Record<string, unknown>;
}

export async function auditAppendViaBridge(params: AppendParams): Promise<{ id: string; at: string; hash?: string }> {
  if (shouldTryHostCore()) {
    try {
      const res = await callAuditAppend(state.host!, {
        kind: params.kind,
        outcome: params.outcome,
        action: params.action,
        subject: params.subject,
        resource: params.resource,
        reason: params.reason,
        code: params.code,
        provider: params.provider,
        target: params.target,
      });
      recordHostCoreSuccess();
      return { id: res.id, at: res.at, hash: res.payloadHash };
    } catch (err) {
      recordHostCoreFailure(err);
    }
  }
  return appendToFallbackJsonl(params);
}

async function appendToFallbackJsonl(params: AppendParams): Promise<{ id: string; at: string }> {
  if (!state.fallbackPath) {
    // No fallback path configured — silently drop (host-core unavailable + no fallback)
    return { id: "dropped", at: new Date().toISOString() };
  }
  const at = new Date().toISOString();
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    at,
    event: params.action,
    outcome: params.outcome as AuditOutcome,
    source: "main",
    ...(params.subject ? { subject: params.subject } : {}),
    detail: {
      kind: (params.kind as AuditEntry["detail"]["kind"]) ?? "other",
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.resource ? { resource: params.resource } : {}),
      ...(params.reason ? { reason: params.reason } : {}),
      ...(params.code ? { code: params.code } : {}),
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.target ? { target: params.target } : {}),
    },
    hash: createHash("sha256").update(`${id}|${at}|${params.action}|${params.outcome}`).digest("hex").slice(0, 16),
  };
  const line = JSON.stringify(entry) + "\n";
  await mkdir(dirname(state.fallbackPath), { recursive: true });
  await appendFile(state.fallbackPath, line, "utf-8");
  return { id: entry.id, at: entry.at };
}

export function auditBridgeState(): { hostAttached: boolean; available: boolean; inBackoff: boolean; fallbackConfigured: boolean } {
  const inBackoff = state.lastFailureMs > 0 && Date.now() - state.lastFailureMs < state.backoffMs;
  return {
    hostAttached: state.host !== null,
    available: state.available,
    inBackoff,
    fallbackConfigured: state.fallbackPath !== null,
  };
}

// Suppress unused-import warning for `rename` (kept for future rotation feature)
void rename;
void join;
