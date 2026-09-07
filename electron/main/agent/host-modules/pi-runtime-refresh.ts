/**
 * host-modules/pi-runtime-refresh.ts — `agentHost.refreshPiExtensions()`.
 *
 * Phase v4 §L-17: extract agent-host.ts:719-726 (~7 行) 到独立 host-module.
 *
 * 当 tool registry 发生变化 (plugin 加载/卸载/profile 重载) 时,
 * `state.piRefreshPromise` 跟踪 piRuntimeCoordinator 的 reloadUntilStable 进度.
 * Renderer 通过 `agentHost.piRefreshPromise` 可以 await 整个 reload 完成.
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 外部依赖通过 install 注入 (state + piRuntimeCoordinator)
 *
 * 设计: 沿用 module-level singleton + install pattern.
 */

import { type AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;
let piRuntimeCoordinatorImpl: { reloadUntilStable: (check: () => number, reason: string) => Promise<void> } | null = null;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallPiRuntimeRefreshDeps {
  state: AgentHostState;
  /** PiRuntimeCoordinator instance */
  piRuntimeCoordinator: { reloadUntilStable: (check: () => number, reason: string) => Promise<void> };
}

export function installPiRuntimeRefresh(deps: InstallPiRuntimeRefreshDeps): void {
  if (deps.state) state = deps.state;
  if (deps.piRuntimeCoordinator) piRuntimeCoordinatorImpl = deps.piRuntimeCoordinator;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetPiRuntimeRefreshForTest(): void {
  state = null;
  piRuntimeCoordinatorImpl = null;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 当 tool registry 改变时 (e.g. plugin profile 重载), 触发 pi-runtime
 * coordinator 重载直到 tool registry revision 稳定.
 * No-op when no session is active.
 *
 * 把 in-flight Promise 写到 `state.piRefreshPromise` 让 renderer 能 await.
 */
export function refreshPiExtensions(): void {
  if (!state) throw new Error("pi-runtime-refresh: not installed");
  if (!piRuntimeCoordinatorImpl) throw new Error("pi-runtime-refresh: piRuntimeCoordinator not installed");
  if (!state.session) return;
  state.piRefreshPromise = piRuntimeCoordinatorImpl
    .reloadUntilStable(() => state!.toolRegistryRevision, "tool-registry")
    .catch((error) => {
      console.warn("[openbuddy] failed to refresh Pi extensions", error);
    });
}
