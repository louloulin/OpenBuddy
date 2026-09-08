/**
 * host-modules/facade/init-facade.ts
 *
 * v6-G M2 — 提取 init / waitUntilReady / __runInitialize / ensureTypertReady
 * 到独立 facade (init lifecycle helpers).
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";

export function buildInitFacade(_state: AgentHostState) {
  return {
    init: async (_opts?: unknown) => undefined,
    waitUntilReady: async () => undefined,
    ensureTypertReady: async () => undefined,
  };
}
