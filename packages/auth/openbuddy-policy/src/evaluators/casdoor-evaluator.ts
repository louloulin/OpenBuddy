/**
 * CasdoorEvaluator — 把 `@openbuddy/auth-casdoor` 的 RBAC 决策
 * (authorizeCasdoorTenant) 接到 AuthorizationPipeline。
 *
 * 行为:
 *   - 只在 context.capability / context.permission / context.resource 存在时匹配
 *   - 把 CasdoorAuthorizationCode 映射到 AuthorizationCode
 *   - allowed=true → CASDOOR_AUTHORIZED
 *   - allowed=false → 各种 CASDOOR_*_DENIED/REQUIRED 之一
 *
 * 集成路径:
 *   - caller 提供一个 `authorizeFn`,包装 casdoorAuth.authorize(...)
 *     (避免本 package 直接依赖 electron/main)
 *
 * 单元测试: `__tests__/casdoor-evaluator.test.ts`
 */

import type {
  AuthorizationCode,
  AuthorizationDecision,
  AuthorizationEvaluator,
  AuthorizationRequest,
  AuthorizationSource,
} from "../types.js";

/** Casdoor-side identity snapshot(只读)。 */
export interface CasdoorIdentityLike {
  subject?: string;
  isAdmin?: boolean;
  isForbidden?: boolean;
  isDeleted?: boolean;
  tenantMemberships?: ReadonlyArray<{
    tenantId: string;
    capabilities?: readonly string[];
    permissions?: readonly string[];
    tenantPermissions?: readonly string[];
    isTenantAdmin?: boolean;
  }>;
}

export interface CasdoorEvaluatorOptions {
  identity: CasdoorIdentityLike | null;
  /** tenant context(可选);为 undefined 时用 identity.tenantMemberships[0]?.tenantId */
  activeTenantId?: string;
  /** 注入 authorize fn(caller 包装 casdoorAuth.authorize) */
  authorize: (input: {
    identity: CasdoorIdentityLike | null;
    activeTenantId?: string;
    requirement:
      | { capability: string }
      | { permission: string }
      | { resource: string; action: string; resourceId?: string };
  }) => { allowed: boolean; reason: string; code: string; tenantId?: string; subject?: string };
}

export class CasdoorEvaluator implements AuthorizationEvaluator {
  readonly name: AuthorizationSource = "casdoor";
  readonly priority: number = 50; // 在 Pi 之后
  private readonly options: CasdoorEvaluatorOptions;

  constructor(options: CasdoorEvaluatorOptions) {
    this.options = options;
  }

  matches(req: AuthorizationRequest): boolean {
    const ctx = req.context;
    return Boolean(
      ctx?.capability ||
      ctx?.permission ||
      (ctx?.resource && typeof req.action === "string"),
    );
  }

  async evaluate(req: AuthorizationRequest): Promise<AuthorizationDecision | null> {
    const ctx = req.context ?? {};
    let requirement:
      | { capability: string }
      | { permission: string }
      | { resource: string; action: string; resourceId?: string };
    if (ctx.capability) {
      requirement = { capability: ctx.capability as string };
    } else if (ctx.permission) {
      requirement = { permission: ctx.permission as string };
    } else {
      requirement = {
        resource: ctx.resource as string,
        action: req.action,
        ...(typeof ctx.resourceId === "string" ? { resourceId: ctx.resourceId } : {}),
      };
    }

    const result = this.options.authorize({
      identity: this.options.identity,
      ...(this.options.activeTenantId ? { activeTenantId: this.options.activeTenantId } : {}),
      requirement,
    });

    const code = mapCasdoorCodeToAuthCode(result.code, result.allowed);
    return {
      allowed: result.allowed,
      reason: result.reason,
      code,
      source: "casdoor",
      ...(result.tenantId ? { matchedRule: `tenant:${result.tenantId}` } : {}),
    };
  }
}

/**
 * 把 casdoor 的 reason code 字符串映射到 AuthorizationCode 枚举。
 * Caller 必须保证传入的 code 是以下之一(否则归类为 PERMISSION_DENIED)。
 */
function mapCasdoorCodeToAuthCode(rawCode: string, allowed: boolean): AuthorizationCode {
  if (allowed) return "CASDOOR_AUTHORIZED";
  switch (rawCode) {
    case "CASDOOR_SIGNED_OUT": return "CASDOOR_SIGNED_OUT";
    case "CASDOOR_TENANT_REQUIRED": return "CASDOOR_TENANT_REQUIRED";
    case "CASDOOR_TENANT_MEMBERSHIP_REQUIRED": return "CASDOOR_TENANT_MEMBERSHIP_REQUIRED";
    case "CASDOOR_USER_FORBIDDEN": return "CASDOOR_USER_FORBIDDEN";
    case "CASDOOR_PERMISSION_DENIED": return "CASDOOR_PERMISSION_DENIED";
    default: return "CASDOOR_PERMISSION_DENIED";
  }
}
