/**
 * host-modules/ui-request-resolver.ts — pending UI request 解析域.
 *
 * Phase 8.3 Batch D-17: 提取 agent-host.ts:1943-1981 的
 *   - `resolveUiRequest` (~39 行)
 *
 * resolveUiRequest 是 IPC 端 `agent:ui-request:resolve` 的核心 handler. 当
 * renderer 处理了一个待决的 UI request (permission dialog / question), 它
 * 通过 IPC 调过来, 我们:
 *   1. 查找 state.pendingUiRequests.get(requestId)
 *   2. 如果是 permission + allow_always, 持久化到全局 rules
 *   3. 如果是 permission + allow, 写入 session-scoped rules
 *   4. 提交 request.resolve(value) 让 Pi session 继续
 *   5. emit "session/permission-resolved" / "session/question-resolved"
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 InstallUiRequestResolverDeps 参数注入
 *
 * 设计: 模块级单例 + install pattern.
 */

import { type AgentHostState, type AgentHostUiRequestValue } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

let emitPluginEventImpl: (type: string, payload: unknown) => void = () => undefined;
let permissionReadRulesImpl: () => Promise<any[]> = async () => [];
let permissionWriteRulesImpl: (rules: any[]) => Promise<void> = async () => undefined;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallUiRequestResolverDeps {
  state: AgentHostState;
  emitPluginEvent: (type: string, payload: unknown) => void;
  permissionReadRules: () => Promise<any[]>;
  permissionWriteRules: (rules: any[]) => Promise<void>;
}

/**
 * 一次性 install 所有 ui-request-resolver 依赖.
 */
export function installUiRequestResolver(deps: InstallUiRequestResolverDeps): void {
  if (deps.state) state = deps.state;
  if (deps.emitPluginEvent) emitPluginEventImpl = deps.emitPluginEvent;
  if (deps.permissionReadRules) permissionReadRulesImpl = deps.permissionReadRules;
  if (deps.permissionWriteRules) permissionWriteRulesImpl = deps.permissionWriteRules;
}

/** 测试/调试用: 重置模块级单例. */
export function __resetUiRequestResolverForTest(): void {
  state = null;
  emitPluginEventImpl = () => undefined;
  permissionReadRulesImpl = async () => [];
  permissionWriteRulesImpl = async () => undefined;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 解析一个 pending UI request.
 *
 * @returns true 如果找到并解析, false 如果 requestId 不在 state.pendingUiRequests.
 */
export function resolveUiRequest(requestId: string, value: AgentHostUiRequestValue): boolean {
  if (!state) throw new Error("ui-request-resolver: not installed");
  const request = state.pendingUiRequests.get(requestId);
  if (!request || request.generation !== undefined && request.generation !== state.piGeneration) {
    if (request) state.pendingUiRequests.delete(requestId);
    return false;
  }
  state.pendingUiRequests.delete(requestId);
  if (request.kind === "permission" && request.permission) {
    const decision = value && typeof value === "object" && "decision" in value
      ? (value as any).decision
      : value === true ? "allow" : "deny";
    if (decision === "allow_always") {
      void permissionReadRulesImpl().then((rules) => permissionWriteRulesImpl([
        ...rules,
        { action: "allow", tool: request.permission?.toolName ?? "", ...(request.permission?.pattern ? { pattern: request.permission.pattern } : {}) },
      ])).catch((error: unknown) => console.warn("[openbuddy] failed to persist hook permission", error));
    } else if (decision === "allow") {
      const sessionRules = state.hookPermissionSessionRules.get(request.sessionId) ?? [];
      state.hookPermissionSessionRules.set(request.sessionId, [...sessionRules, {
        action: "allow",
        tool: request.permission.toolName,
        ...(request.permission.pattern ? { pattern: request.permission.pattern } : {}),
      }]);
    }
  }
  const permissionDecision = request.kind === "permission"
    ? value && typeof value === "object" && "decision" in value
      ? (value as any).decision
      : value === true ? "allow" : "deny"
    : undefined;
  emitPluginEventImpl(
    request.kind === "permission" ? "session/permission-resolved" : "session/question-resolved",
    {
      requestId,
      sessionId: request.sessionId,
      answered: value !== undefined,
      ...(typeof value === "boolean" ? { approved: value } : {}),
      ...(permissionDecision ? { approved: permissionDecision !== "deny", decision: permissionDecision } : {}),
      ...(typeof value === "string" ? { answerLength: value.length } : {}),
      ...(value && typeof value === "object" && "answers" in value
        ? { answerCount: Object.keys((value as any).answers).length }
        : {}),
    },
  );
  request.resolve(value);
  return true;
}
