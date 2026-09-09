/**
 * host-modules/profile-reload-transaction.ts — profile-reload 事务核心.
 *
 * Phase 8.3 Batch D-12: 提取 agent-host.ts 中两个互相耦合的函数
 *   - `scheduleProfileReload` (~103 行, agent-host.ts:991-1092)
 *   - `rollbackPiProfile` (~17 行, agent-host.ts:974-989)
 *
 * 它们都围绕 "profile reload 事务" 这一概念: 当 profile 文件发生变化
 * 时, 需要 (1) 抓取当前状态快照; (2) 重新物化 profile; (3) 同步 cordis;
 * (4) reconcile artifacts; (5) reload Pi/MCP; (6) 等待 renderer ack; (7)
 * 失败时回滚到快照。
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 installProfileReloadTransaction() 注入
 *   - 测试时直接 install mock helper, 无需 mock 整个 agent-host 副作用链
 *
 * 设计: 沿用 plugin-mutations.ts 的 install pattern — 模块级单例变量,
 * 初始为 no-op stub, 在 installProfileReloadTransaction() 中被替换。
 *
 * 依赖方向:
 *   - profile/snapshot.ts        (PiProfileSnapshot)
 *   - workbench-scope.ts         (capture/restoreDeepSeekCapabilityServices)
 *   - deepseek/cordis-runtime.ts (syncDeepSeekCordisRuntime / deepSeekCoreRuntimeEntries)
 *   - mcp-runtime.ts             (reloadMcp)
 *   - plugin-lifecycle.ts        (PluginLifecycleQueue / markPluginTransactionRolledBack)
 *   - @openbuddy/plugin-host     (composePluginPatches / materializeOpenBuddyProfile)
 *   - @openbuddy/bundle-base     (createOpenBuddyProfile)
 *
 * 与 plugin-mutations.ts 的关系: plugin-mutations 仍然需要注入
 * scheduleProfileReload / rollbackPiProfile 作为依赖, 因为它的
 * `reloadProfile` 调用前者, `reloadPiExtensionsInternal` 在 catch 中
 * 调用后者 — 这是有意保留的小耦合, 保证失败路径与 reload 同源。
 */

import { type AgentHostState } from "./_state-shape";
import { type PiProfileSnapshot } from "./profile/snapshot";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** watcher 触发 profile reload 的 debounce 延迟 (毫秒). */
export const RELOAD_DEBOUNCE_MS = 100;

/** 等 renderer ack receipt 的最大等待时间 (毫秒). */
export const RENDERER_RECEIPT_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;
let pluginLifecycleQueue: {
  enqueue: <T>(
    kind: string,
    target: string,
    operation: (transaction: any) => Promise<T>,
  ) => Promise<T>;
} | null = null;
let piRuntimeCoordinator: { reload: (reason: string) => Promise<void> } | null = null;
let emitPluginEvent: (type: string, payload: unknown) => void = () => undefined;

let capturePiProfileSnapshotImpl: () => PiProfileSnapshot = () => {
  throw new Error("profile-reload-transaction: installProfileReloadTransaction() not called");
};
let restorePiProfileSnapshotImpl: (snapshot: PiProfileSnapshot) => void = () => undefined;
let captureReloadableContextServicesImpl: () => Map<string, unknown> = () => new Map();
let restoreCapturedContextServicesImpl: (captured: Map<string, unknown>) => void = () => undefined;
let captureDeepSeekCapabilityServicesImpl: () => Map<string, unknown> = () => new Map();
let restoreDeepSeekCapabilityServicesImpl: (
  captured?: Map<string, unknown>,
) => Promise<void> = async () => undefined;
let materializeOpenBuddyProfileImpl: (options: any) => Promise<{
  profile: any;
  bundle: any;
}> = async () => {
  throw new Error("profile-reload-transaction: materializeOpenBuddyProfileImpl not installed");
};
let runtimeProfileBundleImpl: (bundle: any) => Promise<any> = async () => null;
let createOpenBuddyProfileImpl: () => any = () => ({ entries: [], patches: [] });
let composePluginPatchesImpl: (entries: readonly any[], patches: readonly any[][]) => any[] =
  () => [];
