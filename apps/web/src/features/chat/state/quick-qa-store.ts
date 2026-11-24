import { create } from "zustand";

interface QuickQaState {
  /** 快速问答 (G1-31) 的一次性会话：它们不是任务，不进侧栏，也不发完成通知。 */
  sessions: Record<string, true>;
  /** Remember a throwaway session so sidebar / notification events for it can be ignored. */
  mark: (sessionId: string) => void;
  /** Is this id a quick-QA session (never a task)? */
  isQuickQa: (sessionId: string) => boolean;
}

/** How many quick-QA ids to remember; older ones are forgotten. */
const MAX_REMEMBERED = 20;

/**
 * 快速问答 (G1-31): the throwaway sessions the quick-QA sheet opens. The engine keeps them out
 * of the session list; the renderer has to ignore their status / completion events the same way
 * it ignores sub-agent sessions, or they would show up as tasks and fire notifications.
 */
export const useQuickQaStore = create<QuickQaState>((set, get) => ({
  sessions: {},
  mark: (sessionId) => set((state) => {
    const sessions: Record<string, true> = { ...state.sessions, [sessionId]: true };
    const ids = Object.keys(sessions);
    if (ids.length <= MAX_REMEMBERED) return { sessions };
    const kept: Record<string, true> = {};
    for (const id of ids.slice(-MAX_REMEMBERED)) kept[id] = true;
    return { sessions: kept };
  }),
  isQuickQa: (sessionId) => !!get().sessions[sessionId],
}));
