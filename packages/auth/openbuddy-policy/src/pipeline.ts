/**
 * AuthorizationPipeline — 把 evaluators 串成一条决策链。
 *
 * 规则:
 *   1. 按 priority DESC 排序所有 evaluator
 *   2. 第一个返回非 null decision 的 evaluator 胜出
 *   3. 全 null → 返回 default deny(DEFAULT_DENY)
 *   4. 任何 evaluator throw → 捕获,记录 warn,继续下一个(不阻塞决策)
 *   5. decision.durationMs 记录整个 pipeline 用时
 *   6. 可选 audit writer:每次决定后异步写入,不阻塞返回
 */

import type {
  AuditDecisionEntry,
  AuditWriter,
  AuthorizationDecision,
  AuthorizationEvaluator,
  AuthorizationRequest,
  AuthorizationSource,
} from "./types.js";

const DEFAULT_PRIORITY = 0;

export class AuthorizationPipeline {
  private evaluators: AuthorizationEvaluator[] = [];
  private auditWriter: AuditWriter | null = null;
  private defaultPolicy: "deny" | "allow" = "deny";

  addEvaluator(e: AuthorizationEvaluator): this {
    this.evaluators.push(e);
    this.evaluators.sort((a, b) => b.priority - a.priority);
    return this;
  }

  removeEvaluator(name: AuthorizationSource): this {
    this.evaluators = this.evaluators.filter((e) => e.name !== name);
    return this;
  }

  setAuditWriter(writer: AuditWriter | null): this {
    this.auditWriter = writer;
    return this;
  }

  setDefaultPolicy(policy: "deny" | "allow"): this {
    this.defaultPolicy = policy;
    return this;
  }

  listEvaluators(): readonly { name: AuthorizationSource; priority: number }[] {
    return this.evaluators.map((e) => ({ name: e.name, priority: e.priority }));
  }

  async decide(req: AuthorizationRequest): Promise<AuthorizationDecision> {
    const startedAt = Date.now();

    for (const evaluator of this.evaluators) {
      if (!evaluator.matches(req)) continue;
      try {
        const result = await evaluator.evaluate(req);
        if (result !== null) {
          const decision: AuthorizationDecision = {
            ...result,
            durationMs: Date.now() - startedAt,
          };
          void this.writeAudit(req, decision);
          return decision;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[auth-policy] evaluator "${evaluator.name}" threw, continuing:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // 全 null / 全 throw → default policy
    const decision: AuthorizationDecision = this.defaultPolicy === "allow"
      ? {
          allowed: true,
          reason: "no evaluator matched; default allow",
          code: "DEFAULT_ALLOW",
          source: "default",
          durationMs: Date.now() - startedAt,
        }
      : {
          allowed: false,
          reason: "no evaluator matched; default deny",
          code: "DEFAULT_DENY",
          source: "default",
          durationMs: Date.now() - startedAt,
        };
    void this.writeAudit(req, decision);
    return decision;
  }

  private async writeAudit(req: AuthorizationRequest, decision: AuthorizationDecision): Promise<void> {
    if (!this.auditWriter) return;
    const entry: AuditDecisionEntry = {
      action: req.action,
      resource: req.resource,
      allowed: decision.allowed,
      code: decision.code,
      source: decision.source,
      ...(req.subject ? { subject: req.subject } : {}),
      ...(decision.matchedRule ? { matchedRule: decision.matchedRule } : {}),
      ...(decision.reason ? { reason: decision.reason } : {}),
    };
    try {
      await this.auditWriter.append(entry);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[auth-policy] audit writer failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

/**
 * 工厂:创建带默认 evaluator 集合的 pipeline(Pi + Casdoor)。
 * 调用方可继续 .addEvaluator(...) 扩展(folder_trust / plugin_capability)。
 */
export function createDefaultPipeline(): AuthorizationPipeline {
  return new AuthorizationPipeline();
}

// Re-export DEFAULT_PRIORITY for downstream evaluators
export { DEFAULT_PRIORITY };
