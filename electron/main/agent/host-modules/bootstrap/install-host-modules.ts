/**
 * bootstrap/install-host-modules.ts — single entry point that wires every
 * host-module's module-level state via its `installXxx()` pattern.
 *
 * Phase v4 §M-5: 拆分为 4 个域 helper (profile / session / plugin / runtime),
 * 本文件仅保留 InstallHostModuleDeps interface + 一个 installHostModules 函数
 * 调用 4 个域 helper. 总行数 494 → ~150.
 *
 * 顺序: profile → session → plugin → runtime (核心域 init 顺序)
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - deps 参数 (InstallHostModuleDeps) 携带所有从 agent-host.ts 传入的闭包变量
 */

import type { AgentHostState } from "../_state-shape";

// ──────────────────────────────────────────────────────────────────────────
// Profile 域 install — 11 modules
// ──────────────────────────────────────────────────────────────────────────
import { installOverridePatches } from "../profile/override-patches";
import { installProfileSnapshot } from "../profile/snapshot";
import { installProfileBundles } from "../profile/bundles";
import { installProfileResourcePaths } from "../profile/resource-paths";
import { installUnifiedPackages } from "../profile/unified-packages";
import { installPresetHelpers } from "../preset-helpers";
import { installAgentPresetRuntime } from "../agent-preset-runtime";
import { installContextServicesSnapshot } from "../context-services-snapshot";
import { installDefaultPiPackageInstaller } from "../default-pi-package-installer";

// ──────────────────────────────────────────────────────────────────────────
// Session 域 install — 9 modules
// ──────────────────────────────────────────────────────────────────────────
import { installHarnessCursors } from "../harness-cursors";
import { installAgentModel } from "../agent-model";
import { installAgentPrompt } from "../agent-prompt";
import { installTeamRunner } from "../team-runner";
import { installDeepSeekAgentRuntime } from "../deepseek/agent-runtime";
import { installDeepSeekCordisRuntime } from "../deepseek/cordis-runtime";
import { installSessionMetadata } from "../session-metadata";
import { installSessionStore } from "../session-store";
import { installSubagentRuntime } from "../subagent-runtime";

// ──────────────────────────────────────────────────────────────────────────
// Plugin 域 install — 11 modules
// ──────────────────────────────────────────────────────────────────────────
import { installHookPermission } from "../hook-permission";
import { installPluginEventBus } from "../plugin-event-bus";
import { installPluginState } from "../plugin-state";
import { installPluginMutations } from "../plugin-mutations";
import { installPiExtensionConfigure } from "../pi-extension-configure";
import { installDisposeInternal } from "../dispose-internal";
import { installWorkbenchScope } from "../workbench-scope";
import { installWorkbenchScopeSync } from "../workbench-scope-sync";
import { installUiRequestResolver } from "../ui-request-resolver";
import { installTelemetrySink } from "../telemetry-sink";
import { installDshBridgeHelpers } from "../dsh-bridge-helpers";

// ──────────────────────────────────────────────────────────────────────────
// Runtime 域 install — 7 modules (含跨域共享)
// ──────────────────────────────────────────────────────────────────────────
import { installProfileReloadTransaction } from "../profile-reload-transaction";
import { installSessionRebind } from "../session-rebind";
import { installSessionProjection } from "../session-projection";
import { installSessionSwap } from "../session-swap";
import { installProfileArtifactReconciler } from "../profile-artifact-reconciler";
import { installPiRuntimeFactories } from "../pi-runtime-factories";
import { installPiRuntimeRefresh } from "../pi-runtime-refresh";
import { installDeepSeekAgentFactory } from "../deepseek-agent-factory";
import { installBeforeQuitHandler } from "../lifecycle/before-quit-handler";
import { installModelConfig } from "../models-config";
import { installInitOrchestration } from "../init-orchestration";

