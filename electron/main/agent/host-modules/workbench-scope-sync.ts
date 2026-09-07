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
 * 设计: 模块级单例 + install pattern + module-load 时 register defaults.
 *
 * Module-load 时, agent-host.ts 会调用 registerDefaultXxx() 把默认依赖
 * 注入到 globalThis-keyed slots. 这解决了 ESM 双实例化 (vitest 在动态
 * import + ESM 模块图下, 不同 import 站点可能拿到不同的 module 实例,
 * 导致 module-level let 不共享) — globalThis 是 Node.js 唯一稳定的单例.
 *
 * 调用顺序:
 *   1. agent-host.ts module-load: registerDefaultRendererEventEmitter / registerDefaultState /
 *      registerDefaultCasdoorStatus  (用 globalThis 桥接)
 *   2. installMicrokernelHost 真正运行: installWorkbenchScopeSync({...}) 覆盖
 *   3. syncWorkbenchScope 被 facade 调用 — 任意阶段都不抛 (除非完全没 register)
 */

import { type AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern + globalThis-keyed defaults)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

type OpenBuddyEmitFn = (channel: string, payload: unknown) => void;
type CasdoorStatusFn = () => any;

// 用 globalThis 而非 module-level 变量: vitest 在某些场景下 (动态 import + ESM
// 模块图) 会让 agent-host.ts 和 workbench-scope-sync.ts 拿到不同的 module
// 实例, 导致 module-level let 不共享. globalThis 是 Node.js 唯一稳定的单例
// 跨 module 实例共享机制, 所以 emit / state / casdoor 状态走 globalThis.
const GLOBAL_KEYS = {
  emit: "__openbuddyRendererEmit__",
  state: "__openbuddyWorkbenchScopeState__",
  casdoorStatus: "__openbuddyWorkbenchScopeCasdoorStatus__",
} as const;

function getGlobalEmit(): OpenBuddyEmitFn | null {
  const g = globalThis as unknown as Record<string, OpenBuddyEmitFn | undefined>;
  return g[GLOBAL_KEYS.emit] ?? null;
}
function getGlobalState(): AgentHostState | null {
  const g = globalThis as unknown as Record<string, AgentHostState | undefined>;
  return g[GLOBAL_KEYS.state] ?? null;
}
function getGlobalCasdoorStatus(): CasdoorStatusFn | null {
  const g = globalThis as unknown as Record<string, CasdoorStatusFn | undefined>;
  return g[GLOBAL_KEYS.casdoorStatus] ?? null;
}
function emitRendererEventImpl(channel: string, payload: unknown): void {
  const emit = getGlobalEmit();
  if (emit) emit(channel, payload);
}

// 由 agent-host.ts module-load 调用, 把它的 emitRendererEvent 桥接过来.
export function __registerDefaultRendererEventEmitter(emit: OpenBuddyEmitFn): void {
  const g = globalThis as unknown as Record<string, OpenBuddyEmitFn>;
  g[GLOBAL_KEYS.emit] = emit;
}
export function __registerDefaultState(s: AgentHostState): void {
  const g = globalThis as unknown as Record<string, AgentHostState>;
  g[GLOBAL_KEYS.state] = s;
}
export function __registerDefaultCasdoorStatus(fn: CasdoorStatusFn): void {
  const g = globalThis as unknown as Record<string, CasdoorStatusFn>;
  g[GLOBAL_KEYS.casdoorStatus] = fn;
}

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
  __registerDefaultState(deps.state);
  __registerDefaultRendererEventEmitter(deps.emitRendererEvent);
  __registerDefaultCasdoorStatus(deps.casdoorStatus);
}

/** 测试/调试用: 重置模块级单例. */
export function __resetWorkbenchScopeSyncForTest(): void {
  state = null;
  const g = globalThis as unknown as Record<string, unknown>;
  delete g[GLOBAL_KEYS.emit];
  delete g[GLOBAL_KEYS.state];
  delete g[GLOBAL_KEYS.casdoorStatus];
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 同步当前 Casdoor workbench scope 到 state.scopeKey + env + renderer.
 *
 * 幂等: scopeKey 与 desiredScope 一致且 force=false 时, 直接返回.
 *
 * Module-load 阶段 (installMicrokernelHost 还未跑) 会用 agent-host.ts
 * registerDefaultXxx() 注册的默认依赖. 完全未注册时 throw.
 *
 * 注: 当 Casdoor 未配置时, status.config.configured = false, scope 为
 *     "local:none:anonymous" — 这是合法状态, 仍会写入 env (renderer 监听
 *     "openbuddy://workbench-scope" 即可).
 */
export async function syncWorkbenchScope(force = false): Promise<void> {
  // 解析 state: 优先 module-level (install 后) > globalThis (registerDefault 后)
  const resolvedState = state ?? getGlobalState();
  if (!resolvedState) {
    throw new Error(
      "[openbuddy] syncWorkbenchScope called but workbench-scope-sync is not installed. " +
        "Call installWorkbenchScopeSync() (via installMicrokernelHost) or " +
        "register the default deps from agent-host.ts module-load.",
    );
  }

  const resolvedCasdoorStatus = getGlobalCasdoorStatus();
  if (!resolvedCasdoorStatus) {
    throw new Error(
      "[openbuddy] syncWorkbenchScope: no casdoorStatus registered. " +
        "Call installWorkbenchScopeSync() or __registerDefaultCasdoorStatus().",
    );
  }

  try {
    const status = resolvedCasdoorStatus();
    const desiredScope = `${status.config.configured ? "configured" : "local"}:${status.tenantContext.activeTenantId ?? "none"}:${status.identity?.subject ?? "anonymous"}`;
    if (!force && resolvedState.scopeKey === desiredScope) return;
    resolvedState.scopeKey = desiredScope;
    process.env.OPENBUDDY_WORKBENCH_SCOPE = desiredScope;
    emitRendererEventImpl("openbuddy://workbench-scope", {
      scope: desiredScope,
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[openbuddy] syncWorkbenchScope failed", error);
  }
}