let syncDeepSeekCordisRuntimeImpl: (entries: readonly any[]) => Promise<void> = async () => undefined;
let deepSeekCoreRuntimeEntriesImpl: (patches: readonly any[]) => any[] = () => [];
let reconcileProfileArtifactsImpl: () => Promise<void> = async () => undefined;
let refreshHookConfigsImpl: () => Promise<void> = async () => undefined;
let reloadMcpImpl: () => Promise<void> = async () => undefined;
let reportPiExtensionErrorsImpl: () => void = () => undefined;
let readOverridePatchesImpl: () => Promise<readonly any[] | undefined> = async () => [];
let setProfilePiResourcePathsImpl: (paths: {
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
}) => void = () => undefined;
let startProfileWatchersImpl: () => Promise<void> = async () => undefined;
let configurePiExtensionsImpl: (specs: readonly any[]) => void = () => undefined;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallProfileReloadTransactionDeps {
  state: AgentHostState;
  pluginLifecycleQueue: {
    enqueue: <T>(
      kind: string,
      target: string,
      operation: (transaction: any) => Promise<T>,
    ) => Promise<T>;
  };
  piRuntimeCoordinator: { reload: (reason: string) => Promise<void> };
  emitPluginEvent: (type: string, payload: unknown) => void;

  capturePiProfileSnapshot: () => PiProfileSnapshot;
  restorePiProfileSnapshot: (snapshot: PiProfileSnapshot) => void;
  captureReloadableContextServices: () => Map<string, unknown>;
  restoreCapturedContextServices: (captured: Map<string, unknown>) => void;
  captureDeepSeekCapabilityServices: () => Map<string, unknown>;
  restoreDeepSeekCapabilityServices: (captured?: Map<string, unknown>) => Promise<void>;
  materializeOpenBuddyProfile: (options: any) => Promise<{ profile: any; bundle: any }>;
  runtimeProfileBundle: (bundle: any) => Promise<any>;
  createOpenBuddyProfile: () => any;
  composePluginPatches: (entries: readonly any[], patches: readonly any[][]) => any[];
  syncDeepSeekCordisRuntime: (entries: readonly any[]) => Promise<void>;
  deepSeekCoreRuntimeEntries: (patches: readonly any[]) => any[];
  reconcileProfileArtifacts: () => Promise<void>;
  refreshHookConfigs: () => Promise<void>;
  reloadMcp: () => Promise<void>;
  reportPiExtensionErrors: () => void;
  readOverridePatches: () => Promise<readonly any[] | undefined>;
  setProfilePiResourcePaths: (paths: {
    extensions: string[];
    skills: string[];
    prompts: string[];
    themes: string[];
  }) => void;
  startProfileWatchers: () => Promise<void>;
  configurePiExtensions: (specs: readonly any[]) => void;
}

/**
 * 一次性 install 所有 profile-reload 依赖.
 *
 * 必须在 `agent-host.ts:initialize()` 早期 (state 已初始化, 但 pluginLifecycleQueue
 * 还未启动 transaction 之前) 调用.
 *
 * 与 installPluginMutations 顺序: 本模块应先 install, 因为 plugin-mutations 通过
 * 显式参数接收 scheduleProfileReload / rollbackPiProfile 函数引用 — 但因为
 * 本模块导出的是模块级函数 (而非通过 deps 注入), 实际顺序不重要.
 */
export function installProfileReloadTransaction(
  deps: InstallProfileReloadTransactionDeps,
): void {
  if (deps.state) state = deps.state;
  if (deps.pluginLifecycleQueue) pluginLifecycleQueue = deps.pluginLifecycleQueue;
  if (deps.piRuntimeCoordinator) piRuntimeCoordinator = deps.piRuntimeCoordinator;
  if (deps.emitPluginEvent) emitPluginEvent = deps.emitPluginEvent;
  if (deps.capturePiProfileSnapshot) capturePiProfileSnapshotImpl = deps.capturePiProfileSnapshot;
  if (deps.restorePiProfileSnapshot) restorePiProfileSnapshotImpl = deps.restorePiProfileSnapshot;
  if (deps.captureReloadableContextServices) captureReloadableContextServicesImpl = deps.captureReloadableContextServices;
  if (deps.restoreCapturedContextServices) restoreCapturedContextServicesImpl = deps.restoreCapturedContextServices;
  if (deps.captureDeepSeekCapabilityServices) captureDeepSeekCapabilityServicesImpl = deps.captureDeepSeekCapabilityServices;
  if (deps.restoreDeepSeekCapabilityServices) restoreDeepSeekCapabilityServicesImpl = deps.restoreDeepSeekCapabilityServices;
  if (deps.materializeOpenBuddyProfile) materializeOpenBuddyProfileImpl = deps.materializeOpenBuddyProfile;
  if (deps.runtimeProfileBundle) runtimeProfileBundleImpl = deps.runtimeProfileBundle;
  if (deps.createOpenBuddyProfile) createOpenBuddyProfileImpl = deps.createOpenBuddyProfile;
  if (deps.composePluginPatches) composePluginPatchesImpl = deps.composePluginPatches;
  if (deps.syncDeepSeekCordisRuntime) syncDeepSeekCordisRuntimeImpl = deps.syncDeepSeekCordisRuntime;
  if (deps.deepSeekCoreRuntimeEntries) deepSeekCoreRuntimeEntriesImpl = deps.deepSeekCoreRuntimeEntries;
  if (deps.reconcileProfileArtifacts) reconcileProfileArtifactsImpl = deps.reconcileProfileArtifacts;
  if (deps.refreshHookConfigs) refreshHookConfigsImpl = deps.refreshHookConfigs;
  if (deps.reloadMcp) reloadMcpImpl = deps.reloadMcp;
  if (deps.reportPiExtensionErrors) reportPiExtensionErrorsImpl = deps.reportPiExtensionErrors;
  if (deps.readOverridePatches) readOverridePatchesImpl = deps.readOverridePatches;
  if (deps.setProfilePiResourcePaths) setProfilePiResourcePathsImpl = deps.setProfilePiResourcePaths;
  if (deps.startProfileWatchers) startProfileWatchersImpl = deps.startProfileWatchers;
  if (deps.configurePiExtensions) configurePiExtensionsImpl = deps.configurePiExtensions;
}

