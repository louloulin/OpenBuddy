/**
 * host-modules/profile/unified-packages.ts — agentHost.profilePackages() 统一视图.
 *
 * Phase v4 §L-5: extract agent-host.ts:883-913 (~31 行) 到独立 host-module.
 *
 * `profilePackages()` 把 6 个独立来源 (listProfilePackages / readOpenBuddyProfile /
 * discoverRendererPluginManifest / state.piExtensionStatuses /
 * state.profileRemoteContributions / state.profileTypertContributions /
 * state.deepSeekCordisSnapshot) 合并成统一的 plugin 清单, 标注每个 package
 * 实际加载了哪些 surface (bundle / pi / renderer / remote / typert / cordis),
 * 并把 health 投影为 "degraded" if any pi extension failed or any package is
 * already degraded.
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 外部依赖通过 install 注入 (state + discoverRendererPluginManifest + 两个 list 函数)
 *   - listProfilePackages / readOpenBuddyProfile / updateUnifiedPluginManifest
 *     直接从 @openbuddy/plugin-host 导入
 */

import {
  listProfilePackages,
  readOpenBuddyProfile,
  updateUnifiedPluginManifest,
  type ProfilePackageInfo,
  type UnifiedPluginSurfaceKind,
} from "@openbuddy/plugin-host";
import {
  discoverRendererPluginManifest as discoverRendererPluginManifestFn,
} from "./renderer-manifest";
import { type AgentHostState, type PiExtensionStatus } from "../_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;
// We accept an alternative for tests / SSR / future cross-host bridging.
let discoverRendererPluginManifestImpl: (state: AgentHostState) => Promise<{ moduleId: string; disabled?: boolean }[]> = async () => [];

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallUnifiedPackagesDeps {
  state: AgentHostState;
  /** host-modules/profile/renderer-manifest.discoverRendererPluginManifest(state, ...)
   *  signature matches the renderer-manifest module: (state, profileArtifactModuleUrl) => Promise<manifest>.
   *  We wrap to convert profileArtifactModuleUrl into a no-op arg (resource-paths
   *  module is its own concern). */
  discoverRendererPluginManifest: (state: AgentHostState) => Promise<Array<{ moduleId: string; disabled?: boolean }>>;
}

export function installUnifiedPackages(deps: InstallUnifiedPackagesDeps): void {
  state = deps.state;
  discoverRendererPluginManifestImpl = deps.discoverRendererPluginManifest;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetUnifiedPackagesForTest(): void {
  state = null;
  discoverRendererPluginManifestImpl = async () => [];
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 把 profile 下的所有 package 合并成统一视图.
 * 每个 entry 标注已加载的 surface (bundle/pi/renderer/remote/typert/cordis)
 * 以及 health 状态.
 *
 * Throws if profile not initialized.
 */
export async function profilePackages(): Promise<ProfilePackageInfo[]> {
  if (!state) throw new Error("profile/unified-packages: not installed");
  if (!state.profileOptions) throw new Error("openbuddy-profile: profile is not initialized");
  const packages = await listProfilePackages(state.profileOptions);
  const profile = await readOpenBuddyProfile(state.profileOptions);
  const bundleNames = new Set(profile.bundles);
  const rendererEntries = await discoverRendererPluginManifestImpl(state);
  const piByPackage = new Map<string, PiExtensionStatus[]>();
  for (const extension of state.piExtensionStatuses) {
    if (!extension.packageName) continue;
    const rows = piByPackage.get(extension.packageName) ?? [];
    rows.push(extension);
    piByPackage.set(extension.packageName, rows);
  }
  return packages.map((entry) => {
    const loaded: UnifiedPluginSurfaceKind[] = [
      ...(entry.bundle && bundleNames.has(entry.name) ? ["bundle" as const] : []),
      ...(entry.pi && (piByPackage.get(entry.name) ?? []).some((extension) => extension.state === "loaded") ? ["pi" as const] : []),
      ...(entry.client && rendererEntries.some((renderer) => renderer.moduleId === entry.name && !renderer.disabled) ? ["renderer" as const] : []),
      ...(entry.remote && state!.profileRemoteContributions.has(entry.name) ? ["remote" as const] : []),
      ...(entry.typert && state!.profileTypertContributions.has(entry.name) ? ["typert" as const] : []),
      ...(entry.cordis && state!.deepSeekCordisSnapshot?.plugins.some((plugin) => plugin.name === entry.name && plugin.state === "active") ? ["cordis" as const] : []),
    ];
    const piFailed = (piByPackage.get(entry.name) ?? []).some((extension) => extension.state === "failed");
    return {
      ...entry,
      manifest: updateUnifiedPluginManifest(entry.manifest, {
        loaded,
        health: piFailed || entry.health === "degraded" ? "degraded" : "healthy",
      }),
    };
  });
}

// Re-export the discoverRendererPluginManifest signature for type-safe installation.
export { discoverRendererPluginManifestFn };
