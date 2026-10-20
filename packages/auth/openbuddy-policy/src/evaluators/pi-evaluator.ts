/**
 * PiPermissionEvaluator — 把 `@openbuddy/auth-permission` 的 3-action 模型
 * (allow / deny / ask) 接到 AuthorizationPipeline。
 *
 * 行为:
 *   - 只在 context.tool 存在时匹配
 *   - evaluate → 调 resolvePermissionAction(rules, tool, pattern)
 *   - deny  → DENY_RULE + source "pi" + matchedRule "<tool>(<pattern>)"
 *   - ask   → ASK_RULE + allowed=false(ask 表示需要 UI 确认,默认 deny 等待)
 *   - allow → ALLOW_RULE + allowed=true
 *   - undefined → 返回 null(交给后续 evaluator)
 *
 * 集成路径:
 *   - 优先使用 `agentPermissionBridge` (P2.1 桥接,host-core IPC)
 *   - fallback 到 `@openbuddy/auth-permission` 的 resolvePermissionAction
 *
 * 单元测试: `__tests__/pi-evaluator.test.ts`
 */

import { resolvePermissionAction, type PermissionRule } from "@openbuddy/auth-permission";
import type {
  AuthorizationDecision,
  AuthorizationEvaluator,
  AuthorizationRequest,
  AuthorizationSource,
} from "../types.js";

export interface PiPermissionEvaluatorOptions {
  /** 注入的 rules(由 caller 提供;通常来自 agentPermissionBridge.readRules)。 */
  rules: PermissionRule[];
  /** 可选:提供 host-core bridge (P2.1) 用于异步 evaluate;否则用同步 resolvePermissionAction。 */
  evaluateViaBridge?: (tool: string, pattern?: string) => Promise<"allow" | "deny" | "ask" | undefined>;
}

export class PiPermissionEvaluator implements AuthorizationEvaluator {
  readonly name: AuthorizationSource = "pi";
  readonly priority: number = 100; // Pi 是 first-class,最高优先
  private readonly rules: PermissionRule[];
  private readonly evaluateViaBridge?: PiPermissionEvaluatorOptions["evaluateViaBridge"];

  constructor(options: PiPermissionEvaluatorOptions) {
    this.rules = options.rules;
    this.evaluateViaBridge = options.evaluateViaBridge;
  }

  matches(req: AuthorizationRequest): boolean {
    return typeof req.context?.tool === "string" && req.context.tool.length > 0;
  }

  async evaluate(req: AuthorizationRequest): Promise<AuthorizationDecision | null> {
    const tool = req.context!.tool as string;
    const pattern = typeof req.context?.pattern === "string" ? req.context.pattern : undefined;

    let action: "allow" | "deny" | "ask" | undefined;
    if (this.evaluateViaBridge) {
      action = await this.evaluateViaBridge(tool, pattern);
    } else {
      action = resolvePermissionAction(this.rules, tool, pattern);
    }

    if (action === undefined) return null;

    const matchedRule = `${tool}${pattern ? `(${pattern})` : ""}`;
    if (action === "deny") {
      return {
        allowed: false,
        reason: `pi rule denied ${matchedRule}`,
        code: "PI_DENY_RULE",
        source: "pi",
        matchedRule,
      };
    }
    if (action === "ask") {
      // ask = 需要 UI 确认;AuthorizationDecision 表达"待确认",allowed=false
      return {
        allowed: false,
        reason: `pi rule requires confirmation for ${matchedRule}`,
        code: "PI_ASK_RULE",
        source: "pi",
        matchedRule,
      };
    }
    // allow
    return {
      allowed: true,
      reason: `pi rule allowed ${matchedRule}`,
      code: "PI_ALLOW_RULE",
      source: "pi",
      matchedRule,
    };
  }
}
