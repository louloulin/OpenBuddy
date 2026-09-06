/**
 * host-modules/profile/renderer-manifest.ts — renderer-plugin manifest
 * discovery domain.
 *
 * Phase 8.3 Batch: 从 agent-host.ts 抽出 renderer manifest **发现**路径
 * (2 个函数, ~65 行):
 *   - discoverRendererPluginManifest          (cache + stale retry)
 *   - discoverRendererPluginManifestUncached  (loader + builtin deepseek entries)
 *
 * Architecture (DI, following plugin-runtime.ts):
 *   - 本模块 **零 agent-host 依赖**. 只接受 `state: AgentHostState` 与
 *     `profileArtifactModuleUrl` 作为参数, 由 agent-host 注入.
 *   - `profileArtifactModuleUrl` 依赖 `state.profileArtifactGeneration` (在
 *     agent-host 定义), 因此作为参数传入而非 import, 维持模块纯净.
 *   - 调用方 agent-host.ts 持有 state 单例, 保留 0-arg `export` 包装并注入.
 */

import {
  discoverRendererPluginEntries,
  type RendererPluginManifestEntry,
} from "@openbuddy/plugin-host";
import { openBuddyDeepSeekRendererEntries } from "@openbuddy/bundle-base";

import { type AgentHostState } from "../_state-shape";
import { artifactPackageJsonByName } from "./paths";
import { createProfileArtifactResolvers } from "../../profile-artifact-resolution";

/** Convert a resolved profile artifact path into a reload-scoped module URL. */
export type ProfileArtifactModuleUrl = (path: string) => string;

/**
 * Discover all renderer-plugin manifest entries, coalescing concurrent
 * requests per profile-generation and clearing a stale cache on failure.
 * Mirrors agent-host.ts:discoverRendererPluginManifest signature.
 */
export async function discoverRendererPluginManifest(
  state: AgentHostState,
  profileArtifactModuleUrl: ProfileArtifactModuleUrl,
): Promise<RendererPluginManifestEntry[]> {
  const cached = state.rendererPluginManifestCache;
  if (cached && cached.generation === state.profileArtifactGeneration) return cached.promise;
  const generation = state.profileArtifactGeneration;
  const promise = discoverRendererPluginManifestUncached(state, profileArtifactModuleUrl);
  state.rendererPluginManifestCache = { generation, promise };
  try {
    return await promise;
  } catch (error) {
    if (state.rendererPluginManifestCache?.promise === promise) state.rendererPluginManifestCache = null;
    throw error;
  }
}

/**
 * Loader-based discovery plus built-in DeepSeek client entries (deduped by id).
 * Pure read of `state`; cache management is the caller's (discoverRendererPluginManifest).
 */
export async function discoverRendererPluginManifestUncached(
  state: AgentHostState,
  profileArtifactModuleUrl: ProfileArtifactModuleUrl,
): Promise<RendererPluginManifestEntry[]> {
  const loader = state.loader;
  if (!loader) return [];
  const additionalPackageJson = await artifactPackageJsonByName(state.profilePackagePaths, state.cwd);
  const additionalPackages = [...additionalPackageJson.keys()];
  const resolvers = createProfileArtifactResolvers({
    packageJsonByName: additionalPackageJson,
    profilePackageJson: state.profilePackageJson,
  });
  const discovered = await discoverRendererPluginEntries(
    [...loader.entries()].map((entry) => entry.options),
    {
      additionalPackages,
      resolvePackageJson: resolvers.resolvePackageJson,
      resolveModule: async (specifier, packageJson) => profileArtifactModuleUrl(await resolvers.resolveModule(specifier, packageJson)),
    },
  );
  const existing = new Set(discovered.map((entry) => entry.id));
  const builtinClientEntries: RendererPluginManifestEntry[] = openBuddyDeepSeekRendererEntries.map((entry) => ({
    id: entry.id,
    moduleId: entry.name,
    moduleKey: entry.id,
    name: entry.name,
    ...(Array.isArray(entry.inject) ? { inject: [...entry.inject] } : {}),
    moduleUrl: `openbuddy:static/${entry.id}`,
  }));
  return [...discovered, ...builtinClientEntries.filter((entry) => !existing.has(entry.id))];
}
