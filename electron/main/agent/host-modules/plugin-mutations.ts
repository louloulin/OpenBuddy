/**
 * host-modules/plugin-mutations.ts — plugin state + plugin runtime WRITE surface.
 *
 * Phase 8.3 Batch E: 把 plugin-state 写路径 + plugin-runtime 写路径
 * (~600 行, agent-host.ts lines 4323-4726 + 1879-1929 + 4506-4726) 一次性
 * 合并搬到本模块:
 *
 *   - refreshStoredPluginLayers (line 4323) — state.storedLayers 重读
 *   - listPluginInventory (line 4341) — bundle 全量 inventory
 *   - setPluginEnabledInternal (line 4428) — 三路径 enable/disable
 *   - reloadPluginInternal (line 4478) — 三路径 reload
 *   - reloadPiExtensionsInternal (line 4506) — profile + pi + mcp 整体 reload
 *   - updatePluginConfigInternal (line 4591) — config 写入
 *   - resetPluginStateInternal (line 4624) — 恢复默认
 *   - 5 个 wrapper (setPluginEnabled / reloadPlugin / reloadPiExtensions /
 *     updatePluginConfig / resetPluginState) — line 4659-4685
 *   - enqueuePluginStateTransaction (line 4687) — rollback queue
 *   - reloadPiRuntime (line 4674) — pi runtime coordinator reload
 *   - reloadProfile / installProfileBundle / removeProfileBundle
 *     (line 1879 / 1918 / 1925) — profile 包级别操作
 *
 * Read side: 见 host-modules/plugin-state.ts (pluginSnapshot /
 *   pluginEvents / reportActivePluginTransaction / listActivePluginTransactions)
 *          + host-modules/plugin-runtime.ts (getStoredPluginState /
 *   listRendererPluginEntries / rendererPluginBootGraph /
 *   resolveRendererPluginModule / discoverRendererPluginManifest)
 *
 * 设计:
 *   - state / emitPluginEvent / profilePackages / profileArtifactModuleUrl /
 *     isPathWithin / setProfilePiResourcePaths / refreshMarketplacePiResourcePaths /
 *     refreshHookConfigs / syncMarketplacePiExtensionStatuses / startProfileWatchers /
 *     readOverridePatches / runtimeProfileBundle / reconcileProfileArtifacts /
 *     configurePiExtensions / reportPiExtensionErrors / captureReloadableContextServices /
 *     restoreCapturedContextServices / rollbackPiProfile / pluginLifecycleQueue /
 *     scheduleProfileReload / artifactPackageJsonByName / providerCatalog /
 *     discoverRendererPluginManifest 通过环形 import 自 ../agent-host 注入
 *   - captureDeepSeekCapabilityServices / restoreDeepSeekCapabilityServices
 *     来自 ./workbench-scope
 *   - syncDeepSeekCordisRuntime / deepSeekCoreRuntimeEntries 来自
 *     ./deepseek/cordis-runtime
 *   - capturePiProfileSnapshot / restorePiProfileSnapshot 来自 ./profile/snapshot
 *   - reloadMcp 来自 ./mcp-runtime
 *   - piRuntimeCoordinator 来自 ./lifecycle
 *   - drainActiveHookProcesses 来自 ../agent-hooks
 *   - piResources 模块级 import (与 agent-host.ts 一致)
 */
import { type AgentHostState, } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";

/**
 * Phase 8.3 Architectural Refactor: plugin-mutations 反向依赖消除。
 *
 * 修复前: 24+ helper (state / emitPluginEvent / profilePackages / ...
 *         scheduleProfileReload 等) 通过环形 import 自 ../agent-host,
 *         导致任何单测都需要 mock 完整 agent-host 副作用链。
 * 修复后: 所有运行时依赖通过 installPluginMutations() 注入,
 *         providerCatalog 来自 ./agent-model (其本身已切换为 Install Pattern)。
 */
