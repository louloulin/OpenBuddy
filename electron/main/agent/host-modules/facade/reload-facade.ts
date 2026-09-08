/**
 * host-modules/facade/reload-facade.ts
 *
 * v6-G M2 — 提取 reloadProfile / captureReloadableContextServices /
 * restoreCapturedContextServices 到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";
import { reloadProfile as reloadProfileImpl } from "../_surface/reload-profile";
import {
  captureReloadableContextServices as captureReloadableContextServicesImpl,
  restoreCapturedContextServices as restoreCapturedContextServicesImpl,
} from "../context-services-snapshot";
import { scheduleProfileReload } from "../profile-reload-transaction";

export function buildReloadFacade(state: AgentHostState) {
  return {
    reloadProfile: async (): Promise<void> => reloadProfileImpl(state, scheduleProfileReload),
    captureReloadableContextServices: () => captureReloadableContextServicesImpl(),
    restoreCapturedContextServices: (captured: Map<string, unknown>) =>
      restoreCapturedContextServicesImpl(captured),
  };
}
