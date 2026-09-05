/**
 * host-modules/lifecycle.ts — lifecycle queue helpers.
 *
 * Stage F-1: 从 agent-host.ts:416, 418, 448-455 抽出。lifecycle tail-queue
 * (串行化长任务) + initialisationPromise 跟踪集中到子模块,避免 agent-host.ts
 * 顶层散落 mutable 单例。
 *
 * Phase 8.3 Architectural Refactor — DI:
 *   - 修复前: `import { state } from "../agent-host"` (reverse dep)
 *   - 修复后: 整个文件零 agent-host 导入。`piRuntimeCoordinator` 实例
 *     仍由 agent-host.ts 持有 (因为 agent-host.ts 需要 await 它的 reload()),
 *     本模块只承担 lifecycle 队列职责。
 *
 * 设计: 保留 mutable + module-global 单例语义 (Electron main 进程本身只有
 * 一个实例, 进程级单例是合理的)。
 */

let lifecycleTail: Promise<void> = Promise.resolve();
let initialisationPromise: Promise<void> | null = null;

/**
 * Append an async operation to the serial lifecycle tail-queue. Each call
 * sees the prior operation's settled state (success OR failure), so sequential
 * lifecycle events (profile reload → resource refresh → renderer sync) execute
 * in deterministic order without manual promise chaining.
 *
 * Used by: agent-host.ts:dispose(), agent-host.ts:initialize(),
 *          agent-host.ts:scheduleProfileReload(), …
 */
export function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const run = lifecycleTail.then(operation, operation);
  lifecycleTail = run.then(() => undefined, () => undefined);
  return run;
}

export function getInitialisationPromise(): Promise<void> | null {
  return initialisationPromise;
}

export function setInitialisationPromise(promise: Promise<void> | null): void {
  initialisationPromise = promise;
}
