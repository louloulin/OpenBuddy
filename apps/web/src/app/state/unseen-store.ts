import { create } from "zustand";
import { useSessionStore } from "../../features/chat/state/session-store";

/**
 * Sessions that finished in the background and have not been opened since
 * (sidebar "已完成未查看" dot, 20261115-ui U6.2). Kept across reloads.
 */
const KEY = "openbuddy.unseen";
const load = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(-200) : [];
  } catch {
    return [];
  }
};
const persist = (ids: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* private mode */ } };

interface UnseenState {
  ids: string[];
  mark: (sessionId: string) => void;
  clear: (sessionId: string) => void;
}
export const useUnseenStore = create<UnseenState>((set, get) => ({
  ids: typeof localStorage === "undefined" ? [] : load(),
  mark: (sessionId) => {
    if (get().ids.includes(sessionId) || useSessionStore.getState().sessionId === sessionId) return;
    const ids = [...get().ids, sessionId].slice(-200);
    persist(ids);
    set({ ids });
  },
  clear: (sessionId) => {
    if (!get().ids.includes(sessionId)) return;
    const ids = get().ids.filter((id) => id !== sessionId);
    persist(ids);
    set({ ids });
  },
}));
// Opening a session counts as having seen it.
useSessionStore.subscribe((state, prev) => {
  if (state.sessionId && state.sessionId !== prev.sessionId) useUnseenStore.getState().clear(state.sessionId);
});
