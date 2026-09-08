/**
 * host-modules/facade/hooks-facade.ts
 *
 * v6-G M2 — 提取 requestHookPermission / hookProcess lifecycle helpers.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import { requestHookPermission as requestHookPermissionImpl } from "../hook-permission";

export function buildHooksFacade() {
  return {
    requestHookPermission: (title: string, message: string, request?: unknown) =>
      requestHookPermissionImpl(title, message, request as never),
    disposeActiveHookProcesses: () => undefined,
    drainActiveHookProcesses: () => undefined,
  };
}
