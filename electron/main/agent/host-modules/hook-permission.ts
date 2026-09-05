/**
 * host-modules/hook-permission.ts — Pi hook permission request handler.
 *
 * Phase 8.3 Batch L: 从 agent-host.ts:1732-1764 抽出 (~33 行):
 *   - requestHookPermission — 异步触发 session/permission IPC,等待
 *     用户 allow/allow_always/deny 决议,内部分级决策:
 *       1. sessionRules (session-local allow/deny list)
 *       2. persistentRules (cross-session permissionHandlers.readRules)
 *       3. UI dialog via emitRendererEvent("pi://permission")
 *
 * 设计:
 *   - state / emitPluginEvent / emitRendererEvent 通过环形 import 自
 *     ../agent-host
 *   - permissionHandlers / resolvePermissionAction 直接从
 *     @openbuddy/auth-permission
 *   - any / any 从 ./agent-hooks
 *
 * agent-host.ts 保留 0-arg wrapper (params: title, message, request)
 * 让 configurePiExtensions 内的 confirm binding 无须改动。
 */
import { permissionHandlers, resolvePermissionAction } from "@openbuddy/auth-permission";
type HookPermissionDecision = any;
type HookPermissionRequest = any;

// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { emitPluginEvent, emitRendererEvent, state } from "../agent-host"` (reverse dep)
//   修复后: 通过 installHookPermission() 一次性注入, 本模块零 agent-host 导入.
import { type AgentHostState } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";

let state: AgentHostState = createDefaultAgentHostState();
let emitPluginEvent: (type: string, payload: unknown) => void;
let emitRendererEvent: (channel: string, payload: unknown) => void;

/**
 * Bind the hook-permission module's dependencies. Called once from
 * agent-host.ts:initialize() so this module never imports agent-host.
 * Idempotent.
 */
export function installHookPermission(deps: {
  state: AgentHostState;
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
}): void {
  state = deps.state;
  emitPluginEvent = deps.emitPluginEvent;
  emitRendererEvent = deps.emitRendererEvent;
}

async function requestHookPermission(title: string, message: string, request?: any): Promise<any> {
  if (!request) return "deny";
  const sessionId = state.session?.sessionId;
  if (!sessionId) return "deny";
  const sessionRules = state.hookPermissionSessionRules.get(sessionId) ?? [];
  const sessionDecision = resolvePermissionAction(sessionRules, request.toolName, request.pattern);
  if (sessionDecision === "deny") return "deny";
  if (sessionDecision === "allow") return "allow";
  const persistentDecision = resolvePermissionAction(await permissionHandlers.readRules(), request.toolName, request.pattern);
  if (persistentDecision === "deny") return "deny";
  if (persistentDecision === "allow") return "allow";
  return new Promise<any>((resolvePromise) => {
    const requestId = `${sessionId}:hook-permission:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    state.pendingUiRequests.set(requestId, {
      kind: "permission",
      sessionId,
      permission: request,
      resolve: (value) => {
        if (value && typeof value === "object" && "decision" in value) resolvePromise(value.decision as any);
        else resolvePromise(value === true ? "allow" : "deny");
      },
    });
    emitPluginEvent("session/permission", { requestId, sessionId, title, hasMessage: Boolean(message), source: "hook", toolName: request.toolName, optionCount: 3 });
    emitRendererEvent("pi://permission", {
      requestId, sessionId, toolCallId: "", title, message, source: "hook", toolKind: request.toolName,
      options: [
        { optionId: "allow", kind: "allow", title: message || title },
        { optionId: "allow_always", kind: "allow_always", title: "始终允许此 Hook" },
        { optionId: "deny", kind: "deny", title: "拒绝" },
      ],
    });
  });
}

export {
  requestHookPermission,
};
