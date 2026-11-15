import { create } from "zustand";

/**
 * The in-chat find bar's current hit (U3.5): which message and what text. A finished turn whose
 * folded steps (thinking, interim text) hold the hit unfolds itself, so the match is visible.
 */
export const useFindFocusStore = create<{
  query: string;
  messageId: string | null;
  set: (query: string, messageId: string | null) => void;
}>((set) => ({
  query: "",
  messageId: null,
  set: (query, messageId) => set({ query, messageId }),
}));

/** The query when `messageIds` contains the current hit, else "". */
export const selectFindFocus = (messageIds: readonly string[]) => (s: { query: string; messageId: string | null }) =>
  s.messageId && s.query && messageIds.includes(s.messageId) ? s.query : "";
