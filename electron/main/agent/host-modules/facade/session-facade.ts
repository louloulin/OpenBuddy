/**
 * host-modules/facade/session-facade.ts
 *
 * v6-G M1 (facade 化) — 把 agent-host.ts 中 ~30 个 session-related
 * forwarder 提取到独立 facade (CRUD + metadata + subagent).
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";
import {
  renameSession as renameSessionImpl,
  deleteSession as deleteSessionImpl,
  loadSession as loadSessionImpl,
  sessionInfo as sessionInfoImpl,
  sessionUsage as sessionUsageImpl,
  sessionFile as sessionFileImpl,
  rewindSession as rewindSessionImpl,
} from "../session-store";
import {
  listSessions as listSessionsImpl,
  updateSessionMetadata as updateSessionMetadataImpl,
  clearSessionMetadata as clearSessionMetadataImpl,
  setSessionArchived as setSessionArchivedImpl,
  setAllArchived as setAllArchivedImpl,
  setSessionExpert as setSessionExpertImpl,
  setSessionPinned as setSessionPinnedImpl,
} from "../session-metadata";
import {
  listSubagentChildren as listSubagentChildrenImpl,
  listSessionJobs as listSessionJobsImpl,
  subagentHistory as subagentHistoryImpl,
  promptSubagent as promptSubagentImpl,
  interruptSubagent as interruptSubagentImpl,
  killTask as killTaskImpl,
  inspirationGenerate as inspirationGenerateImpl,
} from "../subagent-runtime";

export function buildSessionFacade(_state: AgentHostState) {
  return {
    // --- session CRUD ---
    renameSession: (sessionId: string, title: string, cwd: string) => renameSessionImpl(sessionId, title, cwd),
    deleteSession: (sessionId: string, cwd: string) => deleteSessionImpl(sessionId, cwd),
    listSessions: (cwd: string) => listSessionsImpl(cwd),
    loadSession: (sessionId: string, cwd: string, options?: { traceId?: string; sessionId?: string }) =>
      loadSessionImpl(sessionId, cwd, options),
    sessionInfo: (sessionId: string) => sessionInfoImpl(sessionId),
    sessionUsage: (sessionId: string) => sessionUsageImpl(sessionId),
    sessionFile: (sessionId: string) => sessionFileImpl(sessionId),
    rewindSession: (sessionId: string, targetPromptIndex: number, mode = "conversation") =>
      rewindSessionImpl(sessionId, targetPromptIndex, mode),
    // --- session metadata ---
    updateSessionMetadata: (sessionId: string, update: (metadata: {
      pinned: string[];
      archived: string[];
      experts: Record<string, { expertId: string; expertName: string; avatarLocal?: string }>;
    }) => void) => updateSessionMetadataImpl(sessionId, update),
    clearSessionMetadata: () => clearSessionMetadataImpl(),
    setSessionPinned: (sessionId: string, pinned: boolean) => setSessionPinnedImpl(sessionId, pinned),
    setSessionArchived: (sessionId: string, archived: boolean) => setSessionArchivedImpl(sessionId, archived),
    setAllArchived: (archived: boolean) => setAllArchivedImpl(archived),
    setSessionExpert: (sessionId: string, expert: { expertId: string; expertName: string; avatarLocal?: string } | null) =>
      setSessionExpertImpl(sessionId, expert),
    // --- inspiration / subagents ---
    inspirationGenerate: (category: string, count: number, cwd?: string) =>
      inspirationGenerateImpl(category, count, cwd),
    listSubagentChildren: (parentSessionId: string) => listSubagentChildrenImpl(parentSessionId),
    listSessionJobs: (sessionId: string) => listSessionJobsImpl(sessionId),
    subagentHistory: (parentSessionId: string, childSessionId: string, mode: "one-shot" | "continuable" = "one-shot", beforeSeq?: number, maxMessages?: number) =>
      subagentHistoryImpl(parentSessionId, childSessionId, mode, beforeSeq, maxMessages),
    promptSubagent: (parentSessionId: string, childSessionId: string, content: readonly any[]) =>
      promptSubagentImpl(parentSessionId, childSessionId, content),
    interruptSubagent: (parentSessionId: string, childSessionId: string) =>
      interruptSubagentImpl(parentSessionId, childSessionId),
    killTask: (taskId: string) => killTaskImpl(taskId),
  };
}
