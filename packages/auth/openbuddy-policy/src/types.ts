/**
 * @openbuddy/auth-policy — 统一授权决策中心 (P1.1)
 *
 * 把四种授权源(Pi permission / Casdoor RBAC / Folder trust / Plugin capability)
 * 统一为一条 `AuthorizationRequest → AuthorizationDecision` 决策链。
 *
 * 设计目标:
 *   1. **可插拔 evaluator**:每个授权源实现 AuthorizationEvaluator 接口
 *   2. **优先级链**:高优先级 evaluator 命中即返回;全未命中走 default deny
 *   3. **审计自动联动**:decision.code 与 audit kind 一一对应,自动写入
 *   4. **零外部状态**:pipeline 是 pure function of evaluators + request,
 *      方便在 main / renderer / worker 任一进程内单测
 *
 * 不替代:
 *   - `@openbuddy/auth-permission` (Pi rules 存储)
 *   - `@openbuddy/auth-casdoor` (Casdoor RBAC)
 *   - `@openbuddy/capability-authorization` (Cordis 交互流 / OAuth prompts)
 *
 * 单元测试: `__tests__/pipeline.test.ts`
 */

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

export interface AuthorizationRequest {
  /** 谁在请求(user / session id / api-key id / plugin name) */
  subject: string;
  /** 抽象动作(verb-noun,例如 "bash.run" / "secret.read" / "workspace.write") */
  action: string;
  /** 抽象资源(被作用的对象,例如 "bash" / "secret:openai" / "/path/to/folder") */
  resource: string;
  /** 可选上下文(evaluator 根据需要消费) */
  context?: AuthorizationContext;
}

export interface AuthorizationContext {
  /** pi tool name(例如 "bash"),PiPermissionEvaluator 必读 */
  tool?: string;
  /** pi command pattern(例如 "rm -rf *"),PiPermissionEvaluator 必读 */
  pattern?: string;
  /** tenant id,CasdoorEvaluator 必读 */
  tenantId?: string;
  /** resource id,CasdoorEvaluator 可选 */
  resourceId?: string;
  /** Casdoor capability(例如 "team.workspace") */
  capability?: string;
  /** Casdoor tenant permission(例如 "tenant.users.read") */
  permission?: string;
  /** plugin manifest name,PluginCapabilityEvaluator 必读 */
  plugin?: string;
  /** workspace folder absolute path,FolderTrustEvaluator 必读 */
  folder?: string;
  /** 任意扩展字段(evaluator 可读;serialized 到 audit detail) */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Decision shape
// ---------------------------------------------------------------------------

export type AuthorizationSource =
  | "pi"
  | "casdoor"
  | "folder_trust"
  | "plugin_capability"
  | "default";

export type AuthorizationCode =
  // Pi (3 actions × rule hit/miss/deny)
  | "PI_ALLOW_RULE" | "PI_DENY_RULE" | "PI_ASK_RULE"
  // Casdoor
  | "CASDOOR_AUTHORIZED"
  | "CASDOOR_SIGNED_OUT"
  | "CASDOOR_TENANT_REQUIRED"
  | "CASDOOR_TENANT_MEMBERSHIP_REQUIRED"
  | "CASDOOR_USER_FORBIDDEN"
  | "CASDOOR_PERMISSION_DENIED"
  // Folder trust
  | "FOLDER_TRUSTED" | "FOLDER_UNTRUSTED"
  // Plugin
  | "PLUGIN_CAPABILITY_ALLOWED" | "PLUGIN_CAPABILITY_DENIED"
  // Default (no evaluator matched)
  | "DEFAULT_DENY" | "DEFAULT_ALLOW";

export interface AuthorizationDecision {
  /** 是否允许。 */
  allowed: boolean;
  /** 人类可读的拒绝原因(允许时为 "ok" / "" / source 描述)。 */
  reason: string;
  /** 规范化错误码(枚举,稳定,可写入 audit kind)。 */
  code: AuthorizationCode;
  /** 决策来自哪个 evaluator("default" 表示全未命中)。 */
  source: AuthorizationSource;
  /** 命中的规则字符串(可选,便于 UI 展示)。 */
  matchedRule?: string;
  /** 评估用时(ms),便于性能监控。 */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Evaluator contract
// ---------------------------------------------------------------------------

export interface AuthorizationEvaluator {
  /** evaluator 标识(写入 decision.source)。 */
  readonly name: AuthorizationSource;
  /** 优先级(数字越大越先评估)。同优先级按注册顺序。 */
  readonly priority: number;
  /** 是否适用于当前请求;不适用返回 null(快速跳过)。 */
  matches(req: AuthorizationRequest): boolean;
  /** 执行评估。返回 null 表示"无法决定",pipeline 继续下一个 evaluator。 */
  evaluate(req: AuthorizationRequest): Promise<AuthorizationDecision | null>;
}

// ---------------------------------------------------------------------------
// Audit integration
// ---------------------------------------------------------------------------

export interface AuditWriter {
  append(entry: AuditDecisionEntry): Promise<void>;
}

export interface AuditDecisionEntry {
  subject?: string;
  action: string;
  resource: string;
  allowed: boolean;
  code: AuthorizationCode;
  source: AuthorizationSource;
  matchedRule?: string;
  reason?: string;
}
