/**
 * host-modules/hook-permission.ts — Pi hook permission request handler.
 *
 * Phase 8.3 Batch L: 从 agent-host.ts:1732-1764 抽出 (~33 行):
 *   - requestHookPermission — 异步触发 session/permission IPC,等待
 *     用户 allow/allow_always/deny 决议,内部分级决策:
 *       1. sessionRules (session-local allow/deny list)
 *       2. persistentRules (cross-session agentPermissionBridge.readRules)
 *       3. UI dialog via emitRendererEvent("pi://permission")
 *
 * 设计:
 *   - state / emitPluginEvent / emitRendererEvent 通过环形 import 自
 *     ../agent-host
 *   - agentPermissionBridge (P2.1) 从 ../../agent-permission-bridge
 *     (host-core IPC 优先,失败降级到 @openbuddy/auth-permission)
 *   - resolvePermissionAction 直接从 @openbuddy/auth-permission
 *   - any / any 从 ./agent-hooks
 *
 * agent-host.ts 保留 0-arg wrapper (params: title, message, request)
 * 让 configurePiExtensions 内的 confirm binding 无须改动。
 */
import { resolvePermissionAction } from "@openbuddy/auth-permission";
import { agentPermissionBridge } from "../agent-permission-bridge";
type HookPermissionDecision = any;
type HookPermissionRequest = any;

// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { emitPluginEvent, emitRendererEvent, state } from "../agent-host"` (reverse dep)
//   修复后: 通过 installHookPermission() 一次性注入, 本模块零 agent-host 导入.
import { type AgentHostState } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";

/**
 * Permission mode 的运行时语义(「模式即工具策略」的最小实现)。
 *
 * `agent:set-permission-mode` 一直以来只把 mode 写进 settings.json,运行时没有任何
 * 代码读它 —— UI 上切「计划模式 / 完全访问」对工具执行毫无效果(2026-10-12 复查
 * 阶段 1.1 时确认)。这里把两条**可判定的**语义接进权限钩子:
 *   - bypassPermissions("完全访问")→ 一律放行,不再弹窗;
 *   - plan("计划模式")→ 非只读工具强制 ask(allow 规则也不能放行执行类操作)。
 * 其余三档不改现有行为(读写细分需要工具分类矩阵,是后续专项)。
 */
const READONLY_TOOL_RE = /(^|[_:.])(read|glob|grep|search|list|find|snapshot|describe|status|info|usage|history|preview|query|fetch|export)([_:.]|$)/i;

function modeGate(
  mode: string | undefined,
  toolName: string,
  ruleDecision: "allow" | "deny" | "ask" | undefined,
): "allow" | "deny" | "ask" | undefined {
  if (mode === "bypassPermissions") {
    // 完全访问:规则显式 deny 仍然最优先(用户明确写下的拒绝不该被模式吞掉)。
    return ruleDecision === "deny" ? "deny" : "allow";
  }
  if (mode === "plan" && !READONLY_TOOL_RE.test(toolName)) {
    // 计划模式:执行/写类操作必须问,哪怕 allow 规则想放行。
    return "ask";
  }
  // 其余情况保持传入的裁决不变 —— **必须原样返回 ruleDecision**,不能返回
  // undefined:undefined 是"这条规则没有定论"的意思,会把已有的 allow 吞掉
  // (实测:plan 模式下 read 的 allow 规则因此失效,直接掉进弹窗)。
  return ruleDecision;
}

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
  if (deps.state) state = deps.state;
  if (deps.emitPluginEvent) emitPluginEvent = deps.emitPluginEvent;
  if (deps.emitRendererEvent) emitRendererEvent = deps.emitRendererEvent;
}

async function requestHookPermission(title: string, message: string, request?: any): Promise<any> {
  if (!request) return "deny";
  const sessionId = state.session?.sessionId;
  if (!sessionId) return "deny";
  // 当前模式只读一次;briidge 不可用就当没设(保持既有行为)。
  let currentMode: string | undefined;
  try { currentMode = await agentPermissionBridge.readMode(); } catch { currentMode = undefined; }
  // modeGate 对每一层 allow 裁决生效:plan 模式下 allow 规则也不能放行执行类工具。
  const applyMode = (decision: "allow" | "deny" | "ask" | undefined): "allow" | "deny" | "ask" | undefined =>
    decision === "allow" ? modeGate(currentMode, request.toolName, "allow") : decision;
  const sessionDecision = applyMode(resolvePermissionAction(state.hookPermissionSessionRules.get(sessionId) ?? [], request.toolName, request.pattern));
  if (sessionDecision === "deny") return "deny";
  if (sessionDecision === "allow") return "allow";
  const persistentDecision = applyMode(resolvePermissionAction(await agentPermissionBridge.readRules(), request.toolName, request.pattern));
  if (persistentDecision === "deny") return "deny";
  if (persistentDecision === "allow") return "allow";
  // 规则没有定论:模式接管(bypass → 放行;plan + 执行类 → 强制问)。
  const gated = modeGate(currentMode, request.toolName, undefined);
  if (gated === "allow") return "allow";
  if (gated === "ask" && !message) {
    message = `计划模式限制：工具「${request.toolName}」需要确认`;
  }
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

/**
 * 通用 confirm 入口的模式闸(bypass 语义)。返回:
 *   true  —— 当前模式明确放行(bypassPermissions),调用方无需再问;
 *   undefined —— 没有模式层面的定论,调用方走自己的弹窗。
 *
 * 背景:`provide-rpc-ui-context` 的 confirm 是**无条件弹窗**,工具拿到的
 * ctx.ui.confirm 全走它 —— 权限模式对它毫无作用(2026-10-12 真实启动验证
 * 发现 bypassPermissions 下 apply_command 仍弹窗)。
 */
export async function confirmGateAllows(): Promise<boolean | undefined> {
  let mode: string | undefined;
  try { mode = await agentPermissionBridge.readMode(); } catch { return undefined; }
  if (mode === "bypassPermissions") return true;
  return undefined;
}

export {
  requestHookPermission,
};