let state: AgentHostState = createDefaultAgentHostState();
let emitPluginEvent: (type: string, payload: unknown) => void = () => undefined;
let isPathWithin: (parent: string, child: string) => boolean = () => false;
let profileArtifactModuleUrl: (id: string) => string = (id) => id;
let profilePackages: () => any = async () => [];
let pluginLifecycleQueue: { enqueue: (...args: any[]) => any } = { enqueue: () => undefined };
let piRuntimeCoordinator: { reload: (reason: string) => Promise<void> } = { reload: async () => undefined };
let setProfilePiResourcePaths: (...args: unknown[]) => unknown = () => undefined;
let refreshMarketplacePiResourcePaths: (...args: unknown[]) => unknown = () => undefined;
let refreshHookConfigs: (...args: unknown[]) => unknown = () => undefined;
let syncMarketplacePiExtensionStatuses: (...args: unknown[]) => unknown = () => undefined;
let startProfileWatchers: (...args: unknown[]) => unknown = () => undefined;
let readOverridePatches: (...args: any[]) => any = async () => [];
let runtimeProfileBundle: (...args: any[]) => any = () => undefined;
let reconcileProfileArtifacts: (...args: any[]) => any = async () => undefined;
let configurePiExtensions: (...args: unknown[]) => unknown = () => undefined;
let reportPiExtensionErrors: (...args: unknown[]) => unknown = () => undefined;
let captureReloadableContextServices: (...args: unknown[]) => unknown = () => undefined;
let restoreCapturedContextServices: (...args: unknown[]) => unknown = () => undefined;
let rollbackPiProfile: (...args: unknown[]) => unknown = async () => undefined;
let scheduleProfileReload: () => void = () => undefined;
let artifactPackageJsonByName: (...args: unknown[]) => unknown = () => undefined;
let discoverRendererPluginManifest: (...args: any[]) => any = async () => [];

export function installPluginMutations(deps: {
	state: AgentHostState;
	emitPluginEvent: (type: string, payload: unknown) => void;
	isPathWithin: (parent: string, child: string) => boolean;
	profileArtifactModuleUrl: (id: string) => string;
	profilePackages: () => any;
	pluginLifecycleQueue: { enqueue: (...args: any[]) => any };
	piRuntimeCoordinator: { reload: (reason: string) => Promise<void> };
	setProfilePiResourcePaths: (...args: unknown[]) => unknown;
	refreshMarketplacePiResourcePaths: (...args: unknown[]) => unknown;
	refreshHookConfigs: (...args: unknown[]) => unknown;
	syncMarketplacePiExtensionStatuses: (...args: unknown[]) => unknown;
	startProfileWatchers: (...args: unknown[]) => unknown;
	readOverridePatches: (...args: any[]) => any;
	runtimeProfileBundle: (...args: any[]) => any;
	reconcileProfileArtifacts: (...args: any[]) => any;
	configurePiExtensions: (...args: unknown[]) => unknown;
	reportPiExtensionErrors: (...args: unknown[]) => unknown;
	captureReloadableContextServices: (...args: unknown[]) => unknown;
	restoreCapturedContextServices: (...args: unknown[]) => unknown;
	rollbackPiProfile: (...args: unknown[]) => unknown;
	scheduleProfileReload: () => void;
	artifactPackageJsonByName: (...args: unknown[]) => unknown;
	discoverRendererPluginManifest: (...args: any[]) => any;
}): void {
	state = deps.state;
	emitPluginEvent = deps.emitPluginEvent;
	isPathWithin = deps.isPathWithin;
	profileArtifactModuleUrl = deps.profileArtifactModuleUrl;
	profilePackages = deps.profilePackages;
	pluginLifecycleQueue = deps.pluginLifecycleQueue;
	piRuntimeCoordinator = deps.piRuntimeCoordinator;
	setProfilePiResourcePaths = deps.setProfilePiResourcePaths;
	refreshMarketplacePiResourcePaths = deps.refreshMarketplacePiResourcePaths;
	refreshHookConfigs = deps.refreshHookConfigs;
	syncMarketplacePiExtensionStatuses = deps.syncMarketplacePiExtensionStatuses;
	startProfileWatchers = deps.startProfileWatchers;
	readOverridePatches = deps.readOverridePatches;
	runtimeProfileBundle = deps.runtimeProfileBundle;
	reconcileProfileArtifacts = deps.reconcileProfileArtifacts;
	configurePiExtensions = deps.configurePiExtensions;
	reportPiExtensionErrors = deps.reportPiExtensionErrors;
	captureReloadableContextServices = deps.captureReloadableContextServices;
	restoreCapturedContextServices = deps.restoreCapturedContextServices;
	rollbackPiProfile = deps.rollbackPiProfile;
	scheduleProfileReload = deps.scheduleProfileReload;
	artifactPackageJsonByName = deps.artifactPackageJsonByName;
	discoverRendererPluginManifest = deps.discoverRendererPluginManifest;
}
import * as piResources from "../pi-resources";
import { providerCatalog } from "./agent-model";
import {
  composePluginPatches,
  installProfilePackage,
  materializeOpenBuddyProfile,
  removeProfilePackage,
  discoverRendererPluginEntries,
  type PluginProfile,
  type PluginStatus,
  type ProfilePackageInfo,
  type RendererPluginManifestEntry,
} from "@openbuddy/plugin-host";
import { createOpenBuddyProfile } from "@openbuddy/bundle-base";
import { createProfileArtifactResolvers } from "../profile-artifact-resolution";
import { openBuddyDeepSeekRendererEntries } from "@openbuddy/bundle-base";
import { capturePiProfileSnapshot } from "./profile/snapshot";
import {
  markPluginTransactionRolledBack,
  type PluginTransactionContext,
} from "../plugin-lifecycle";
import type { PiExtensionStatus } from "../pi-extensions";
import { captureDeepSeekCapabilityServices, restoreDeepSeekCapabilityServices } from "./workbench-scope";
import { syncDeepSeekCordisRuntime, deepSeekCoreRuntimeEntries } from "./deepseek/cordis-runtime";
import { reloadMcp } from "./mcp-runtime";
import { drainActiveHookProcesses } from "../agent-hooks";
type ProviderInventoryEntry = any;
import type { ProviderRegistrySource } from "../agent-host-provider-registry";

