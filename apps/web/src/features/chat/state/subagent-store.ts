import { create } from "zustand";
import type { SubagentEvent } from "@openbuddy/protocol/subagent";

/** One child session of a parent turn (pii W3.4). */
export interface SubagentRun {
  childId: string;
  agent?: string;
  task?: string;
  status: "running" | "done" | "failed" | "cancelled";
  summary?: string;
  error?: string;
  ms?: number;
}

interface SubagentState {
  /** parent session id → its children, in spawn order. */
  bySession: Record<string, SubagentRun[]>;
  /** Every child session id seen, so sidebar events for them can be ignored. */
  children: Record<string, true>;
  /** Is this id a sub-agent session (never a sidebar row)? */
  isChild: (sessionId: string) => boolean;
  apply: (event: SubagentEvent) => void;
  /** Clear a session's finished children (leaving running ones) when a new turn starts. */
  reset: (sessionId: string) => void;
}

/**
 * 子代理卡片 (pii W3.4): `agent://subagent` events folded per parent session. The transcript shows
 * the cards under the turn that spawned them; a finished child keeps its answer for expansion.
 */
export const useSubagentStore = create<SubagentState>((set, get) => ({
  bySession: {},
  children: {},
  isChild: (sessionId) => !!get().children[sessionId],
  apply: (event) => set((state) => {
    const current = state.bySession[event.parentId] ?? [];
    const index = current.findIndex((run) => run.childId && run.childId === event.childId);
    const next: SubagentRun = {
      childId: event.childId,
      agent: event.agent ?? (index >= 0 ? current[index].agent : undefined),
      task: event.task ?? (index >= 0 ? current[index].task : undefined),
      status: event.status === "started" ? "running" : event.status === "running" ? "running" : event.status,
      summary: event.summary ?? (index >= 0 ? current[index].summary : undefined),
      error: event.error ?? (index >= 0 ? current[index].error : undefined),
      ms: event.ms ?? (index >= 0 ? current[index].ms : undefined),
    };
    const list = index >= 0 ? current.map((run, i) => (i === index ? { ...run, ...next } : run)) : [...current, next];
    // A child that was never named (created but not yet announced) keeps its placeholder id.
    return {
      bySession: { ...state.bySession, [event.parentId]: list },
      children: event.childId ? { ...state.children, [event.childId]: true } : state.children,
    };
  }),
  reset: (sessionId) => set((state) => ({
    bySession: {
      ...state.bySession,
      [sessionId]: (state.bySession[sessionId] ?? []).filter((run) => run.status === "running"),
    },
  })),
}));
