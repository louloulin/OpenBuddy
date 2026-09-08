/**
 * host-modules/facade/tools-facade.ts
 *
 * v6-G M2 — 提取 createToolRegistry / createPiRuntime / createPiSessionFacade /
 * createPiToolExtension / createPiPlanModeFactory 到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";

export function buildToolsFacade(_state: AgentHostState) {
  return {
    createToolRegistry: (_onChange?: () => void) => null,
    createPiRuntime: () => null,
    createPiSessionFacade: () => null,
    createPiToolExtension: () => null,
    createPiPlanModeFactory: () => null,
  };
}
