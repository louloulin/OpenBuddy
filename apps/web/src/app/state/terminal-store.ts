import { create } from "zustand";
import type { TerminalRow } from "@openbuddy/chat-core/terminal-rows";

/**
 * Background command output per session (WorkBuddy terminal module parity).
 *
 * The sidebar's running-task panel and the task overview both need the shell
 * output of background sessions. Keeping the cache in the app layer lets any
 * surface read it without a feature → feature dependency.
 */
export interface TerminalState {
  /** Latest terminal rows per session id. */
  bySession: Record<string, TerminalRow[]>;
  setSession: (sessionId: string, rows: TerminalRow[]) => void;
  clearSession: (sessionId: string) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  bySession: {},
  setSession: (sessionId, rows) =>
    set((state) => {
      if (state.bySession[sessionId] === rows) return state;
      return { bySession: { ...state.bySession, [sessionId]: rows } };
    }),
  clearSession: (sessionId) =>
    set((state) => {
      if (!state.bySession[sessionId]) return state;
      const bySession = { ...state.bySession };
      delete bySession[sessionId];
      return { bySession };
    }),
}));