// ---------------------------------------------------------------------------
// profile / bundle helpers
// ---------------------------------------------------------------------------

export async function reloadProfile(): Promise<void> {
  scheduleProfileReload();
  await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 160));
  await state.profileReloadPromise;
}

export async function installProfileBundle(sourcePath: string): Promise<ProfilePackageInfo> {
  if (!state.profileOptions) throw new Error("openbuddy-profile: profile is not initialized");
  const result = await installProfilePackage(state.profileOptions, sourcePath);
  await reloadProfile();
  return result;
}

export async function removeProfileBundle(name: string): Promise<void> {
  if (!state.profileOptions) throw new Error("openbuddy-profile: profile is not initialized");
  await removeProfilePackage(state.profileOptions, name);
  await reloadProfile();
}

// ---------------------------------------------------------------------------
// layer / inventory helpers
// ---------------------------------------------------------------------------

export async function refreshStoredPluginLayers(updateActiveProfile = false): Promise<void> {
  const nextLayers = state.pluginState ? await state.pluginState.composePatches() : [];
  state.storedLayers = nextLayers;
  if (!updateActiveProfile || !state.activePluginProfile) return;
  const overrideLayers = await readOverridePatches();
  if (overrideLayers === undefined) throw new Error("openbuddy-profile: override patch reload was rejected");
  const baseProfile = state.baseProfile;
  state.activePluginProfile = {
    entries: [...state.activePluginProfile.entries],
    patches: [
      ...(baseProfile?.patches ?? []),
      ...(state.profileBundle?.patches ?? []),
      ...nextLayers,
      ...overrideLayers,
    ],
  };
}

