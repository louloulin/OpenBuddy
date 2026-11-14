import { create } from "zustand";

import type { QuestionRequest, UiDismissReason } from "@openbuddy/client/types";
export type { QuestionRequest, UiDismissReason } from "@openbuddy/client/types";
interface QuestionState {
  queues: Record<string, QuestionRequest[]>;
  notices: Record<string, string>;
  request: (request: QuestionRequest) => void;
  dismiss: (requestId: string, sessionId?: string, reason?: UiDismissReason) => void;
}
export const useQuestionStore = create<QuestionState>(set => ({
  queues: {}, notices: {},
  request: request => set(state => {
    if (!request.sessionId || !request.requestId) return state;
    const current = state.queues[request.sessionId] ?? [];
    if (current.some(item => item.requestId === request.requestId)) return state;
    const expiresAt = request.timeoutMs !== undefined ? Date.now() + Math.max(0, request.timeoutMs) : undefined;
    return { queues: { ...state.queues, [request.sessionId]: [...current, { ...request, expiresAt }] }, notices: { ...state.notices, [request.sessionId]: "" } };
  }),
  dismiss: (requestId, sessionId, reason) => set(state => {
    const queues = { ...state.queues }; const notices = { ...state.notices };
    for (const sid of sessionId ? [sessionId] : Object.keys(queues)) {
      if (!queues[sid]?.some(request => request.requestId === requestId)) continue;
      queues[sid] = queues[sid].filter(request => request.requestId !== requestId);
      if (reason === "timeout") notices[sid] = "输入请求已超时。";
      else if (reason === "cancelled" || reason === "aborted" || reason === "session_closed") notices[sid] = "输入请求已取消。";
    }
    return { queues, notices };
  }),
}));
export const selectQuestionForSession = (sessionId: string | null) => (state: QuestionState): QuestionRequest | null => sessionId ? state.queues[sessionId]?.[0] ?? null : null;
