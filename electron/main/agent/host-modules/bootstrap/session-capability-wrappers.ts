/**
 * host-modules/bootstrap/session-capability-wrappers.ts
 *
 * v6-G M1 收尾: 抽取 agent-host.ts 的 12 个 thin "session capability"
 * 转发 wrapper (compact / setAutoCompaction / setAutoRetry / abortRetry /
 * abortBash / setSteeringMode / setFollowUpMode / getSessionStats /
 * getAvailableThinkingLevels / forkSession / getSessionTree /
 * getCompactionSettings). 原 inline ~36 行都是 `deps = { state, cwd,
 * piSessionDir }` 重复模式, 提到独立文件后 agent-host.ts 用一行 import
 * + spread 替代.
 *
 * 依赖: state / piSessionDir 是从 agent-host.ts 注入的 closure; 这些
 * 函数原本就是 facade 内联 closure 的薄包装, 不涉及 module-level 状态.
 *
 * 反向依赖不变量: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";
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

export interface SessionCapabilityDeps {
  state: AgentHostState;
  piSessionDir: (cwd: string) => string;
}

export function buildSessionCapabilityWrappers(deps: SessionCapabilityDeps) {
  const ctx = () => ({ state: deps.state, cwd: () => deps.state.cwd ?? process.cwd(), piSessionDir: deps.piSessionDir });
  return {
    compact: (customInstructions?: string) => compactSession(ctx(), customInstructions),
    setAutoCompaction: (enabled: boolean) => setAutoCompactionEnabled(ctx(), enabled),
    setAutoRetry: (enabled: boolean) => setAutoRetryEnabled(ctx(), enabled),
    abortRetry: () => abortRetry(ctx()),
    abortBash: () => abortBash(ctx()),
    setSteeringMode: (mode: "all" | "one-at-a-time") => setSteeringMode(ctx(), mode),
    setFollowUpMode: (mode: "all" | "one-at-a-time") => setFollowUpMode(ctx(), mode),
    getSessionStats: () => getSessionStats(ctx()),
    getAvailableThinkingLevels: () => getAvailableThinkingLevels(ctx()) as string[],
    forkSession: (entryId: string) => forkSession(ctx(), entryId),
    getSessionTree: () => getSessionTree(ctx()),
    getCompactionSettings: () => getCompactionSettings(ctx()),
  };
}
