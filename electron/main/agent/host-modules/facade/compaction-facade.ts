/**
 * host-modules/facade/compaction-facade.ts
 *
 * v6-G M1 (facade 化) — 把 agent-host.ts 中 12 个 compaction / session-control
 * forwarder 提取到独立 facade. 它们都遵循同一 deps 模式:
 *   { state, cwd: () => state.cwd ?? process.cwd(), piSessionDir }
 *
 * 反向依赖不变: 此模块不 import agent-host.ts (state 单例作为参数注入).
 */
import type { AgentHostState } from "../_state-shape";
import { piSessionDir } from "../_host-paths";
import {
  compactSession,
  setAutoCompactionEnabled,
  setAutoRetryEnabled,
  abortRetry,
  abortBash,
  setSteeringMode,
  setFollowUpMode,
  getSessionStats,
  getAvailableThinkingLevels,
  forkSession,
  getSessionTree,
  getCompactionSettings,
} from "../pi-session-capabilities";

function makeCwd(state: AgentHostState): () => string {
  return () => state.cwd ?? process.cwd();
}

export function buildCompactionFacade(state: AgentHostState) {
  const deps = { state, cwd: makeCwd(state), piSessionDir };
  return {
    compact: (customInstructions?: string) => compactSession(deps, customInstructions),
    setAutoCompaction: (enabled: boolean) => setAutoCompactionEnabled(deps, enabled),
    setAutoRetry: (enabled: boolean) => setAutoRetryEnabled(deps, enabled),
    abortRetry: () => abortRetry(deps),
    abortBash: () => abortBash(deps),
    setSteeringMode: (mode: "all" | "one-at-a-time") => setSteeringMode(deps, mode),
    setFollowUpMode: (mode: "all" | "one-at-a-time") => setFollowUpMode(deps, mode),
    getSessionStats: () => getSessionStats(deps),
    getAvailableThinkingLevels: (): string[] => getAvailableThinkingLevels(deps) as string[],
    forkSession: (entryId: string) => forkSession(deps, entryId),
    getSessionTree: () => getSessionTree(deps),
    getCompactionSettings: () => getCompactionSettings(deps),
  };
}
