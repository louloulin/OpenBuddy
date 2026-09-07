/**
 * host-modules/_surface/reload-profile.ts
 *
 * v7-A — Profile reload pipeline (scheduleProfileReload + grace delay + await).
 *
 * 背景:
 *   agent-host.ts:436-441 的 reloadProfile() 是 3 步流水线:
 *     1. scheduleProfileReload() — 触发 profile reloader signal
 *     2. setTimeout(160ms)       — 给 file watcher 100ms+ 事件聚合窗口
 *     3. await profileReloadPromise — 等待 in-flight reload 完成
 *
 *   这 3 步顺序对 race condition 很敏感: 调短 160ms 会丢事件, 调长会卡
 *   renderer, 必须放在同一个 awaitable 函数里.
 *
 * 设计:
 *   - 接受 state 参数 + scheduleProfileReload callback (DI)
 *   - 160ms grace 是「已知妥协」, 注释里解释为何不动态探测
 *   - 纯 awaitable, 易测试
 *
 * v7-A 收益: agent-host.ts -6 行, 3 步流水线独立可测试.
 */

import type { AgentHostState } from "../_state-shape";

const RELOAD_GRACE_MS = 160;

export async function reloadProfile(
  state: Pick<AgentHostState, "profileReloadPromise">,
  scheduleProfileReload: () => void,
): Promise<void> {
  scheduleProfileReload();
  // File-watcher debounce grace window. 100ms is the standard fs.watch latency
  // on Linux/macOS; we add 60ms for the event aggregator in profile-loader
  // to coalesce multi-file saves (extensions/ + skills/ + prompts/ + themes/).
  // Dynamically probing this window would require recursive reload attempts
  // and double the cold-start time, so we hard-code for now.
  await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, RELOAD_GRACE_MS));
  await state.profileReloadPromise;
}
