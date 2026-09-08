/**
 * host-modules/profile/resource-paths.ts — Pi native resource path management.
 *
 * Phase v4 §L-2: extract agent-host.ts:684-766 的资源路径管理 cluster (~55 行)
 * 到一个独立 host-module. 这一组函数围绕 `state.profilePiResourcePaths` /
 * `state.piMarketplaceResourcePaths` / `state.piNativeResourcePaths` 三组数组
 * 共同维护 Pi extension / skill / prompt / theme 的"effective path 列表".
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - `state` 通过 install 注入 (state 已存在)
 *   - 外部依赖 (piResources, isPathWithin, toModuleUrl) 通过 deps 注入
 *
 * 设计: 沿用 module-level singleton + install pattern — 与 plugin-mutations,
 * session-rebind, profile-reload-transaction, session-swap 保持一致.
 */

import * as piResources from "../../pi-resources";
import { type AgentHostState } from "../_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;
let isPathWithinImpl: (root: string, candidate: string) => boolean = () => false;
let toModuleUrlImpl: (path: string) => string = (p) => p;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallProfileResourcePathsDeps {
  state: AgentHostState;
  /** _host-paths.isPathWithin */
  isPathWithin: (root: string, candidate: string) => boolean;
  /** profile-artifact-resolution.toModuleUrl */
  toModuleUrl: (path: string) => string;
}

export function installProfileResourcePaths(deps: InstallProfileResourcePathsDeps): void {
  if (deps.state) state = deps.state;
  if (deps.isPathWithin) isPathWithinImpl = deps.isPathWithin;
  if (deps.toModuleUrl) toModuleUrlImpl = deps.toModuleUrl;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetProfileResourcePathsForTest(): void {
  state = null;
  isPathWithinImpl = () => false;
  toModuleUrlImpl = (p) => p;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

export interface ProfileResourcePaths {
  extensions: readonly string[];
  skills: readonly string[];
  prompts: readonly string[];
  themes: readonly string[];
}

/**
 * 把"profile 自带的" Pi 资源路径灌入 state, 同步到 `piNativeResourcePaths`.
 * 内部 splice 不重分配数组 (state 上的引用保持稳定).
 */
export function setProfilePiResourcePaths(paths: ProfileResourcePaths): void {
  if (!state) throw new Error("profile/resource-paths: not installed");
  state.profilePiResourcePaths.extensions.splice(0, state.profilePiResourcePaths.extensions.length, ...paths.extensions);
  state.profilePiResourcePaths.skills.splice(0, state.profilePiResourcePaths.skills.length, ...paths.skills);
  state.profilePiResourcePaths.prompts.splice(0, state.profilePiResourcePaths.prompts.length, ...paths.prompts);
  state.profilePiResourcePaths.themes.splice(0, state.profilePiResourcePaths.themes.length, ...paths.themes);
  syncPiNativeResourcePaths();
}

/**
 * 从 marketplace 重新扫描 Pi 资源路径, 灌入 state.piMarketplaceResourcePaths
 * 并触发 syncPiNativeResourcePaths 合并.
 */
export async function refreshMarketplacePiResourcePaths(): Promise<void> {
  if (!state) throw new Error("profile/resource-paths: not installed");
  const resources = await piResources.listPiPluginResourcePaths(state.cwd);
  const agentFiles = await piResources.listPiPluginAgentFiles(state.cwd);
  const next = {
    extensions: resources.flatMap((entry) => entry.extensions),
    skills: resources.flatMap((entry) => entry.skills),
    prompts: resources.flatMap((entry) => entry.prompts),
    themes: resources.flatMap((entry) => entry.themes),
  };
  state.piMarketplaceResourcePaths.extensions.splice(0, state.piMarketplaceResourcePaths.extensions.length, ...new Set(next.extensions));
  state.piMarketplaceResourcePaths.skills.splice(0, state.piMarketplaceResourcePaths.skills.length, ...new Set(next.skills));
  state.piMarketplaceResourcePaths.prompts.splice(0, state.piMarketplaceResourcePaths.prompts.length, ...new Set(next.prompts));
  state.piMarketplaceResourcePaths.themes.splice(0, state.piMarketplaceResourcePaths.themes.length, ...new Set(next.themes));
  state.piMarketplaceAgentFiles.splice(0, state.piMarketplaceAgentFiles.length, ...agentFiles.map(({ path, content }) => ({ path, content })));
  syncPiNativeResourcePaths();
}

/**
 * 把 profile + marketplace 资源路径合并并去重, 写回 state.piNativeResourcePaths.
 * profile 包内部声明的 resource 自动从 marketplace 列表里剔除 (避免重复).
 */
function syncPiNativeResourcePaths(): void {
  if (!state) return;
  const merge = (profilePaths: readonly string[], marketplacePaths: readonly string[]) => [...new Set([...profilePaths, ...marketplacePaths])];
  const profilePackageRoots = state.profilePiPackagePaths;
  const omitAutoDiscovered = (resourcePaths: readonly string[]) => resourcePaths.filter((path) =>
    !profilePackageRoots.some((packageRoot) => isPathWithinImpl(packageRoot, path)));
  state.piNativeResourcePaths.skills.splice(0, state.piNativeResourcePaths.skills.length, ...merge(state.profilePiResourcePaths.skills, state.piMarketplaceResourcePaths.skills));
  state.piNativeResourcePaths.prompts.splice(0, state.piNativeResourcePaths.prompts.length, ...merge(omitAutoDiscovered(state.profilePiResourcePaths.prompts), state.piMarketplaceResourcePaths.prompts));
  state.piNativeResourcePaths.themes.splice(0, state.piNativeResourcePaths.themes.length, ...merge(omitAutoDiscovered(state.profilePiResourcePaths.themes), state.piMarketplaceResourcePaths.themes));
}

/** 为 `ResourceLoader` 提供 native Pi 路径 (skills / prompts / themes). */
export function nativePiResourcePaths(): {
  additionalSkillPaths: string[];
  additionalPromptTemplatePaths: string[];
  additionalThemePaths: string[];
} {
  if (!state) throw new Error("profile/resource-paths: not installed");
  return {
    additionalSkillPaths: state.piNativeResourcePaths.skills,
    additionalPromptTemplatePaths: state.piNativeResourcePaths.prompts,
    additionalThemePaths: state.piNativeResourcePaths.themes,
  };
}

/**
 * 把一个 profile artifact 路径包成 module URL, 带 `openbuddy_profile_reload`
 * query string 让 cache busting 在 profile reload 时生效.
 */
export function profileArtifactModuleUrl(path: string): string {
  if (!state) throw new Error("profile/resource-paths: not installed");
  const url = new URL(toModuleUrlImpl(path));
  url.searchParams.set("openbuddy_profile_reload", String(state.profileArtifactGeneration));
  return url.href;
}
