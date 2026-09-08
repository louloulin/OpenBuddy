/**
 * host-modules/facade/runtime-facade.ts
 *
 * v6-G M2 — piSessionRuntime / piRuntimeCoordinator 句柄 + lifecycle
 * queue helpers. PiSessionRuntime 是无参数 class, PiRuntimeCoordinator 需要
 * PiRuntimeCoordinatorOptions, 这里我们用 late-init: buildRuntimeFacade 返回
 * dispose/reload wrappers, 但 class instances 由 agent-host.ts 创建后注入.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { PiSessionRuntime } from "../../pi-session-runtime";
import type { PiRuntimeCoordinator } from "../../pi-runtime-coordinator";
import { enqueueLifecycle as enqueueLifecycleImpl } from "../lifecycle";

export interface RuntimeFacadeHandles {
  piSessionRuntime: PiSessionRuntime;
  piRuntimeCoordinator: PiRuntimeCoordinator;
}

export function buildRuntimeFacade(handles: RuntimeFacadeHandles) {
  return {
    enqueueLifecycle: <T>(operation: () => Promise<T>) => enqueueLifecycleImpl(operation),
    piSessionRuntimeDispose: () => handles.piSessionRuntime.dispose(),
    piRuntimeCoordinatorReload: (reason: string) =>
      handles.piRuntimeCoordinator.reload(reason),
  };
}
