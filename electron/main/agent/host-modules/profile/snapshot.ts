/**
 * host-modules/profile/snapshot.ts — PiProfileSnapshot capture/restore.
 *
 * Stage F-2: 从 agent-host.ts:1664-1748 抽出。`state` 是 module-level
 * mutable 单例(由 agent-host.ts re-export),`capturePiProfileSnapshot`
 * 与 `restorePiProfileSnapshot` 是 reload-pipeline 的两个纯函数钩子,
 * 保留在 facade agent-host.ts 的 `init()` 内调用,但实现迁到这里。
 *
 * 设计:
 *   - 整个模块只有 2 个 export function + 1 个 export type
 *   - 没有顶层副作用,没有 module-level mutable
 *   - restorePiProfileSnapshot 通过 setProfilePiResourcePaths 保持
 *     与原版相同的行为(它会把 profile 路径拷贝/过滤到 piNativeResourcePaths
 *     并触发 syncPiNativeResourcePaths)
 */

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { OpenBuddyPiExtensionSpec, PluginProfile } from "@openbuddy/plugin-host";
import type { HookRuntimeConfig } from "../../agent-hooks";
import type { PiExtensionStatus } from "../../pi-extensions";

// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { setProfilePiResourcePaths, state } from "../../agent-host"` (reverse dep)
//   修复后: 通过 installProfileSnapshot() 一次性注入, 本模块零 agent-host 导入.
import { type AgentHostState } from "../_state-shape";

let state: AgentHostState;
let setProfilePiResourcePaths: (paths: {
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
}) => void;

/**
 * Bind profile-snapshot dependencies. Called once from
 * agent-host.ts:initialize(). Idempotent.
 */
export function installProfileSnapshot(deps: {
  state: AgentHostState;
  setProfilePiResourcePaths: (paths: {
    extensions: string[];
    skills: string[];
    prompts: string[];
    themes: string[];
  }) => void;
}): void {
  state = deps.state;
  setProfilePiResourcePaths = deps.setProfilePiResourcePaths;
}

export type PiProfileSnapshot = {
  profilePackageJson: string | undefined;
  profilePackagePaths: string[];
  profileBundle: PluginProfile | null;
  activePluginProfile: PluginProfile | null;
  profilePiExtensions: readonly OpenBuddyPiExtensionSpec[];
  profilePiPackagePaths: string[];
  profilePiResourcePaths: {
    extensions: string[];
    skills: string[];
    prompts: string[];
    themes: string[];
  };
  piNativeResourcePaths: {
    skills: string[];
    prompts: string[];
    themes: string[];
  };
  piMarketplaceResourcePaths: {
    extensions: string[];
    skills: string[];
    prompts: string[];
    themes: string[];
  };
  piMarketplaceAgentFiles: Array<{ path: string; content: string }>;
  piExtensionPaths: string[];
  piExtensionFactories: Array<{ name: string; factory: ExtensionFactory; hidden: true }>;
  hookConfigs: HookRuntimeConfig[];
  piExtensionStatuses: PiExtensionStatus[];
};

export function capturePiProfileSnapshot(): PiProfileSnapshot {
  return {
    profilePackageJson: state.profilePackageJson,
    profilePackagePaths: [...state.profilePackagePaths],
    profileBundle: state.profileBundle,
    activePluginProfile: state.activePluginProfile,
    profilePiExtensions: [...state.profilePiExtensions],
    profilePiPackagePaths: [...state.profilePiPackagePaths],
    profilePiResourcePaths: {
      extensions: [...state.profilePiResourcePaths.extensions],
      skills: [...state.profilePiResourcePaths.skills],
      prompts: [...state.profilePiResourcePaths.prompts],
      themes: [...state.profilePiResourcePaths.themes],
    },
    piNativeResourcePaths: {
      skills: [...state.piNativeResourcePaths.skills],
      prompts: [...state.piNativeResourcePaths.prompts],
      themes: [...state.piNativeResourcePaths.themes],
    },
    piMarketplaceResourcePaths: {
      extensions: [...state.piMarketplaceResourcePaths.extensions],
      skills: [...state.piMarketplaceResourcePaths.skills],
      prompts: [...state.piMarketplaceResourcePaths.prompts],
      themes: [...state.piMarketplaceResourcePaths.themes],
    },
    piMarketplaceAgentFiles: state.piMarketplaceAgentFiles.map((file) => ({ ...file })),
    piExtensionPaths: [...state.piExtensionPaths],
    piExtensionFactories: [...state.piExtensionFactories],
    hookConfigs: [...state.hookConfigs],
    piExtensionStatuses: state.piExtensionStatuses.map((status) => ({ ...status })),
  };
}

export function restorePiProfileSnapshot(snapshot: PiProfileSnapshot): void {
  state.profilePackageJson = snapshot.profilePackageJson;
  state.profilePackagePaths.splice(
    0,
    state.profilePackagePaths.length,
    ...snapshot.profilePackagePaths,
  );
  state.profileBundle = snapshot.profileBundle;
  state.activePluginProfile = snapshot.activePluginProfile;
  state.profilePiExtensions = [...snapshot.profilePiExtensions];
  state.profilePiPackagePaths.splice(
    0,
    state.profilePiPackagePaths.length,
    ...snapshot.profilePiPackagePaths,
  );
  setProfilePiResourcePaths(snapshot.profilePiResourcePaths);
  state.piNativeResourcePaths.skills.splice(
    0,
    state.piNativeResourcePaths.skills.length,
    ...snapshot.piNativeResourcePaths.skills,
  );
  state.piNativeResourcePaths.prompts.splice(
    0,
    state.piNativeResourcePaths.prompts.length,
    ...snapshot.piNativeResourcePaths.prompts,
  );
  state.piNativeResourcePaths.themes.splice(
    0,
    state.piNativeResourcePaths.themes.length,
    ...snapshot.piNativeResourcePaths.themes,
  );
  state.piMarketplaceResourcePaths.extensions.splice(
    0,
    state.piMarketplaceResourcePaths.extensions.length,
    ...snapshot.piMarketplaceResourcePaths.extensions,
  );
  state.piMarketplaceResourcePaths.skills.splice(
    0,
    state.piMarketplaceResourcePaths.skills.length,
    ...snapshot.piMarketplaceResourcePaths.skills,
  );
  state.piMarketplaceResourcePaths.prompts.splice(
    0,
    state.piMarketplaceResourcePaths.prompts.length,
    ...snapshot.piMarketplaceResourcePaths.prompts,
  );
  state.piMarketplaceResourcePaths.themes.splice(
    0,
    state.piMarketplaceResourcePaths.themes.length,
    ...snapshot.piMarketplaceResourcePaths.themes,
  );
  state.piMarketplaceAgentFiles.splice(
    0,
    state.piMarketplaceAgentFiles.length,
    ...snapshot.piMarketplaceAgentFiles.map((file) => ({ ...file })),
  );
  state.piExtensionPaths.splice(0, state.piExtensionPaths.length, ...snapshot.piExtensionPaths);
  state.piExtensionFactories.splice(
    0,
    state.piExtensionFactories.length,
    ...snapshot.piExtensionFactories,
  );
  state.hookConfigs.splice(0, state.hookConfigs.length, ...snapshot.hookConfigs);
  state.piExtensionStatuses = snapshot.piExtensionStatuses.map((status) => ({ ...status }));
}