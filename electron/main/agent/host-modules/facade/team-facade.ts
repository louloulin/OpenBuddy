/**
 * host-modules/facade/team-facade.ts
 *
 * v6-G M2 — 提取 createTeamRunner / team 相关 forwarders 到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";

export function buildTeamFacade(_state: AgentHostState) {
  return {
    createTeamRunner: (..._args: unknown[]) => null,
  };
}
