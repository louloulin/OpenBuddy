/**
 * 本地策略引擎 —— 企业策略/IOA 部署的本地可移植替代。
 *
 * WorkBuddy 的企业策略(enterprise-policy)用于集中管控:技能上传策略、模型白名单、
 * 沙箱规则下发、权限模式锁定等,绑定腾讯 IOA 内网部署。OpenBuddy 是个人桌面应用,
 * 用「本地策略引擎」替代:从本地配置文件加载策略集,在运行时强制执行(gate 关键操作)。
 * 纯函数核心(策略匹配 + 评估 + 默认值合并),便于单测。
 */

/** 策略类型。 */
export type PolicyType =
  | "model-whitelist" // 允许使用的模型 id 白名单
  | "skill-upload" // 是否允许上传/安装技能
  | "permission-mode" // 锁定权限模式(ask/auto/always-approve)
  | "sandbox-rules" // 下发沙箱规则
  | "max-tokens-per-day" // 每日 token 上限
  | "disabled-features"; // 禁用的功能列表

/** 一条策略规则。 */
export interface PolicyRule {
  /** 策略类型。 */
  type: PolicyType;
  /** 策略值(类型取决于 type)。 */
  value: unknown;
  /** 优先级(高优先级覆盖低;默认 0)。 */
  priority?: number;
  /** 来源标识(如 "enterprise-config" / "user-pref")。 */
  source?: string;
}

/** 策略集(多条规则按 type 去重,高优先级覆盖)。 */
export interface PolicySet {
  rules: PolicyRule[];
}

/** 合并多条规则:同 type 取最高优先级;无优先级则后覆盖前。纯函数。 */
export function mergeRules(rules: PolicyRule[]): PolicySet {
  const byType = new Map<PolicyType, PolicyRule>();
  for (const rule of rules) {
    const existing = byType.get(rule.type);
    if (!existing) {
      byType.set(rule.type, rule);
      continue;
    }
    // 高优先级覆盖低;同优先级后者覆盖前者。
    const existingPrio = existing.priority ?? 0;
    const newPrio = rule.priority ?? 0;
    if (newPrio >= existingPrio) byType.set(rule.type, rule);
  }
  return { rules: [...byType.values()] };
}

/** 取某类型策略的值(无则 undefined)。 */
export function getPolicyValue<T>(set: PolicySet, type: PolicyType): T | undefined {
  return set.rules.find((r) => r.type === type)?.value as T | undefined;
}

/** 评估模型白名单:modelId 是否允许。 */
export function isModelAllowed(set: PolicySet, modelId: string): boolean {
  const whitelist = getPolicyValue<string[]>(set, "model-whitelist");
  if (!whitelist || whitelist.length === 0) return true; // 无白名单 = 全允许
  return whitelist.includes(modelId);
}

/** 评估技能上传策略:是否允许。 */
export function canUploadSkill(set: PolicySet): boolean {
  const allowed = getPolicyValue<boolean>(set, "skill-upload");
  return allowed !== false; // 默认允许(仅 false 禁止)
}

/** 取锁定的权限模式(无则 undefined = 用户自选)。 */
// Policy-set permission mode value aligned with Pi native 5档.
// See packages/auth/openbuddy-permission/src/index.ts:43-54 for the canonical type.
export type PolicyPermissionMode = "default" | "acceptEdits" | "dontAsk" | "plan" | "bypassPermissions";

export function getLockedPermissionMode(set: PolicySet): PolicyPermissionMode | undefined {
  return getPolicyValue<PolicyPermissionMode>(set, "permission-mode");
}

/** 取每日 token 上限(无则 undefined = 不限)。 */
export function getMaxTokensPerDay(set: PolicySet): number | undefined {
  return getPolicyValue<number>(set, "max-tokens-per-day");
}

/** 检查某功能是否被禁用。 */
export function isFeatureDisabled(set: PolicySet, feature: string): boolean {
  const disabled = getPolicyValue<string[]>(set, "disabled-features");
  if (!disabled) return false;
  return disabled.includes(feature);
}

/** 策略检查结果(用于 gate)。 */
export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

/** gate:检查某操作是否被策略允许。 */
export function checkPolicy(
  set: PolicySet,
  action: { kind: "use-model"; modelId: string } | { kind: "upload-skill" } | { kind: "use-feature"; feature: string },
): PolicyCheckResult {
  switch (action.kind) {
    case "use-model":
      if (!isModelAllowed(set, action.modelId)) {
        return { allowed: false, reason: `模型 ${action.modelId} 不在白名单` };
      }
      return { allowed: true };
    case "upload-skill":
      if (!canUploadSkill(set)) {
        return { allowed: false, reason: "策略禁止上传技能" };
      }
      return { allowed: true };
    case "use-feature":
      if (isFeatureDisabled(set, action.feature)) {
        return { allowed: false, reason: `功能 ${action.feature} 已被策略禁用` };
      }
      return { allowed: true };
  }
}

/** 序列化/反序列化(localStorage 持久化)。 */
export function serializePolicySet(set: PolicySet): string {
  return JSON.stringify(set);
}
export function deserializePolicySet(json: string, fallback: PolicySet = { rules: [] }): PolicySet {
  try {
    const obj = JSON.parse(json) as PolicySet;
    if (!Array.isArray(obj.rules)) return fallback;
    return obj;
  } catch {
    return fallback;
  }
}
