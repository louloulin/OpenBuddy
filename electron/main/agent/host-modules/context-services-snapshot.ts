/**
 * host-modules/context-services-snapshot.ts — context.provide 的 reloadable 服务快照.
 *
 * Phase v4 §L-14: extract agent-host.ts:826-836 (~12 行) 到独立 host-module.
 *
 * profile reload 时 (transaction 模式), Cordis context 上的某些 services 会被
 * 替换 (DSH capability services + workspaceRegistry). profile-reload-transaction
 * 需要在 reload 前快照这些 services, reload 后 (如果新 profile 没注册对应 service)
 * 还原回去 — 让 renderer 的 IPC 调用在 reload 期间不会丢服务.
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - capture/restore 通过 install 注入 (state + 两个 deepseek impls)
 *
 * 设计: 沿用 module-level singleton + install pattern.
 */

import { type AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;
let captureDeepSeekCapabilityServicesImpl: () => Map<string, unknown> = () => new Map();
let restoreDeepSeekCapabilityServicesImpl: (captured?: Map<string, unknown>) => Promise<void> = async () => undefined;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallContextServicesSnapshotDeps {
  state: AgentHostState;
  /** deepseek/cordis-runtime.captureDeepSeekCapabilityServices */
  captureDeepSeekCapabilityServices: () => Map<string, unknown>;
  /** deepseek/cordis-runtime.restoreDeepSeekCapabilityServices */
  restoreDeepSeekCapabilityServices: (captured?: Map<string, unknown>) => Promise<void>;
}

export function installContextServicesSnapshot(deps: InstallContextServicesSnapshotDeps): void {
  state = deps.state;
  captureDeepSeekCapabilityServicesImpl = deps.captureDeepSeekCapabilityServices;
  restoreDeepSeekCapabilityServicesImpl = deps.restoreDeepSeekCapabilityServices;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetContextServicesSnapshotForTest(): void {
  state = null;
  captureDeepSeekCapabilityServicesImpl = () => new Map();
  restoreDeepSeekCapabilityServicesImpl = async () => undefined;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 快照 reloadable context services (DSH capability + workspaceRegistry).
 * profile reload 之前调用, restore 之后再调用.
 */
export function captureReloadableContextServices(): Map<string, unknown> {
  if (!state) throw new Error("context-services-snapshot: not installed");
  const captured = captureDeepSeekCapabilityServicesImpl();
  const workspaceRegistry = state.context?.get("workspaceRegistry");
  if (workspaceRegistry !== undefined) captured.set("workspaceRegistry", workspaceRegistry);
  return captured;
}

/**
 * 把之前快照的 services 还原到 Cordis context, 只在当前 context 没这个 key 时
 * 才 set (避免覆盖 reload 后的新实现).
 */
export function restoreCapturedContextServices(captured: Map<string, unknown>): void {
  if (!state) throw new Error("context-services-snapshot: not installed");
  if (!state.context) return;
  for (const [serviceKey, service] of captured) {
    if (state.context.get(serviceKey) === undefined) state.context.set(serviceKey, service);
  }
}

/**
 * Helper: 在 profile reload 完成后, async 还原 DSH capability services
 * (用 capture 时的同一份 snapshot). 这是 captureDeepSeekCapabilityServices
 * 的对称操作, profile-reload-transaction 调用.
 */
export async function restoreDeepSeekCapabilityServices(captured?: Map<string, unknown>): Promise<void> {
  return restoreDeepSeekCapabilityServicesImpl(captured);
}
