/**
 * host-modules/facade/session-helpers-facade.ts
 *
 * v6-G M2 — 提取 isCurrentSessionPath / selectedProfileDirectory /
 * sessionPresetSelection / discoverRendererPluginManifest 等 session-helpers
 * 到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";

export function buildSessionHelpersFacade(_state: AgentHostState) {
  return {
    isCurrentSessionPath: (sessionPath: string | undefined, cwd: string | undefined): boolean =>
      sessionPath !== undefined && cwd !== undefined && sessionPath.startsWith(cwd),
    selectedProfileDirectory: (): string => {
      const profileOptions = _state.profileOptions;
      return profileOptions?.profileDir ?? "";
    },
  };
}
