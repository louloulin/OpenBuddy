/**
 * host-modules/profile/marketplace-status.ts — marketplace Pi extension
 * status sync domain.
 *
 * Phase 8.3 Batch: 从 agent-host.ts 抽出 marketplace Pi extension 状态同步
 * (syncMarketplacePiExtensionStatuses, ~82 行):
 *   - list 已安装插件, 匹配 status 到 marketplace/profile roots
 *   - 标记 user-disabled 插件 (degraded + disabledReason)
 *   - 为 disabled 但有 `extensions/` 目录的插件补建 status 条目
 *
 * Architecture (DI):
 *   - 本模块 **零 agent-host 依赖**. 接受 `state: AgentHostState` + 注入
 *     `listPlugins`(默认 pi-resources.listPlugins) + `resolveBaseDir`.
 *   - 不 import agent-host; `isPathWithin` 从 _host-paths 取, 保持单一来源.
 */

import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { listPlugins } from "../../pi-resources";
import { isPathWithin } from "../_host-paths";
import type { PiExtensionStatus } from "../../pi-extensions";
import type { AgentHostState } from "../_state-shape";

/**
 * Reconcile `state.piExtensionStatuses` against the actually-installed
 * marketplace plugins. Mirrors agent-host.ts:syncMarketplacePiExtensionStatuses.
 */
export async function syncMarketplacePiExtensionStatuses(
  state: AgentHostState,
  listPluginsFn: (cwd?: string | null) => Promise<Awaited<ReturnType<typeof listPlugins>>> = listPlugins,
): Promise<void> {
  const plugins = await listPluginsFn(state.cwd);
  const marketplaceRoots = new Set(plugins.map((plugin) => resolve(plugin.root)));
  const profileRoots = new Set([...state.profilePackagePaths, ...state.profilePiPackagePaths].map((path) => resolve(path)));
  state.piExtensionStatuses = state.piExtensionStatuses.map((status) => {
    const root = status.sourceBaseDir ? resolve(status.sourceBaseDir) : undefined;
    const plugin = plugins.find((entry) => root === resolve(entry.root) || (status.source ? isPathWithin(entry.root, status.source) : false));
    if (!plugin) return status;
    if (!plugin.enabled) {
      return {
        ...status,
        state: "disabled" as const,
        managed: true,
        packageName: plugin.name,
        ...(plugin.version ? { version: plugin.version } : {}),
        sourceScope: plugin.scope,
        sourceOrigin: "package" as const,
        sourceBaseDir: plugin.root,
        health: "degraded" as const,
        disabledReason: "user" as const,
        commands: [],
        toolCount: 0,
        error: undefined,
      };
    }
    const nextStatus: PiExtensionStatus = {
      ...status,
      managed: true,
      packageName: plugin.name,
      ...(plugin.version ? { version: plugin.version } : {}),
      sourceScope: plugin.scope,
      sourceOrigin: "package" as const,
      sourceBaseDir: plugin.root,
      health: status.health ?? (status.state === "failed" ? "failed" : "healthy"),
    };
    return nextStatus;
  }).filter((status) => {
    if (!status.sourceBaseDir) return true;
    const root = resolve(status.sourceBaseDir);
    if (profileRoots.has(root)) return true;
    if (marketplaceRoots.has(root)) return true;
    return status.managed === false;
  });
  // Stat each disabled plugin's `extensions/` directory in parallel rather
  // than serially through `statSync`, which would block the main-process
  // event loop on every startup.
  const disabledPlugins = plugins.filter((entry) => !entry.enabled);
  const extensionsPresence = await Promise.all(
    disabledPlugins.map(async (plugin) => {
      const packageRoot = resolve(plugin.root);
      let isDir = false;
      try {
        isDir = (await stat(join(packageRoot, "extensions"))).isDirectory();
      } catch {
        isDir = false;
      }
      return { plugin, packageRoot, hasExtensions: isDir };
    }),
  );
  for (const { plugin, packageRoot, hasExtensions } of extensionsPresence) {
    if (!hasExtensions || state.piExtensionStatuses.some((status) => status.sourceBaseDir && resolve(status.sourceBaseDir) === packageRoot)) continue;
    state.piExtensionStatuses.push({
      id: plugin.id ?? plugin.name,
      name: plugin.name,
      kind: "pi",
      state: "disabled",
      source: packageRoot,
      builtIn: false,
      managed: true,
      packageName: plugin.name,
      sourceScope: plugin.scope,
      sourceOrigin: "package",
      sourceBaseDir: packageRoot,
      health: "degraded",
      disabledReason: "user",
      commands: [],
      toolCount: 0,
      hookCount: plugin.hookCount,
    });
  }
}
