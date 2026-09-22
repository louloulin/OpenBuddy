/**
 * Subagent live runtime store — 对齐 WorkBuddy `team-runtime` / `getSubagentList`。
 *
 * Receives `pi://subagent` events forwarded by bridge.rs from pi's
 * `x.ai/session_notification` (subagent_spawned / subagent_progress /
 * subagent_finished). Maintains a per-parent-session map of active and
 * completed subagents with live progress (turns, tokens, duration, status).
 */
import { create } from "zustand";
import type { SubagentLiveEvent } from "@openbuddy/shared-types";

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
  /** Apply a pi://subagent event (spawned/progress/finished). */
  applyEvent: (e: SubagentLiveEvent) => void;
  /** Get all subagents for a session, ordered by insertion (running first). */
  getForSession: (sessionId: string | null) => SubagentRuntime[];
  /** Remove finished subagents for a session (cleanup after dismissal). */
  clearFinished: (sessionId: string) => void;
  /** Drop all subagents for a session (on session switch). */
  clearSession: (sessionId: string) => void;
}

// R0.5: Per-session memoization cache for getForSession. Keyed by sessionId;
// holds the live bySession map reference and the previously-sorted list. When
// the underlying map reference changes (because applyEvent / clearFinished
// replaced it), the cache is invalidated and the next call recomputes.
const subagentListCache = new Map<
  string,
  { map: Record<string, SubagentRuntime>; list: SubagentRuntime[] }
>();
const EMPTY_SUBAGENT_LIST: SubagentRuntime[] = [];

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
    if (!sessionId) return EMPTY_SUBAGENT_LIST;
    const state = get();
    const map = state.bySession[sessionId];
    if (!map) return EMPTY_SUBAGENT_LIST;
    // R0.5: Memoize per-session sorted list. Cache keyed by the live map
    // reference; when bySession[sessionId] is replaced via `set`, the next
    // call recomputes. This avoids Object.values+sort allocating a new
    // array on every selector invocation, which otherwise triggers spurious
    // re-renders downstream.
    const cached = subagentListCache.get(sessionId);
    if (cached && cached.map === map) return cached.list;
    const list = Object.values(map).sort((a, b) => {
      const aRunning = a.status === "running" ? 0 : 1;
      const bRunning = b.status === "running" ? 0 : 1;
      return aRunning - bRunning;
    });
    subagentListCache.set(sessionId, { map, list });
    return list;
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
