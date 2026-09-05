/**
 * host-modules/bootstrap/profile-options.ts — profile path resolution.
 *
 * Phase 8.3 Batch L3: 从 agent-host.ts:initialize() 抽出 lines 2250-2263 (~14 行)。
 *
 *   - 读取 OPENBUDDY_PROFILE / PI_PROFILE / OPENBUDDY_PROFILE_DIR 环境变量
 *   - 计算 selectedProfileName + selectedProfileDir + profileHome
 *   - 组装 profileOptions 供 ensureOpenBuddyProfile / materializeOpenBuddyProfile 使用
 *
 * 设计:
 *   - 纯函数: 没有任何 module-level mutable, 接受 env 注入方便测试
 *   - 不调用 ensureOpenBuddyProfile / ensureDefaultPiPackages — 这些是 side-effect,
 *     留在 agent-host.ts 由调用方决定是否触发 (默认路径 + OPENBUDDY_INSTALL_DEFAULT_PI opt-in)
 *   - profileName 默认 "desktop", profileDir 默认 `<home>/profiles/<profileName>`
 *     — 与 plugin-host 的 defaultOpenBuddyProfileHome() 保持一致
 */

import { join, resolve } from "node:path";

import { defaultOpenBuddyProfileHome, type OpenBuddyProfileOptions } from "@openbuddy/plugin-host";

export interface ResolvedProfileOptions {
  /** Final profile name (env override or "desktop" default). */
  profileName: string;
  /** Absolute path to the profile directory (resolved). */
  profileDir: string;
  /** Original env-provided profileDir (may be undefined). */
  profileDirRaw: string | undefined;
  /** `<piHome>`-equivalent home directory for the plugin host. */
  home: string;
}

/**
 * Resolve profile options from environment variables + plugin-host defaults.
 *
 * Env precedence:
 *   - OPENBUDDY_PROFILE  → profileName  (preferred)
 *   - PI_PROFILE         → profileName  (legacy alias)
 *   - OPENBUDDY_PROFILE_DIR → profileDir (overrides home-relative resolution)
 *
 * @param env  process.env-like object (defaults to process.env for convenience)
 */
export function resolveProfileOptions(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedProfileOptions {
  const profileName = env.OPENBUDDY_PROFILE ?? env.PI_PROFILE;
  const profileDirRaw = env.OPENBUDDY_PROFILE_DIR;
  const profileHome = defaultOpenBuddyProfileHome();
  const selectedProfileName = profileName ?? "desktop";
  const selectedProfileDir = profileDirRaw
    ? resolve(profileDirRaw)
    : join(profileHome, "profiles", selectedProfileName);

  return {
    profileName: selectedProfileName,
    profileDir: selectedProfileDir,
    profileDirRaw,
    home: profileHome,
  };
}

/**
 * Compose the `OpenBuddyProfileOptions` object expected by
 * `ensureOpenBuddyProfile` / `materializeOpenBuddyProfile`.
 *
 * Thin wrapper around `resolveProfileOptions()` that projects into the
 * upstream type. Returns the slim shape that the plugin-host API consumes.
 */
export function bootstrapProfileOptions(
  env: NodeJS.ProcessEnv = process.env,
): OpenBuddyProfileOptions {
  const resolved = resolveProfileOptions(env);
  return {
    profileName: resolved.profileName,
    profileDir: resolved.profileDirRaw,
    home: resolved.home,
  };
}