export async function listPluginInventory(): Promise<{
  entries: PluginStatus[];
  piExtensions: PiExtensionStatus[];
  renderers: RendererPluginManifestEntry[];
  packages: ProfilePackageInfo[];
  providers: ProviderInventoryEntry[];
  terminals: {
    backends: string[];
    sessionCount: number;
  };
}> {
  const catalog = await providerCatalog();
  const providers: ProviderInventoryEntry[] = catalog.providers.map((row) => ({
    id: row.id,
    source: (row as { source?: ProviderRegistrySource }).source ?? "builtin",
    ...((row as { extensionPath?: string }).extensionPath
      ? { extensionPath: (row as { extensionPath?: string }).extensionPath }
      : {}),
  }));
  return {
    entries: state.loader?.list() ?? [],
    piExtensions: state.piExtensionStatuses.map((status) => ({ ...status })),
    renderers: await discoverRendererPluginManifest(),
    packages: state.profileOptions ? await profilePackages() : [],
    providers,
    terminals: {
      backends: state.terminalRuntime?.listBackends() ?? [],
      sessionCount: state.terminalRuntime?.sessionCount ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// internal write paths (transaction-aware)
// ---------------------------------------------------------------------------

export async function setPluginEnabledInternal(id: string, enabled: boolean, transaction?: PluginTransactionContext): Promise<PluginStatus | null> {
  // P2-13: listPlugins + setPluginEnabled live in the heavy marketplace
  // module. Lazy-load once per call to avoid static linking the HTML parser
  // and tarball unpack code into the entry chunk.
  const { listPlugins, setPluginEnabled } = await import("../pi-resources/marketplace");
  const marketplacePlugins = await listPlugins(state.cwd);
  const marketplacePlugin = marketplacePlugins.find((plugin) => plugin.id === id || plugin.name === id || (
    state.piExtensionStatuses.find((entry) => entry.id === id)?.source !== undefined
    && isPathWithin(plugin.root, state.piExtensionStatuses.find((entry) => entry.id === id)!.source!)
  ));
  if (marketplacePlugin) {
    const previousEnabled = marketplacePlugin.enabled;
    await setPluginEnabled(marketplacePlugin.name, enabled);
    try {
      transaction?.phase("pi", "marketplace-plugin");
      await reloadPiExtensionsInternal(transaction);
    } catch (error) {
      try {
        await piResources.setPluginEnabled(marketplacePlugin.name, previousEnabled);
        transaction?.phase("rollback", "marketplace-plugin");
        await reloadPiExtensionsInternal(transaction);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `openbuddy-agent: marketplace plugin rollback failed for ${marketplacePlugin.name}`);
      }
      throw error;
    }
    return state.piExtensionStatuses.find((entry) => entry.source?.startsWith(marketplacePlugin.root) || entry.id === marketplacePlugin.name) ?? null;
  }
  const piExtension = state.piExtensionStatuses.find((entry) => entry.id === id);
  if (piExtension) {
    if (piExtension.managed === false) throw new Error(`openbuddy-agent: Pi extension ${id} is auto-discovered and cannot be overridden from the profile panel`);
    if (!state.pluginState) throw new Error("openbuddy-agent: plugin state store not initialized");
    const snapshot = await state.pluginState.patchPiExtension(id, { enabled });
    state.piExtensionOverrides = snapshot.piExtensions ?? {};
    configurePiExtensions(state.profilePiExtensions);
    if (state.session) {
      transaction?.phase("pi", "pi-resource-loader");
      await piRuntimeCoordinator.reload(`plugin-enable:${id}`);
      reportPiExtensionErrors();
    }
    return state.piExtensionStatuses.find((entry) => entry.id === id) ?? null;
  }
  if (!state.loader) throw new Error("openbuddy-agent: plugin host not initialized");
  const captured = captureDeepSeekCapabilityServices();
  if (state.pluginState) await state.pluginState.patch(id, { disabled: !enabled });
  await refreshStoredPluginLayers();
  transaction?.phase("cordis", "plugin-loader") as any;
  await state.loader.update(id, { disabled: !enabled });
  await restoreDeepSeekCapabilityServices(captured);
  await refreshStoredPluginLayers(true);
  return state.loader.list().find((entry) => entry.id === id) ?? null;
}

/** Re-import and re-apply a plugin through the same loader lifecycle. */
export async function reloadPluginInternal(id: string, transaction?: PluginTransactionContext): Promise<PluginStatus | null> {
  // P2-13: same lazy-load as setPluginEnabledInternal — both functions
  // live in the heavy marketplace module.
  const { listPlugins } = await import("../pi-resources/marketplace");
  const marketplacePlugins = await listPlugins(state.cwd);
  const marketplacePlugin = marketplacePlugins.find((plugin) => plugin.id === id || plugin.name === id || (
    state.piExtensionStatuses.find((entry) => entry.id === id)?.source !== undefined
    && isPathWithin(plugin.root, state.piExtensionStatuses.find((entry) => entry.id === id)!.source!)
  ));
  if (marketplacePlugin) {
    transaction?.phase("pi", "marketplace-plugin");
    await reloadPiExtensionsInternal(transaction);
    return state.piExtensionStatuses.find((entry) => entry.source?.startsWith(marketplacePlugin.root) || entry.id === marketplacePlugin.name) ?? null;
  }
  if (state.piExtensionStatuses.some((entry) => entry.id === id)) {
    if (!state.session) throw new Error("openbuddy-agent: Pi session is not initialized");
    transaction?.phase("pi", "pi-resource-loader");
    await piRuntimeCoordinator.reload(`plugin-reload:${id}`);
    reportPiExtensionErrors();
    await syncMarketplacePiExtensionStatuses();
    return state.piExtensionStatuses.find((entry) => entry.id === id) ?? null;
  }
  if (!state.loader) throw new Error("openbuddy-agent: plugin host not initialized");
  const captured = captureDeepSeekCapabilityServices();
  transaction?.phase("cordis", "plugin-loader") as any;
  await state.loader.reload(id);
  await restoreDeepSeekCapabilityServices(captured);
  return state.loader.list().find((entry) => entry.id === id) ?? null;
}

/** Re-materialize the profile and reload Pi resources without recreating the AgentSession. */
export async function reloadPiExtensionsInternal(transaction?: PluginTransactionContext): Promise<PiExtensionStatus[]> {
  if (!state.piResourceLoader) throw new Error("openbuddy-agent: Pi resource loader is not initialized");
  const previous = capturePiProfileSnapshot();
  const capturedCapabilities = captureDeepSeekCapabilityServices();
  const capturedServices = captureReloadableContextServices();
  try {
    transaction?.phase("prepare", "pi-profile");
    await drainActiveHookProcesses();
    await refreshMarketplacePiResourcePaths();
    const materialized = state.profileOptions ? await materializeOpenBuddyProfile(state.profileOptions) : null;
    if (materialized) {
      const runtimeBundle = await runtimeProfileBundle(materialized.bundle);
      state.profilePackageJson = materialized.profile.packageJson;
      state.profilePackagePaths.splice(0, state.profilePackagePaths.length, ...materialized.profile.packagePaths);
      state.profileBundle = runtimeBundle as any;
      state.profilePiExtensions = materialized.profile.piExtensions;
      state.profilePiPackagePaths.splice(0, state.profilePiPackagePaths.length, ...materialized.profile.piPackagePaths);
      setProfilePiResourcePaths(materialized.profile.piResourcePaths);
      configurePiExtensions(materialized.profile.piExtensions);
      await startProfileWatchers();
      const baseProfile = state.baseProfile ?? createOpenBuddyProfile();
      const overrideLayers = await readOverridePatches();
      if (overrideLayers === undefined) throw new Error("openbuddy-profile: override patch reload was rejected");
      const activeProfile: PluginProfile = {
        entries: [...baseProfile.entries, ...runtimeBundle.entries],
        patches: [
          ...(baseProfile.patches ?? []),
          ...(runtimeBundle.patches ?? []),
          ...state.storedLayers,
          ...overrideLayers,
        ],
      };
      await state.loader?.replaceProfile(activeProfile);
      state.activePluginProfile = activeProfile;
      transaction?.phase("cordis", "deepseek-cordis");
      await syncDeepSeekCordisRuntime(deepSeekCoreRuntimeEntries(composePluginPatches(
        activeProfile.entries,
        activeProfile.patches ?? [],
      )));
      transaction?.receipt("cordis", { profileEntries: activeProfile.entries.length });
      transaction?.phase("artifacts", "typert-remote");
      await reconcileProfileArtifacts();
      transaction?.receipt("artifacts", {
        remote: state.profileRemoteContributions.size,
        typert: state.profileTypertContributions.size,
      });
      await refreshHookConfigs();
    } else {
      configurePiExtensions(state.profilePiExtensions);
      const activeProfile = state.activePluginProfile;
      if (activeProfile) {
        await syncDeepSeekCordisRuntime(deepSeekCoreRuntimeEntries(composePluginPatches(
          activeProfile.entries,
          activeProfile.patches ?? [],
        )));
      }
    }
    transaction?.phase("pi", "pi-resource-loader");
    await piRuntimeCoordinator.reload("pi-extensions");
    transaction?.phase("mcp", "mcp");
    await reloadMcp(state);
    transaction?.receipt("mcp");
    await restoreDeepSeekCapabilityServices(capturedCapabilities);
    restoreCapturedContextServices(capturedServices);
    reportPiExtensionErrors();
    transaction?.receipt("pi", { extensions: state.piExtensionStatuses.filter((entry) => entry.state === "loaded").length });
    await syncMarketplacePiExtensionStatuses();
    emitPluginEvent("pi/extensions-reloaded", {
      extensions: state.piExtensionStatuses.map((extension) => ({ ...extension })),
    });
    return state.piExtensionStatuses.map((extension) => ({ ...extension }));
  } catch (error) {
    try {
      transaction?.phase("rollback", "pi-profile");
      await rollbackPiProfile(previous, capturedServices);
      emitPluginEvent("pi/extensions-reload-failed", { error: String(error), rolledBack: true });
    } catch (rollbackError) {
      emitPluginEvent("pi/extensions-reload-failed", { error: String(error), rolledBack: false, rollbackError: String(rollbackError) });
      throw error;
    }
    throw markPluginTransactionRolledBack(error);
  }
}

/** Update a plugin's runtime config; non-disabled entries go through Cordis update. */
export async function updatePluginConfigInternal(id: string, config: unknown, transaction?: PluginTransactionContext): Promise<PluginStatus | null> {
  const piExtension = state.piExtensionStatuses.find((entry) => entry.id === id);
  if (piExtension) {
    if (piExtension.managed === false) throw new Error(`openbuddy-agent: Pi extension ${id} is auto-discovered and cannot be overridden from the profile panel`);
    if (!state.pluginState) throw new Error("openbuddy-agent: plugin state store not initialized");
    const snapshot = await state.pluginState.patchPiExtension(id, { config });
    state.piExtensionOverrides = snapshot.piExtensions ?? {};
    configurePiExtensions(state.profilePiExtensions);
    if (state.session) {
      transaction?.phase("pi", "pi-resource-loader");
      await piRuntimeCoordinator.reload(`plugin-config:${id}`);
    reportPiExtensionErrors();
    await syncMarketplacePiExtensionStatuses();
    }
    return state.piExtensionStatuses.find((entry) => entry.id === id) ?? null;
  }
  if (!state.loader) throw new Error("openbuddy-agent: plugin host not initialized");
  const captured = captureDeepSeekCapabilityServices();
  if (state.pluginState) await state.pluginState.patch(id, { config });
  await refreshStoredPluginLayers();
  transaction?.phase("cordis", "plugin-loader") as any;
  await state.loader.update(id, { config });
  await restoreDeepSeekCapabilityServices(captured);
  await refreshStoredPluginLayers(true);
  return state.loader.list().find((entry) => entry.id === id) ?? null;
}

/** Clear a single plugin's persisted override (revert to profile defaults). */
export async function resetPluginStateInternal(id: string, transaction?: PluginTransactionContext) {
  if (!state.pluginState) throw new Error("openbuddy-agent: plugin state store not initialized");
  if (state.piExtensionStatuses.some((entry) => entry.id === id)) {
    if (state.piExtensionStatuses.find((entry) => entry.id === id)?.managed === false) return state.pluginState.read();
    const snapshot = await state.pluginState.resetPiExtension(id);
    state.piExtensionOverrides = snapshot.piExtensions ?? {};
    configurePiExtensions(state.profilePiExtensions);
    if (state.session) {
      transaction?.phase("pi", "pi-resource-loader");
      await piRuntimeCoordinator.reload(`plugin-reset:${id}`);
      reportPiExtensionErrors();
    }
    return snapshot;
  }
  const snapshot = await state.pluginState.reset(id);
  await refreshStoredPluginLayers();
  if (state.loader && state.activePluginProfile) {
    const nextProfile: PluginProfile = {
      entries: [...state.activePluginProfile.entries],
      patches: [
        ...(state.baseProfile?.patches ?? []),
        ...(state.profileBundle?.patches ?? []),
        ...state.storedLayers,
        ...(await readOverridePatches() ?? []),
      ],
    };
    const captured = captureDeepSeekCapabilityServices();
    transaction?.phase("cordis", "plugin-loader") as any;
    await state.loader.replaceProfile(nextProfile);
    state.activePluginProfile = nextProfile;
    await restoreDeepSeekCapabilityServices(captured);
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// public wrappers (transaction queue + IPC entry points)
// ---------------------------------------------------------------------------

export function setPluginEnabled(id: string, enabled: boolean): Promise<PluginStatus | null> {
  return enqueuePluginStateTransaction("plugin-enable", id, (transaction) => setPluginEnabledInternal(id, enabled, transaction));
}

export function reloadPlugin(id: string): Promise<PluginStatus | null> {
  return pluginLifecycleQueue.enqueue("plugin-reload", id, async (transaction: any) => {
    transaction.phase("prepare", "plugin");
    return reloadPluginInternal(id, transaction);
  });
}

export function reloadPiExtensions(): Promise<PiExtensionStatus[]> {
  return pluginLifecycleQueue.enqueue("pi-reload", "all", (transaction: any) => reloadPiExtensionsInternal(transaction));
}

export async function reloadPiRuntime(reason = "internal-reload"): Promise<void> {
  await piRuntimeCoordinator.reload(reason);
  reportPiExtensionErrors();
}

export function updatePluginConfig(id: string, config: unknown): Promise<PluginStatus | null> {
  return enqueuePluginStateTransaction("plugin-config", id, (transaction) => updatePluginConfigInternal(id, config, transaction));
}

export function resetPluginState(id: string) {
  return enqueuePluginStateTransaction("plugin-reset", id, (transaction) => resetPluginStateInternal(id, transaction));
}

export function enqueuePluginStateTransaction<T>(
  kind: "plugin-enable" | "plugin-config" | "plugin-reset",
  target: string,
  operation: (transaction: PluginTransactionContext) => Promise<T>,
): Promise<T> {
  return pluginLifecycleQueue.enqueue(kind, target, async (transaction: any) => {
    const before = await state.pluginState?.read() ?? {
      updatedAt: new Date(0).toISOString(),
      overrides: {},
      piExtensions: {},
    };
    const activeProfileBefore = state.activePluginProfile;
    try {
      transaction.phase("prepare", "plugin-state");
      return await operation(transaction);
    } catch (error) {
      if (!state.pluginState) throw error;
      try {
        await state.pluginState.write(before);
        state.piExtensionOverrides = before.piExtensions ?? {};
        await refreshStoredPluginLayers();
        if (state.loader && activeProfileBefore) {
          transaction.phase("rollback", "plugin-state");
          await state.loader.replaceProfile(activeProfileBefore);
          state.activePluginProfile = activeProfileBefore;
        }
        configurePiExtensions(state.profilePiExtensions);
        if (state.session) {
          await piRuntimeCoordinator.reload(`plugin-rollback:${operation.name || "state"}`);
          await restoreDeepSeekCapabilityServices();
          reportPiExtensionErrors();
        }
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "openbuddy-agent: plugin state rollback failed");
      }
      throw markPluginTransactionRolledBack(error);
    }
  });
}

// Re-export ensureDefaultPiPackages from @openbuddy/plugin-host so agent-host.ts
// can grab it via the host-modules/ plugin-mutations surface (the public
// wrapper layer). Phase 8.3 build-error fix — the workspace package already
// exports ensureDefaultPiPackages from profile-manager.ts; this re-export
// preserves agent-host.ts:753 import path.
export { ensureDefaultPiPackages } from "@openbuddy/plugin-host";