/** 测试/调试用: 重置模块级单例回到 stub. 不在生产代码调用. */
export function __resetProfileReloadTransactionForTest(): void {
  state = null;
  pluginLifecycleQueue = null;
  piRuntimeCoordinator = null;
  emitPluginEvent = () => undefined;
}

// ---------------------------------------------------------------------------
// 公开 API (模块级单例函数)
// ---------------------------------------------------------------------------

/**
 * 把状态回滚到 snapshot 抓取时刻. profile-reload 失败时由 caller 调用.
 *
 * 用途:
 *   - scheduleProfileReload 内部 catch (line 988 路径)
 *   - plugin-mutations.reloadPiExtensionsInternal 的 catch (line 401 路径)
 */
export async function rollbackPiProfile(
  snapshot: PiProfileSnapshot,
  capturedServices: Map<string, unknown> = new Map(),
  capturedCapabilities?: Map<string, unknown>,
): Promise<void> {
  if (!state) throw new Error("profile-reload-transaction: not installed");
  restorePiProfileSnapshotImpl(snapshot);
  await startProfileWatchersImpl();
  if (snapshot.activePluginProfile) {
    await state.loader?.replaceProfile(snapshot.activePluginProfile);
  }
  const rollbackProfile = snapshot.activePluginProfile;
  await syncDeepSeekCordisRuntimeImpl(
    deepSeekCoreRuntimeEntriesImpl(
      composePluginPatchesImpl(
        rollbackProfile?.entries ?? [],
        rollbackProfile?.patches ?? [],
      ),
    ),
  );
  await reconcileProfileArtifactsImpl();
  await piRuntimeCoordinator!.reload("profile-rollback");
  await reloadMcpImpl();
  if (capturedCapabilities === undefined) {
    await restoreDeepSeekCapabilityServicesImpl();
  } else {
    await restoreDeepSeekCapabilityServicesImpl(capturedCapabilities);
  }
  restoreCapturedContextServicesImpl(capturedServices);
  reportPiExtensionErrorsImpl();
}

/**
 * 触发一次 profile reload 事务 (debounced 100ms).
 *
 * 流程:
 *   prepare    — 物化 profile, 更新 state.profilePackage*
 *   cordis     — syncDeepSeekCordisRuntime
 *   artifacts  — reconcileProfileArtifacts (typert/remote)
 *   pi         — piRuntimeCoordinator.reload("profile-reload")
 *   mcp        — reloadMcp
 *   renderer   — 等 renderer ack receipt (5s 超时)
 *   失败时     — 调 rollbackPiProfile(previous, capturedServices), 标记 rolledBack
 */
