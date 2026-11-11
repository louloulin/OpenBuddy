
import { create } from "zustand";
import type { SubagentLiveEvent } from "@/lib/types";

export interface SubagentRuntime {
  /** Subagent id (= child session id). */
  id: string;
  /** Child session id (may differ on resume). */
  childSessionId?: string;
  /** Human-readable description / task title. */
  description: string;
  /** Agent type ("general-purpose", "explore", etc.). */
  subagentType?: string;
  /** "running" | "completed" | "failed" | "cancelled". */
  status: string;
  /** Elapsed wall-clock time in ms. */
  durationMs?: number;
  /** Completed turns. */
  turnCount?: number;
  /** Total tool calls. */
  toolCallCount?: number;
  /** Tokens used. */
  tokensUsed?: number;
  /** Context window capacity in tokens. */
  contextWindowTokens?: number;
  /** Context usage percentage (0-100). */
  contextUsagePct?: number;
  /** Distinct tool names called. */
  toolsUsed?: string[];
  /** Error message (finished only). */
  error?: string;
  /** Final output (finished only). */
  output?: string;
}

interface SubagentState {
  /** parentSessionId → subagentId → runtime (insertion-ordered via Map). */
  bySession: Record<string, Record<string, SubagentRuntime>>;
  /** Apply a agent://subagent event (spawned/progress/finished). */
  applyEvent: (e: SubagentLiveEvent) => void;
  /** Get all subagents for a session, ordered by insertion (running first). */
  getForSession: (sessionId: string | null) => SubagentRuntime[];
  /** Remove finished subagents for a session (cleanup after dismissal). */
  clearFinished: (sessionId: string) => void;
  /** Drop all subagents for a session (on session switch). */
  clearSession: (sessionId: string) => void;
}

export const useSubagentStore = create<SubagentState>((set, get) => ({
  bySession: {},

  applyEvent: (e) =>
    set((s) => {
      const sessionMap = s.bySession[e.sessionId] ?? {};
      const prev = sessionMap[e.subagentId];
      const next: SubagentRuntime = {
        id: e.subagentId,
        childSessionId: e.childSessionId ?? prev?.childSessionId,
        description: e.description ?? prev?.description ?? "",
        subagentType: e.subagentType ?? prev?.subagentType,
        status: e.status ?? prev?.status ?? "running",
        durationMs: e.durationMs ?? prev?.durationMs,
        turnCount: e.turnCount ?? prev?.turnCount,
        toolCallCount: e.toolCallCount ?? prev?.toolCallCount,
        tokensUsed: e.tokensUsed ?? prev?.tokensUsed,
        contextWindowTokens: e.contextWindowTokens ?? prev?.contextWindowTokens,
        contextUsagePct: e.contextUsagePct ?? prev?.contextUsagePct,
        toolsUsed: e.toolsUsed ?? prev?.toolsUsed,
        error: e.error ?? prev?.error,
        output: e.output ?? prev?.output,
      };
      return {
        bySession: {
          ...s.bySession,
          [e.sessionId]: { ...sessionMap, [e.subagentId]: next },
        },
      };
    }),

  getForSession: (sessionId) => {
    if (!sessionId) return [];
    const map = get().bySession[sessionId];
    if (!map) return [];
    // Sort: running first, then by insertion order.
    return Object.values(map).sort((a, b) => {
      const aRunning = a.status === "running" ? 0 : 1;
      const bRunning = b.status === "running" ? 0 : 1;
      return aRunning - bRunning;
    });
  },

  clearFinished: (sessionId) =>
    set((s) => {
      const map = s.bySession[sessionId];
      if (!map) return s;
      const filtered: Record<string, SubagentRuntime> = {};
      for (const [id, rt] of Object.entries(map)) {
        if (rt.status === "running") filtered[id] = rt;
      }
      return { bySession: { ...s.bySession, [sessionId]: filtered } };
    }),

  clearSession: (sessionId) =>
    set((s) => {
      if (!s.bySession[sessionId]) return s;
      const next = { ...s.bySession };
      delete next[sessionId];
      return { bySession: next };
    }),
}));
