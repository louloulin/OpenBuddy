/**
 * audit-bridge — AuthorizationPipeline ↔ host-core audit (P1.6)
 *
 * 把 AuthorizationPipeline 的 decision 写入 host-core audit (P2.1-audit):
 *   - AuthorizationDecision.code → AuditKind 映射
 *   - allowed=true  → outcome "allow"
 *   - allowed=false → outcome "deny"
 *   - subject / resource / reason / matchedRule → detail 字段
 *
 * 集成路径:
 *   const pipeline = new AuthorizationPipeline()
 *     .addEvaluator(...)
 *     .setAuditWriter(createHostCoreAuditWriter({ auditAppend: auditAppendViaBridge }));
 *
 * 不直接依赖 host-runtime;通过 auditAppend 注入。
 *
 * 单元测试: `__tests__/audit-bridge.test.ts`
 */

import type {
  AuditDecisionEntry,
  AuditWriter,
} from "./types.js";

/**
 * audit.append 的最小签名(由 host-runtime callAuditAppend 满足)。
 * 接受 null = host-core 未挂载(此时 writer 自动 no-op)。
 */
export type AuditAppendFn = (params: {
  kind: string;
  outcome: "allow" | "deny" | "success" | "failure" | "info";
  action: string;
  subject?: string;
  resource?: string;
  reason?: string;
  code?: string;
  provider?: string;
  target?: string;
}) => Promise<{ id: string; at: string }>;

export interface CreateAuditWriterOptions {
  auditAppend: AuditAppendFn | null;
  /** 可选:前缀(默认 "authz")让 audit 记录更易过滤 */
  actionPrefix?: string;
  /** 可选:失败回调(默认 swallow) */
  onError?: (err: unknown) => void;
}

/**
 * 把 host-core audit append 函数包装成 AuthorizationPipeline 的 AuditWriter。
 *
 * Pipeline 写入的 AuditDecisionEntry 会被翻译为 host-core audit 的格式:
 *   - action = `${actionPrefix ?? "authz"}.${request.action}`(例如 "authz.bash.run")
 *   - kind = decision.code 的来源部分("PI" / "CASDOOR" / "FOLDER" / "PLUGIN" / "DEFAULT")
 *   - outcome = allowed ? "allow" : "deny"
 *   - subject / resource / code / reason / matchedRule → 透传
 */
export function createHostCoreAuditWriter(options: CreateAuditWriterOptions): AuditWriter | null {
  const { auditAppend, actionPrefix = "authz", onError } = options;
  if (!auditAppend) return null;

  return {
    async append(entry: AuditDecisionEntry): Promise<void> {
      const kind = mapCodeToAuditKind(entry.code);
      const outcome: "allow" | "deny" = entry.allowed ? "allow" : "deny";
      const action = `${actionPrefix}.${entry.action}`;
      try {
        await auditAppend({
          kind,
          outcome,
          action,
          ...(entry.subject ? { subject: entry.subject } : {}),
          ...(entry.resource ? { resource: entry.resource } : {}),
          ...(entry.code ? { code: entry.code } : {}),
          ...(entry.reason ? { reason: entry.reason } : {}),
          ...(entry.matchedRule ? { target: entry.matchedRule } : {}),
        });
      } catch (err) {
        if (onError) onError(err);
        else {
          // eslint-disable-next-line no-console
          console.warn(
            "[auth-policy/audit-bridge] host-core audit.append failed:",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    },
  };
}

/**
 * 把 AuthorizationCode 翻译成 AuditKind 字符串。
 * 规范:AuthorizationCode 前缀就是 audit kind。
 *   - "PI_*"        → "permission"
 *   - "CASDOOR_*"   → "permission"(合并到 permission kind)
 *   - "FOLDER_*"    → "folder_trust"
 *   - "PLUGIN_*"    → "plugin"
 *   - "DEFAULT_*"   → "permission"(默认 fallback 也算 permission)
 */
function mapCodeToAuditKind(code: string): string {
  if (code.startsWith("FOLDER_")) return "folder_trust";
  if (code.startsWith("PLUGIN_")) return "plugin";
  // PI_*, CASDOOR_*, DEFAULT_* 都归 permission kind
  return "permission";
}