/**
 * 完整的依赖参数. 4 个域 helper 各自接收自己需要的子集.
 *
 * NOTE: only include the deps that are NOT already on `state`. Anything
 * stored in `state` after bootstrap (modelRuntime, piExtensionStatuses, etc.)
 * is accessed via `state` directly inside the host-modules.
 */
export interface InstallHostModuleDeps {
  // ── 通用 (4 域共享) ──
  state: AgentHostState;
  piHome: () => string;
  isPathWithin: (root: string, candidate: string) => boolean;
  piSessionDir: (cwd: string) => string;
  toModuleUrl: (path: string) => string;
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  hasRendererEventEmitter: () => boolean;
  // ── Session 域 ──
  listAllPiSessions: <T = unknown>() => any;
  persistedSessionPath: (sessionId: string | undefined) => Promise<string | undefined>;
  listPersistedSessionInfos: () => Promise<Array<{ id: string }>>;
  readPersistedSessionHeader: (sessionId: string) => Promise<{ title?: string; name?: string }>;
  persistPiSessionHeader: (session: any) => Promise<void>;
  pluginEvents: (query?: { sessionId?: string; sinceSequence?: number; limit?: number }) => any[];
  // ── Lifecycle ──
  enqueueLifecycle: <T>(operation: () => Promise<T>) => Promise<T>;
  lifecycleAppendQueues: Map<string, Promise<void>>;
  // ── Self-references ──
  initialize: (opts?: { cwd?: string; sessionPath?: string; force?: boolean }) => Promise<void>;
  rebindSession: (sessionPath: string, cwd: string) => Promise<void>;
  dispose: () => Promise<void>;
  replaceSession: (opts: any) => Promise<any>;
  sessionManagerOpen: (sessionPath: string, options: any, cwd: string) => any;
  piSessionRuntimeDispose: () => Promise<void>;
  // ── Host functions ──
  getSession: () => any;
  getModel: () => any;
  prompt: (text: string, options?: any) => Promise<unknown>;
  abort: (options?: any) => Promise<unknown>;
  setModel: (modelId: string, options?: any) => Promise<unknown>;
  setThinkingLevel: (level: any, options?: any) => Promise<unknown>;
  promptContent: (content: readonly unknown[], mode?: "queue" | "steer") => Promise<unknown>;
  onEvent: (handler: any) => unknown;
  provideRpcUiContext: (deps: any) => any;
  createOpenBuddyRpcUiContext: (deps: any) => any;
  questionAnswer: (value: any, questionKey?: string) => string | undefined;
  // ── Plugin helpers ──
  profilePackages: () => Promise<readonly unknown[]>;
  workspaceRegistry: unknown;
  publicQueueItems: (session: unknown) => readonly unknown[];
  readModelsConfig: () => unknown;
  canonicalEventNamespace: (...args: any[]) => any;
  eventNamespace: (...args: any[]) => any;
  // ── Subagent / preset ──
  createSubagentResourceLoader: (cwd: string) => Promise<any>;
  createTaskAwareTool: any;
  runHookPoint: any;
  profileArtifactModuleUrl: (id: string) => string;
  modelFacingPresetTools: unknown;
  ensureContinuableSubagent: (parentSessionId: string, childSessionId: string) => Promise<any>;
  listSubagentChildrenImpl: (parentSessionId: string) => Promise<any>;
  promptSubagentImpl: (parentSessionId: string, childSessionId: string, content: readonly any[]) => Promise<any>;
  interruptSubagentImpl: (parentSessionId: string, childSessionId: string) => Promise<any>;
  // ── Profile helpers ──
  setProfilePiResourcePaths: (paths: any) => void;
  refreshMarketplacePiResourcePaths: () => Promise<void>;
  refreshHookConfigs: () => Promise<void>;
  syncMarketplacePiExtensionStatuses: () => Promise<void>;
  startProfileWatchers: () => Promise<void>;
  stopProfileWatchers: () => void;
  readOverridePatches: () => any;
  runtimeProfileBundle: () => any;
  reconcileProfileArtifacts: () => Promise<void>;
  rollbackPiProfile: () => any;
  scheduleProfileReload: () => void;
  artifactPackageJsonByName: any;
  capturePiProfileSnapshot: () => any;
  restorePiProfileSnapshot: (snapshot: any) => void;
  discoverRendererPluginManifest: () => Promise<readonly any[]>;
  materializeOpenBuddyProfile: (options: any) => Promise<{ profile: any; bundle: any }>;
  createOpenBuddyProfile: () => any;
  // ── Pi extension / runtime ──
  configurePiExtensions: (specs: readonly unknown[]) => void;
  reportPiExtensionErrors: () => void;
  builtinPiExtensionFactories: any;
  describeCompatibilityAdapterCommandsMarkdown: any;
  mergePiExtensionStatuses: any;
  piExtensionsResolvedResolvedPayload: any;
  resolvePiExtensions: any;
  applyPiExtensionOverrides: any;
  piRuntimeCoordinator: { reload: (reason: string) => Promise<void>; reloadUntilStable?: (check: () => number, reason: string) => Promise<void> };
  piRuntimeCoordinatorReload: (reason: string) => Promise<void>;
  // ── Permission / workbench / dispose ──
  permissionReadRules: () => any;
  permissionWriteRules: (rules: any) => void;
  requestHookPermission: any;
  casdoorStatus: () => any;
  disposeProfileTypertRegistrations: (values: Iterable<unknown>) => void;
  disposeActiveHookProcesses: () => void;
  drainActiveHookProcesses: () => Promise<void>;
  // ── Deepseek ──
  syncDeepSeekCordisRuntime: (entries: readonly any[]) => Promise<void>;
  deepSeekCoreRuntimeEntries: (patches: readonly any[]) => any[];
  composePluginPatches: (entries: readonly any[], patches: readonly any[][]) => any[];
  captureDeepSeekCapabilityServices: () => Map<string, unknown>;
  restoreDeepSeekCapabilityServices: (captured?: Map<string, unknown>) => Promise<void>;
  // ── Capture / restore (used by profile + plugin) ──
  captureReloadableContextServices: () => Map<string, unknown>;
  restoreCapturedContextServices: (captured: Map<string, unknown>) => void;
  // ── Plugin state store ──
  pluginLifecycleQueue: { enqueue: (...args: any[]) => any };
  // ── DeepSeek agent factory ──
  createDeepSeekAgent: (options: any) => Promise<any>;
  resumeDeepSeekAgent: (options: any) => Promise<any>;
  // ── Session prompt impls ──
  promptImpl: any;
  abortImpl: any;
  listSessionsImpl: (cwd: string) => Promise<any>;
  // ── Agent preset helpers ──
  sessionPresetSelection: (sessionPath?: string | null) => Promise<string | null | undefined>;
  listAgentPresets: (cwd: string) => Promise<any>;
  readAgentPresetDefaults: () => any;
  writeAgentPresetDefault: (id?: string) => Promise<any>;
  readAgentPreset: (id: string, cwd: string) => Promise<any>;
  createPresetSessionRuntime: (opts: any) => any;
  createPiToolExtension: () => any;
  createPiPlanModeFactory: () => any;
  sessionHasConversation: (sessionPath: string) => boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// Domain helpers — 每个域内按 install 顺序调用各 host-module 的 install 函数.
// 每个 domain deps 都是该域 installer 参数的显式交集子契约：installer 新增
// 依赖时，composition root 会在这里获得编译期提示，而不是通过 any/never 逃逸。
// ──────────────────────────────────────────────────────────────────────────
type InstallerDeps<T extends (deps: any) => void> = Parameters<T>[0];

export type ProfileDomainDeps =
  & InstallerDeps<typeof installOverridePatches>
  & InstallerDeps<typeof installProfileSnapshot>
  & InstallerDeps<typeof installProfileBundles>
  & InstallerDeps<typeof installProfileResourcePaths>
  & InstallerDeps<typeof installUnifiedPackages>
  & InstallerDeps<typeof installPresetHelpers>
  & InstallerDeps<typeof installAgentPresetRuntime>
  & InstallerDeps<typeof installContextServicesSnapshot>
  & InstallerDeps<typeof installDefaultPiPackageInstaller>;

export type SessionDomainDeps =
  & InstallerDeps<typeof installHarnessCursors>
  & InstallerDeps<typeof installAgentModel>
  & InstallerDeps<typeof installAgentPrompt>
  & InstallerDeps<typeof installTeamRunner>
  & InstallerDeps<typeof installDeepSeekAgentRuntime>
  & InstallerDeps<typeof installDeepSeekCordisRuntime>
  & InstallerDeps<typeof installSessionMetadata>
  & InstallerDeps<typeof installSessionStore>
  & InstallerDeps<typeof installSubagentRuntime>;

export type PluginDomainDeps =
  & InstallerDeps<typeof installHookPermission>
  & InstallerDeps<typeof installPluginEventBus>
  & InstallerDeps<typeof installPluginState>
  & InstallerDeps<typeof installPluginMutations>
  & InstallerDeps<typeof installPiExtensionConfigure>
  & InstallerDeps<typeof installDisposeInternal>
  & InstallerDeps<typeof installWorkbenchScope>
  & InstallerDeps<typeof installWorkbenchScopeSync>
  & InstallerDeps<typeof installUiRequestResolver>
  & InstallerDeps<typeof installTelemetrySink>
  & InstallerDeps<typeof installDshBridgeHelpers>;

export type RuntimeDomainDeps =
  & InstallerDeps<typeof installProfileReloadTransaction>
  & InstallerDeps<typeof installSessionRebind>
  & InstallerDeps<typeof installSessionProjection>
  & InstallerDeps<typeof installSessionSwap>
  & InstallerDeps<typeof installProfileArtifactReconciler>
  & InstallerDeps<typeof installPiRuntimeFactories>
  & InstallerDeps<typeof installPiRuntimeRefresh>
  & InstallerDeps<typeof installDeepSeekAgentFactory>
  & InstallerDeps<typeof installBeforeQuitHandler>
  & InstallerDeps<typeof installModelConfig>
  & InstallerDeps<typeof installInitOrchestration>;

/**
 * Composition-root view of the installer bag. The legacy flat bag remains the
 * public compatibility input, while domain helpers only receive their own
 * grouped contract. Keeping this conversion at one boundary prevents a new
 * domain dependency from leaking into the other three domains.
 */
export interface InstallHostModuleDomainDeps {
  profile: ProfileDomainDeps;
  session: SessionDomainDeps;
  plugin: PluginDomainDeps;
  runtime: RuntimeDomainDeps;
}

/** Grouped composition-root contract; flat fields are intentionally not exported. */
export type InstallHostModuleDepsWithDomains = InstallHostModuleDomainDeps;
export type InstallHostModuleDomainInput = InstallHostModuleDomainDeps & { state: AgentHostState };

/**
 * Profile 域 (11 modules): override-patches → snapshot → bundles → resource-paths
 *   → unified-packages → preset-helpers → agent-preset-runtime →
 *   context-services-snapshot → default-pi-package-installer.
 *
 * 顺序: 文件解析 → 快照 → 包合并 → 资源路径 → 单元包 → preset →
 *       上下文服务快照 → 默认包安装器.
 */
function installProfileDomain(state: AgentHostState, deps: ProfileDomainDeps): void {
  if (deps.state !== state) throw new Error("installHostModules received inconsistent state");
  installOverridePatches(deps);
  installProfileSnapshot(deps);
  installProfileBundles(deps);
  installProfileResourcePaths(deps);
  installUnifiedPackages(deps);
  installPresetHelpers(deps);
  installAgentPresetRuntime(deps);
  installContextServicesSnapshot(deps);
  installDefaultPiPackageInstaller(deps);
}

/**
 * Session 域 (9 modules): harness-cursors → agent-model → agent-prompt →
 *   team-runner → deepseek/agent-runtime → deepseek/cordis-runtime →
 *   session-metadata → session-store → subagent-runtime.
 *
 * 顺序: harness cursor → 模型选择 → prompt/queue → team runner →
 *       deepseek runtime → cordis runtime → session metadata →
 *       session store → subagent.
 */
function installSessionDomain(state: AgentHostState, deps: SessionDomainDeps): void {
  if (deps.state !== state) throw new Error("installHostModules received inconsistent state");
  installHarnessCursors(deps);
  installAgentModel(deps);
  installAgentPrompt(deps);
  installTeamRunner(deps);
  installDeepSeekAgentRuntime(deps);
  installDeepSeekCordisRuntime(deps);
  installSessionMetadata(deps);
  installSessionStore(deps);
  installSubagentRuntime(deps);
}

/**
 * Plugin 域 (11 modules): hook-permission → plugin-event-bus → plugin-state →
 *   plugin-mutations → pi-extension-configure → dispose-internal →
 *   workbench-scope → workbench-scope-sync → ui-request-resolver →
 *   telemetry-sink → dsh-bridge-helpers.
 */
function installPluginDomain(state: AgentHostState, deps: PluginDomainDeps): void {
  if (deps.state !== state) throw new Error("installHostModules received inconsistent state");
  installHookPermission(deps);
  installPluginEventBus(deps);
  installPluginState(deps);
  installPluginMutations(deps);
  installPiExtensionConfigure(deps);
  installDisposeInternal(deps);
  installWorkbenchScope(deps);
  installWorkbenchScopeSync(deps);
  installUiRequestResolver(deps);
  installTelemetrySink(deps);
  installDshBridgeHelpers(deps);
}

/**
 * Runtime 域 (含跨域共享, 12 modules): profile-reload-transaction →
 *   session-rebind → session-projection → session-swap →
 *   profile-artifact-reconciler → pi-runtime-factories → pi-runtime-refresh →
 *   deepseek-agent-factory → lifecycle/before-quit-handler →
 *   models-config → init-orchestration.
 *
 * 这些 module 跨域共享, 不严格属于「一个域」; 排在最后以便 profile/session/plugin
 * 先注入完闭包, 再让 runtime 串起来.
 */
function installRuntimeDomain(state: AgentHostState, deps: RuntimeDomainDeps): void {
  if (deps.state !== state) throw new Error("installHostModules received inconsistent state");
  installProfileReloadTransaction(deps);
  installSessionRebind(deps);
  installSessionProjection(deps);
  installSessionSwap(deps);
  installProfileArtifactReconciler(deps);
  installPiRuntimeFactories(deps);
  installPiRuntimeRefresh(deps);
  installDeepSeekAgentFactory(deps);
  installBeforeQuitHandler(deps);
  installModelConfig(deps);
  installInitOrchestration(deps);
}

/**
 * Install 全部 4 域 host-module (所有域共享同一 deps + state):
 *   - Profile 域  (9 modules)
 *   - Session 域  (9 modules)
 *   - Plugin 域   (11 modules)
 *   - Runtime 域  (10 modules)
 *
 * 总 install 顺序在每个域内部维护 (见各域 helper 注释).
 */
export function installHostModules(state: AgentHostState, deps: InstallHostModuleDomainInput): void {
  if (deps.profile.state !== state) throw new Error("installHostModules received inconsistent state");
  installProfileDomain(state, deps.profile);
  installSessionDomain(state, deps.session);
  installPluginDomain(state, deps.plugin);
  installRuntimeDomain(state, deps.runtime);
}
