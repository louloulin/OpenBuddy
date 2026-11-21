import { create } from "zustand";

/**
 * "Open this session and find this text" (pii W1.4): the Ctrl/Cmd+K 内容 group sets it before
 * opening a hit; the chat's find bar takes it once the session's messages are there, opens and
 * jumps to the first match. Requests expire so a stale one never pops the bar open later.
 */
export interface FindRequest {
  sessionId: string;
  query: string;
  at: number;
}

const TTL_MS = 15_000;

export const useFindRequestStore = create<{
  request?: FindRequest;
  requestFind: (sessionId: string, query: string) => void;
  /** The pending query for this session (consumed), if any and still fresh. */
  take: (sessionId: string) => string | undefined;
}>((set, get) => ({
  request: undefined,
  requestFind: (sessionId, query) => set({ request: { sessionId, query, at: Date.now() } }),
  take: (sessionId) => {
    const request = get().request;
    if (!request || request.sessionId !== sessionId) return undefined;
    set({ request: undefined });
    return Date.now() - request.at <= TTL_MS && request.query.trim() ? request.query : undefined;
  },
}));

export const requestFind = (sessionId: string, query: string) => useFindRequestStore.getState().requestFind(sessionId, query);
