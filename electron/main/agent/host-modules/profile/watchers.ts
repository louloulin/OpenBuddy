/**
 * host-modules/profile/watchers.ts — profile watcher lifecycle domain.
 *
 * Phase 8.3 Batch: 从 agent-host.ts 抽出 profile 文件 watcher 生命周期
 * (2 个函数, ~70 行):
 *   - stopProfileWatchers   (clear reload timer + close watchers)
 *   - startProfileWatchers  (probe targets + attach FSWatchers)
 *
 * Architecture (DI, following plugin-runtime.ts):
 *   - 本模块 **零 agent-host 依赖**. 接受 `state: AgentHostState` 与
 *     `scheduleProfileReload`(回调) 以及 `profileResourceWatchPaths`(目标列表)
 *     作为参数注入. 不 import agent-host.
 *   - 纯读 `state.profileWatchers` / `state.profileReloadTimer`, 副作用只在
 *     `watch()`/`clearTimeout` 上, 便于测试构造空 state.
 */

import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import { type AgentHostState } from "../_state-shape";

export type ScheduleProfileReload = () => void;
export type ProfileResourceWatchPaths = () => string[];

/** Clear the pending reload timer and close all registered profile watchers. */
export function stopProfileWatchers(state: AgentHostState): void {
  if (state.profileReloadTimer) clearTimeout(state.profileReloadTimer);
  state.profileReloadTimer = null;
  for (const watcher of state.profileWatchers) watcher.close();
  state.profileWatchers = [];
}

/**
 * Re-start directory/file watchers over every profile resource path.
 * Probes each target asynchronously so the main-process event loop stays
 * free during profile reloads; `watch()` failures are non-fatal.
 */
export async function startProfileWatchers(
  state: AgentHostState,
  scheduleProfileReload: ScheduleProfileReload,
  profileResourceWatchPaths: ProfileResourceWatchPaths,
): Promise<void> {
  stopProfileWatchers(state);
  const targets = profileResourceWatchPaths();
  const probes = await Promise.all(
    targets.map(async (target) => {
      try {
        const stats = await stat(target);
        return { target, stats };
      } catch {
        return { target, stats: null };
      }
    }),
  );
  for (const { target, stats } of probes) {
    if (!stats) continue;
    try {
      const watcher = watch(target, { persistent: false, recursive: stats.isDirectory() }, () => scheduleProfileReload());
      // Node's recursive watcher scans the tree and re-scans on change. If the
      // tree disappears (uninstall, temp cleanup, or Windows EBUSY/EPERM while
      // the indexer holds it) the watcher emits `error`. An EventEmitter with
      // no `error` listener throws — an uncaught exception that takes down the
      // whole process. Watch failures are documented as non-fatal, so log and
      // close instead of letting it escape.
      watcher.on("error", (error) => {
        console.warn(`[openbuddy] profile watcher for ${target} failed; closing:`, error);
        try { watcher.close(); } catch { /* already closed */ }
      });
      state.profileWatchers.push(watcher);
    } catch (error) {
      console.warn(`[openbuddy] failed to watch ${target}:`, error);
    }
  }
}
