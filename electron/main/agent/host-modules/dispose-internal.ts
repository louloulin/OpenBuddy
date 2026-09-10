/**
 * host-modules/dispose-internal.ts — host lifecycle 清理路径.
 *
 * Phase 8.3 Batch D-16: 提取 agent-host.ts:1883-1970 的
 *   - `disposeInternal` (~89 行)
 *
 * disposeInternal 是 agent host 关闭 / 切换 cwd 时的核心清理路径. 它需要
 * 串行地停止 hooks / profile watchers / dispose piSession / 清空 cordis runtime /
 * dispose subagents / dispose sessionEventLog / 重置 state fields 等.
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 InstallDisposeInternalDeps 参数注入
 *
 * 设计: 沿用 module-level singleton + install pattern — 与 plugin-mutations,
 * profile-reload-transaction, session-rebind 等保持一致.
 */

import { type AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

let emitPluginEventImpl: (type: string, payload: unknown) => void = () => undefined;
let piSessionRuntimeDisposeImpl: () => Promise<void> = async () => undefined;
let stopProfileWatchersImpl: () => void = () => undefined;
let disposeProfileTypertRegistrationsImpl: (values: Iterable<unknown>) => void = () => undefined;
let disposeActiveHookProcessesImpl: () => void = () => undefined;
let drainActiveHookProcessesImpl: () => Promise<void> = async () => undefined;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallDisposeInternalDeps {
  state: AgentHostState;
  emitPluginEvent: (type: string, payload: unknown) => void;
  piSessionRuntimeDispose: () => Promise<void>;
  stopProfileWatchers: () => void;
  disposeProfileTypertRegistrations: (values: Iterable<unknown>) => void;
  disposeActiveHookProcesses: () => void;
  drainActiveHookProcesses: () => Promise<void>;
}

/**
 * 一次性 install 所有 dispose-internal 依赖.
 */
export function installDisposeInternal(deps: InstallDisposeInternalDeps): void {
  if (deps.state) state = deps.state;
  if (deps.emitPluginEvent) emitPluginEventImpl = deps.emitPluginEvent;
  if (deps.piSessionRuntimeDispose) piSessionRuntimeDisposeImpl = deps.piSessionRuntimeDispose;
  if (deps.stopProfileWatchers) stopProfileWatchersImpl = deps.stopProfileWatchers;
  if (deps.disposeProfileTypertRegistrations) disposeProfileTypertRegistrationsImpl = deps.disposeProfileTypertRegistrations;
  if (deps.disposeActiveHookProcesses) disposeActiveHookProcessesImpl = deps.disposeActiveHookProcesses;
  if (deps.drainActiveHookProcesses) drainActiveHookProcessesImpl = deps.drainActiveHookProcesses;
}

/** 测试/调试用: 重置模块级单例. */
export function __resetDisposeInternalForTest(): void {
  state = null;
  emitPluginEventImpl = () => undefined;
  piSessionRuntimeDisposeImpl = async () => undefined;
  stopProfileWatchersImpl = () => undefined;
  disposeProfileTypertRegistrationsImpl = () => undefined;
  disposeActiveHookProcessesImpl = () => undefined;
  drainActiveHookProcessesImpl = async () => undefined;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 清理 agent host 全部 host-scoped state.
 *
 * 触发场景:
 *   - 显式 dispose() (quit / reload)
 *   - initialize() 检测到 cwd 变更 → 旧 session 必须先 dispose
 *   - initialize({ force: true })
 *
 * 顺序很关键:
 *   1. 停 hook processes (避免后续 state 变更触发新 hooks)
 *   2. emit pi/dispose / session/dispose 事件 (通知 listener)
 *   3. dispose pi session (释放 AgentSession 持有的 JSONL file lock)
 *   4. 停 profile watchers + 等 profileReloadPromise
 *   5. 解绑 event bridges (capabilityEventBridge / typertRegistry)
 *   6. 清空 remote dispatcher
 *   7. dispose preset runtime (释放 preset-owned tools)
 *   8. 清空 profile artifacts (typert registrations)
 *   9. dispose plugin loader + terminal runtime + subprocess runtime
 *  10. dispose deepSeek cordis runtime + clear snapshot
 *  11. flush session event log + clear all session-state maps
 *  12. 重置所有 state fields 为初始值 (state 保持引用, 内容清空)
 *  13. abort 全部 continuable subagents + dispose deepseek agents
 *  14. 取消所有 pending UI requests (resolve undefined 让 renderer 解锁)
 */
export async function disposeInternal(): Promise<void> {
  if (!state) throw new Error("dispose-internal: not installed");

  disposeActiveHookProcessesImpl();
  await drainActiveHookProcessesImpl();
  // Stage G-1c: openbuddy-automation removed; nothing to stop here.
  // pi-background-tasks disposes itself with the pi session.
  const session = state.session;
  // 注意: piSessionRuntimeDisposeImpl 必须在 session 守卫之外调用 — 之前的版本
  // 只在 session 非空时 dispose, 当 __runInitialize 半成功 (create 完但 state.session
  // 赋值前抛错) 会让 piSessionRuntime.current 残留, 下一次 init 的 create() 会抛
  // "pi-session-runtime: session is already active". dispose() 自身就是
  // null-safe: piSessionRuntime.dispose() 检测 current 为 null 就 early-return.
  try {
    if (session) {
      state.context?.emit("pi/dispose", { sessionId: session.sessionId });
      emitPluginEventImpl("session/dispose", { sessionId: session.sessionId });
    }
    await piSessionRuntimeDisposeImpl();
  } catch (error) {
    console.warn("[openbuddy] abort on dispose failed", error);
  }
  stopProfileWatchersImpl();
  await state.profileReloadPromise.catch(() => undefined);
  state.capabilityEventBridgeUnsubscribe?.();
  state.capabilityEventBridgeUnsubscribe = null;
  state.typertRegistryUnsubscribe?.();
  state.typertRegistryUnsubscribe = null;
  state.remoteDispatcher.clear();
  await state.presetSessionRuntime?.dispose().catch((error: unknown) => {
    console.warn("[openbuddy] preset runtime dispose failed", error);
  });
  state.presetSessionRuntime = null;
  state.profileRemoteContributions.clear();
  disposeProfileTypertRegistrationsImpl(state.profileTypertContributions.values());
  state.profileTypertContributions.clear();
  await state.loader?.dispose();
  await state.terminalRuntime?.dispose();
  state.terminalRuntime = null;
  await state.subprocessRuntime?.dispose();
  state.subprocessRuntime = null;
  await state.deepSeekCordisRuntime?.dispose();
  state.deepSeekCordisRuntime = null;
  state.deepSeekCordisSnapshot = null;
  await state.sessionEventLog?.flush();
  state.sessionUnsubscribe?.();
  state.sessionUnsubscribe = null;
  state.loader = null;
  state.sessionEventLog?.clear();
  state.eventSequence = 0;
  state.sessionSequences.clear();
  state.sessionEventLog = null;
  state.context = null;
  state.session = null;
  state.queueMirror = null;
  state.cwd = null;
  state.model = undefined;
  state.pluginState = null;
  state.pluginCommitGeneration = 0;
  state.lastPluginCommitTransactionId = undefined;
  state.lastPluginCommitMarker = undefined;
  state.modelRuntime = null;
  state.piResourceLoader = null;
  state.piMarketplaceResourcePaths.extensions = [];
  state.piMarketplaceResourcePaths.skills = [];
  state.piMarketplaceResourcePaths.prompts = [];
  state.piMarketplaceResourcePaths.themes = [];
  state.piMarketplaceAgentFiles = [];
  state.hookConfigs = [];
  state.piRefreshPromise = Promise.resolve();
  state.profileOptions = null;
  state.profileBundle = null;
  state.profilePackageJson = undefined;
  state.profilePackagePaths = [];
  state.baseProfile = null;
  state.activePluginProfile = null;
  state.storedLayers = [];
  state.profileReloadPromise = Promise.resolve();
  state.userExtensionResult = null;
  state.dshCoreExtensionResult = null;
  state.pluginReadiness = { phase: "idle", generation: 0 };
  state.runningTasks.clear();
  state.jobsRegistry.clear();
  for (const child of state.continuableSubagents.values()) {
    child.controller.abort();
    void child.session.abort().catch(() => undefined);
    child.unsubscribe();
    child.session.dispose();
  }
  await Promise.allSettled([...state.deepSeekAgents.values()].map((agent: any) => agent.dispose()));
  state.deepSeekAgents.clear();
  state.continuableSubagents.clear();
  state.hookPermissionSessionRules.clear();
  for (const request of state.pendingUiRequests.values()) request.resolve(undefined);
  state.pendingUiRequests.clear();
  state.extensionEditorText.clear();
  state.extensionToolsExpanded.clear();
}
