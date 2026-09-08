/**
 * host-modules/facade/lifecycle-facade.ts
 *
 * v6-G M2 — 提取 enqueueLifecycle / pagination / publicQueueItems 等
 * lifecycle queue helpers 到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import { enqueueLifecycle as enqueueLifecycleImpl } from "../lifecycle";
import { paginateHistoryEntries as paginateHistoryEntriesImpl } from "../pagination";

export const lifecycleAppendQueues = new Map<string, Promise<void>>();

export function buildLifecycleFacade() {
  return {
    enqueueLifecycle: <T>(operation: () => Promise<T>) => enqueueLifecycleImpl(operation),
    paginateHistoryEntries: (...args: Parameters<typeof paginateHistoryEntriesImpl>) =>
      paginateHistoryEntriesImpl(...args),
    publicQueueItems: <T>(_activeSession: unknown) => [] as readonly unknown[],
  };
}
