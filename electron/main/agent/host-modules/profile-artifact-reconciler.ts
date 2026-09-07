/**
 * host-modules/profile-artifact-reconciler.ts — profile artifact reconciler 域.
 *
 * Phase 8.3 Batch D-18: 提取 agent-host.ts 中的 5 个 profile artifact 函数
 *   - `discoverProfileRemoteContributions` (~34 行, agent-host.ts:972-1005)
 *   - `discoverProfileTypertContributions` (~24 行, agent-host.ts:1010-1033)
 *   - `clearProfileArtifacts` (~6 行, agent-host.ts:1034-1039)
 *   - `installProfileArtifacts` (~38 行, agent-host.ts:1041-1078)
 *   - `reconcileProfileArtifacts` (~38 行, agent-host.ts:1080-1117)
 *
 * 这五个函数共同构成 "profile artifact reconciler" 域: 从 profile package
 * 生成 remote / typert contributions, 然后在 typert registry 与
 * remote dispatcher 中以事务方式 install, 失败时回滚到 previous 注册.
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 InstallProfileArtifactReconcilerDeps 参数注入
 *
 * 设计: 模块级单例 + install pattern.
 */

import { type AgentHostState } from "./_state-shape";
import { disposeProfileTypertRegistrations } from "./profile/contributions-pure";
import type { RemoteContribution } from "../../harness/remote-dispatch";
import type { TypertHostContribution } from "@openbuddy/plugin-host";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

let emitPluginEventImpl: (type: string, payload: unknown) => void = () => undefined;
let discoverRemoteImpl: () => Promise<Map<string, RemoteContribution>> = async () => new Map();
let discoverTypertImpl: () => Promise<Map<string, TypertHostContribution>> = async () => new Map();
let serializeRemoteImpl: (contribution: any) => RemoteContribution = (c) => c;
let remoteServiceContextImpl: () => any = () => ({});

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallProfileArtifactReconcilerDeps {
  state: AgentHostState;
  emitPluginEvent: (type: string, payload: unknown) => void;
  /** discoverProfileRemoteContributions — full profile scan. Optional: defaults to no-op. */
  discoverRemote?: () => Promise<Map<string, RemoteContribution>>;
  /** discoverProfileTypertContributions — full profile scan. Optional: defaults to no-op. */
  discoverTypert?: () => Promise<Map<string, TypertHostContribution>>;
  /** serializeRemoteContribution helper from plugin-host. Optional: defaults to identity. */
  serializeRemote?: (contribution: any) => RemoteContribution;
  /** remoteServiceContext() — closure with current state. Optional: defaults to empty. */
  remoteServiceContext?: () => any;
}

/**
 * 一次性 install 所有 profile-artifact-reconciler 依赖.
 *
 * 修复: 之前要求所有 deps 必填, 但 `discoverRemote` 实际上就是本模块导出的
 * `discoverProfileRemoteContributions` (会再 delegate 回 `discoverRemoteImpl`),
 * 形成 chicken-and-egg, 调用方忘了传 → 第二次跑就 throw `is not a function`.
 * 现在把不常用的 deps 全部 optional, 默认值从 __reset...ForTest 复用, 让
 * 不调用 reconciler 的 code path (e.g. smoke test 的 agent:init) 也能干净跑通.
 */
export function installProfileArtifactReconciler(deps: InstallProfileArtifactReconcilerDeps): void {
  state = deps.state;
  emitPluginEventImpl = deps.emitPluginEvent;
  if (deps.discoverRemote) discoverRemoteImpl = deps.discoverRemote;
  if (deps.discoverTypert) discoverTypertImpl = deps.discoverTypert;
  if (deps.serializeRemote) serializeRemoteImpl = deps.serializeRemote;
  if (deps.remoteServiceContext) remoteServiceContextImpl = deps.remoteServiceContext;
}