export function scheduleProfileReload(): void {
  if (!state) throw new Error("profile-reload-transaction: not installed");
  if (!pluginLifecycleQueue) throw new Error("profile-reload-transaction: queue not installed");
  if (!state.loader) return;
  if (state.profileReloadTimer) clearTimeout(state.profileReloadTimer);
  state.profileReloadTimer = setTimeout(() => {
    state!.profileReloadTimer = null;
    state!.profileReloadPromise = pluginLifecycleQueue!.enqueue(
      "profile-reload",
      "profile",
      async (transaction) => {
        const previous = capturePiProfileSnapshotImpl();
        const capturedServices = captureReloadableContextServicesImpl();
        const capturedCapabilities = captureDeepSeekCapabilityServicesImpl();
        try {
          const pluginTransactionId = typeof transaction.transactionId === "string" ? transaction.transactionId : undefined;
          const piGenerationBefore = state!.piGeneration;
          transaction.phase("prepare", "profile");
          const materialized = state!.profileOptions
            ? await materializeOpenBuddyProfileImpl(state!.profileOptions)
            : null;
          const runtimeBundle = materialized
            ? await runtimeProfileBundleImpl(materialized.bundle)
            : null;

          if (materialized) {
            state!.profilePackageJson = materialized.profile.packageJson;
            state!.profilePackagePaths.splice(
              0,
              state!.profilePackagePaths.length,
              ...materialized.profile.packagePaths,
            );
          }
          if (materialized) {
            state!.profilePiExtensions = materialized.profile.piExtensions;
            state!.profilePiPackagePaths.splice(
              0,
              state!.profilePiPackagePaths.length,
              ...materialized.profile.piPackagePaths,
            );
            setProfilePiResourcePathsImpl(materialized.profile.piResourcePaths);
            configurePiExtensionsImpl(materialized.profile.piExtensions);
            await startProfileWatchersImpl();
          }

          const baseProfile = state!.baseProfile ?? createOpenBuddyProfileImpl();
          const overrideLayers = await readOverridePatchesImpl();
          if (overrideLayers === undefined) {
            throw new Error("openbuddy-profile: override patch reload was rejected");
          }

          const nextEntries: any[] = [
            ...baseProfile.entries,
            ...(runtimeBundle?.entries ?? []),
          ];
          const nextPatches: any[][] = [
            ...(baseProfile.patches ?? []),
            ...(runtimeBundle?.patches ?? []),
            ...state!.storedLayers,
            ...overrideLayers,
          ];

          await state!.loader?.replaceProfile({
            entries: nextEntries,
            patches: nextPatches,
          });

          transaction.phase("cordis", "deepseek-cordis");
          await syncDeepSeekCordisRuntimeImpl(
            deepSeekCoreRuntimeEntriesImpl(
              composePluginPatchesImpl(nextEntries, nextPatches),
            ),
          );
          transaction.receipt("cordis", { profileEntries: nextEntries.length });

          state!.activePluginProfile = {
            entries: [...nextEntries],
            patches: [
              ...(baseProfile.patches ?? []),
              ...(runtimeBundle?.patches ?? []),
              ...state!.storedLayers,
              ...overrideLayers,
            ],
          };
          state!.profileBundle = runtimeBundle ?? null;

          transaction.phase("artifacts", "typert-remote");
          await reconcileProfileArtifactsImpl();
          transaction.receipt("artifacts", {
            remote: state!.profileRemoteContributions.size,
            typert: state!.profileTypertContributions.size,
          });
          await refreshHookConfigsImpl();

          if (state!.session && state!.piResourceLoader) {
            transaction.phase("pi", "pi-resource-loader");
            await piRuntimeCoordinator!.reload("profile-reload");
            transaction.receipt("pi", {
              generation: state!.piGeneration,
              previousGeneration: piGenerationBefore,
              ...(pluginTransactionId ? { transactionId: pluginTransactionId } : {}),
              extensions: state!.piExtensionStatuses.filter(
                (entry) => entry.state === "loaded",
              ).length,
            });
            transaction.phase("mcp", "mcp");
            await reloadMcpImpl();
            transaction.receipt("mcp");
            await restoreDeepSeekCapabilityServicesImpl(capturedCapabilities);
            restoreCapturedContextServicesImpl(capturedServices);
            reportPiExtensionErrorsImpl();
          }

          transaction.phase("renderer", "renderer-module-graph");
          transaction.receipt("rollback-previous", {
            piEntries: previous.piExtensionStatuses.length,
            capturedServices: capturedServices.size,
          });
          await transaction.awaitSurfaceReceipt(
            "renderer",
            RENDERER_RECEIPT_TIMEOUT_MS,
          );

          emitPluginEvent("profile/reloaded", {
            name: materialized?.profile.name ?? "desktop",
            piExtensions:
              materialized?.profile.piExtensions.map(
                (extension: any) => extension.id,
              ) ?? [],
          });
        } catch (error) {
          try {
            transaction.phase("rollback", "profile");
            await rollbackPiProfile(previous, capturedServices, capturedCapabilities);
            emitPluginEvent("profile/reload-failed", {
              error: String(error),
              rolledBack: true,
            });
          } catch (rollbackError) {
            emitPluginEvent("profile/reload-failed", {
              error: String(error),
              rolledBack: false,
              rollbackError: String(rollbackError),
            });
            throw error;
          }
          throw markPluginTransactionRolledBack(error);
        }
      },
    );
    // Watcher-triggered reloads have no caller waiting on the promise. Attach
    // a rejection handler without replacing the shared promise, so manual
    // callers still receive the transaction failure and can retry explicitly.
    void state!.profileReloadPromise.catch(() => undefined);
  }, RELOAD_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// 内部依赖: markPluginTransactionRolledBack — 延迟 import 避免循环依赖
// ---------------------------------------------------------------------------

import { markPluginTransactionRolledBack } from "../plugin-lifecycle";
