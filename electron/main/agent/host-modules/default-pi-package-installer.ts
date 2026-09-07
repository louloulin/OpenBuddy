/**
 * host-modules/default-pi-package-installer.ts — `agentHost.installDefaultPiPackages()`.
 *
 * Phase v4 §L-15: extract agent-host.ts:903-910 (~7 行) 到独立 host-module.
 *
 * 安装"默认 Pi 包" (curated default Pi bundle) 到当前 profile.
 * 通过 `OPENBUDDY_INSTALL_DEFAULT_PI=1` 开关触发, 允许在 boot 时可选安装.
 * Returns per-package status list (installed / skipped / failed).
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 外部依赖通过 install 注入 (state + ensureDefaultPiPackages)
 *
 * 设计: 沿用 module-level singleton + install pattern.
 */

import { ensureDefaultPiPackages, type DefaultPiPackageResult } from "@openbuddy/plugin-host";
import { type AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallDefaultPiPackageInstallerDeps {
  state: AgentHostState;
}

export function installDefaultPiPackageInstaller(deps: InstallDefaultPiPackageInstallerDeps): void {
  state = deps.state;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetDefaultPiPackageInstallerForTest(): void {
  state = null;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 安装默认 Pi 包到当前 profile.
 * Throws if profile not initialized.
 *
 * 默认 boot 路径不调用 (受 `OPENBUDDY_INSTALL_DEFAULT_PI=1` 环境变量控制),
 * 用于 renderer 通过 IPC 触发 (OpenBuddyConfigPanel "Enable Default Pi Bundle").
 */
export async function installDefaultPiPackages(options?: { force?: boolean }): Promise<DefaultPiPackageResult[]> {
  if (!state) throw new Error("default-pi-package-installer: not installed");
  if (!state.profileOptions) throw new Error("openbuddy-profile: profile is not initialized");
  const results = await ensureDefaultPiPackages({
    ...state.profileOptions,
    force: options?.force === true,
  });
  return results;
}