/** 测试/调试用: 重置模块级单例. */
export function __resetProfileArtifactReconcilerForTest(): void {
  state = null;
  emitPluginEventImpl = () => undefined;
  discoverRemoteImpl = async () => new Map();
  discoverTypertImpl = async () => new Map();
  serializeRemoteImpl = (c: any) => c;
  remoteServiceContextImpl = () => ({});
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 全量扫描 profile, 发现 remote contributions.
 * 包含 profile packages + auto-discovered packages + resolved extensions.
 */
export async function discoverProfileRemoteContributions(): Promise<Map<string, RemoteContribution>> {
  if (!state) throw new Error("profile-artifact-reconciler: not installed");
  return discoverRemoteImpl();
}

/**
 * 全量扫描 profile, 发现 typert contributions.
 */
export async function discoverProfileTypertContributions(): Promise<Map<string, TypertHostContribution>> {
  if (!state) throw new Error("profile-artifact-reconciler: not installed");
  return discoverTypertImpl();
}

/**
 * 清空当前 profile artifact 注册 (typert registry + remote dispatcher).
 */
export function clearProfileArtifacts(): void {
  if (!state) throw new Error("profile-artifact-reconciler: not installed");
  disposeProfileTypertRegistrations(state.profileTypertContributions.values());
  state.profileTypertContributions.clear();
  for (const packageName of state.profileRemoteContributions.keys()) {
    state.remoteDispatcher.unregister(packageName);
  }
  state.profileRemoteContributions.clear();
}

/**
 * 把 nextRemote + nextTypert 安装到 typert registry + remote dispatcher.
 *
 * 失败时回滚: dispose 已注册的 typert registrations + unregister remote packages.
 */
export function installProfileArtifacts(
  remoteContributions: Map<string, RemoteContribution>,
  typertContributions: Map<string, TypertHostContribution>,
): void {
  if (!state) throw new Error("profile-artifact-reconciler: not installed");
  const typert = state.context?.get("typert") as { register?: (contribution: unknown) => () => void } | undefined;
  if (!typert?.register && typertContributions.size > 0) {
    throw new Error("openbuddy-typert: registry is unavailable");
  }

  const installedRemote = new Map<string, RemoteContribution>();
  const installedTypert = new Map<string, { contribution: TypertHostContribution; dispose: () => void; remoteDispose?: () => void }>();
  try {
    for (const contribution of remoteContributions.values()) {
      // Track the package BEFORE the register call so a thrown error still
      // leaves a record we can roll back. unregister() is idempotent for
      // packages that never made it to the dispatcher, so this stays safe
      // even if the side effect didn't actually run.
      installedRemote.set(contribution.package, contribution);
      state.remoteDispatcher.register(contribution, remoteServiceContextImpl());
    }
    if (typert?.register) {
      for (const contribution of typertContributions.values()) {
        const remote = remoteContributions.get(contribution.package);
        let remoteDispose: (() => void) | undefined;
        if (!remote && contribution.invocations.length > 0) {
          const generated = serializeRemoteImpl({
            package: contribution.package,
            descriptors: contribution.invocations,
          }) as RemoteContribution;
          installedRemote.set(contribution.package, generated);
          state.remoteDispatcher.register(generated, remoteServiceContextImpl());
          remoteDispose = () => {
            state!.remoteDispatcher.unregister(contribution.package);
          };
        }
        installedTypert.set(contribution.package, {
          contribution,
          dispose: typert.register(contribution) as () => void,
          remoteDispose,
        });
      }
    }
  } catch (error) {
    disposeProfileTypertRegistrations(installedTypert.values());
    for (const packageName of installedRemote.keys()) {
      state.remoteDispatcher.unregister(packageName);
    }
    throw error;
  }
  state.profileRemoteContributions = installedRemote;
  state.profileTypertContributions = installedTypert;
}

/**
 * Reconcile profile artifacts:
 *   1. Increment generation + clear renderer manifest cache
 *   2. Subscribe typert registry changes (once)
 *   3. Discover next remote + typert contributions in parallel
 *   4. Run install within typert.beginTransaction()
 *   5. On failure, rollback to previous registrations
 *
 * Returns: void
 *
 * 触发场景:
 *   - profile 重新加载 (scheduleProfileReload 调用)
 *   - 用户手动触发 (插件面板)
 */
export async function reconcileProfileArtifacts(): Promise<void> {
  if (!state) throw new Error("profile-artifact-reconciler: not installed");
  state.profileArtifactGeneration += 1;
  state.rendererPluginManifestCache = null;
  const typert = state.context?.get("typert") as {
    register?: (contribution: unknown) => () => void;
    subscribe?: (listener: (change: unknown) => void) => () => void;
    beginTransaction?: () => { commit: () => void; rollback: () => void };
  } | undefined;
  if (typert?.subscribe && !state.typertRegistryUnsubscribe) {
    state.typertRegistryUnsubscribe = typert.subscribe((change) => {
      emitPluginEventImpl("typert/registry-changed", change);
    });
  }
  // Single try/catch so discover-time failures and install-time failures
  // share the same rollback path. The previous maps are always snapshotted
  // before any mutation. On rollback, we re-install the snapshot; if the
  // previous maps are already mounted (discover-failure case) the rollback
  // is effectively a defensive re-install that detects dispatcher-level
  // state corruption early instead of silently leaving the registry out of
  // sync.
  const transaction = typert?.beginTransaction?.();
  const previousRemote = new Map(state.profileRemoteContributions);
  const previousTypert = new Map(state.profileTypertContributions);
  try {
    const [nextRemote, nextTypert] = await Promise.all([
      discoverRemoteImpl(),
      discoverTypertImpl(),
    ]);
    clearProfileArtifacts();
    installProfileArtifacts(nextRemote, nextTypert);
    transaction?.commit();
  } catch (error) {
    try {
      clearProfileArtifacts();
      installProfileArtifacts(
        previousRemote,
        new Map([...previousTypert].map(([packageName, entry]) => [packageName, entry.contribution])),
      );
      transaction?.rollback();
    } catch (rollbackError) {
      transaction?.rollback();
      throw new AggregateError([error, rollbackError], "openbuddy-profile: artifact reconciliation and rollback failed");
    }
    throw error;
  }
}
