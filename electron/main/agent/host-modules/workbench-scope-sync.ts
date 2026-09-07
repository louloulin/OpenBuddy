/**
 * host-modules/workbench-scope-sync.ts — Casdoor workbench scope 同步域.
 *
 * Phase 8.3 Batch D-17: 提取 agent-host.ts 中的 syncWorkbenchScope (~16 行).
 *
 * syncWorkbenchScope 是 workbench scope 同步域的核心. 它在以下时机被调用:
 *   - 启动初始化后 (initialize 完成)
 *   - casdoor auth 状态变化 (登录 / 登出 / 切换 tenant)
 *   - 用户手动触发
 *
 * 设计: Casdoor status + state.scopeKey + 单一 renderer event "openbuddy://workbench-scope"
 * 三个状态组合. 幂等: scopeKey 未变则 no-op.
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 InstallWorkbenchScopeSyncDeps 参数注入
 *
 * 设计: 模块级单例 + install pattern.
 */

import { type AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

let emitRendererEventImpl: (channel: string, payload: unknown) => void = () => undefined;
let casdoorStatusImpl: () => any = () => ({
  config: { configured: false },
  tenantContext: { activeTenantId: null },
  identity: null,
});

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallWorkbenchScopeSyncDeps {
  state: AgentHostState;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  casdoorStatus: () => any;
}

/**
 * 一次性 install 所有 workbench-scope-sync 依赖.
 */
export function installWorkbenchScopeSync(deps: InstallWorkbenchScopeSyncDeps): void {
  state = deps.state;
  emitRendererEventImpl = deps.emitRendererEvent;
  casdoorStatusImpl = deps.casdoorStatus;
}

/** 测试/调试用: 重置模块级单例. */
export function __resetWorkbenchScopeSyncForTest(): void {
  state = null;
  emitRendererEventImpl = () => undefined;
  casdoorStatusImpl = () => ({
    config: { configured: false },
    tenantContext: { activeTenantId: null },
    identity: null,
  });
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 同步当前 Casdoor workbench scope 到 state.scopeKey + env + renderer.
 *
 * 幂等: scopeKey 与 desiredScope 一致且 force=false 时, 直接返回.
 *
 * 注: 当 Casdoor 未配置时, status.config.configured = false, scope 为
 *     "local:none:anonymous" — 这是合法状态, 仍会写入 env (renderer 监听
 *     "openbuddy://workbench-scope" 即可).
 */
export async function syncWorkbenchScope(force = false): Promise<void> {
  if (!state) throw new Error("workbench-scope-sync: not installed");
  // Minimal real implementation: derive the current Casdoor workbench scope,
  // skip work when nothing changed, and publish a renderer event so the UI
  // can react to scope switches without depending on casdoor branch helpers.
  try {
    const status = casdoorStatusImpl();
    const desiredScope = `${status.config.configured ? "configured" : "local"}:${status.tenantContext.activeTenantId ?? "none"}:${status.identity?.subject ?? "anonymous"}`;
    if (!force && state.scopeKey === desiredScope) return;
    state.scopeKey = desiredScope;
    process.env.OPENBUDDY_WORKBENCH_SCOPE = desiredScope;
    emitRendererEventImpl("openbuddy://workbench-scope", {
      scope: desiredScope,
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[openbuddy] syncWorkbenchScope failed", error);
  }
}
