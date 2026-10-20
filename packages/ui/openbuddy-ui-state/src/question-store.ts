import { create } from "zustand";

export interface QuestionItem {
  id: string;
  question: string;
  options: string[];
}

export interface QuestionRequest {
  requestId: string;
  sessionId: string;
  toolCallId: string;
  title: string;
  questions: QuestionItem[];
  timeout?: number;
  /** Optional client-side timestamp used by the TTL eviction. */
  issuedAt?: number;
}

interface QuestionState {
  /** sessionId → ordered queue of pending question requests. */
  queues: Record<string, QuestionRequest[]>;
  /** Push a new question request from the backend. */
  request: (q: QuestionRequest) => void;
  /** Remove a question from its session's queue. */
  dismiss: (requestId: string, sessionId?: string) => void;
  /** Drop entries older than the TTL or evict the oldest when the cap is hit. */
  prune: () => void;
}

const QUEUE_CAP = Math.max(1, Number(import.meta.env?.VITE_OPENBUDDY_QUESTION_QUEUE_CAP
  ?? (typeof window !== "undefined" && (window as { __OPENBUDDY_QUESTION_QUEUE_CAP?: string }).__OPENBUDDY_QUESTION_QUEUE_CAP)
  ?? 8));
const QUEUE_TTL_MS = Math.max(1_000, Number(import.meta.env?.VITE_OPENBUDDY_QUESTION_TTL_MS
  ?? (typeof window !== "undefined" && (window as { __OPENBUDDY_QUESTION_TTL_MS?: string }).__OPENBUDDY_QUESTION_TTL_MS)
  ?? 5 * 60_000));

function isExpired(q: QuestionRequest, now: number): boolean {
  if (typeof q.issuedAt !== "number") return false;
  return now - q.issuedAt > QUEUE_TTL_MS;
}

export const useQuestionStore = create<QuestionState>((set) => ({
  queues: {},
  request: (q) =>
    set((s) => {
      const sid = q.sessionId || "__global";
      const prev = s.queues[sid] ?? [];
      const now = Date.now();
      const stamped: QuestionRequest = typeof q.issuedAt === "number" ? q : { ...q, issuedAt: now };
      const fresh = prev.filter((existing) => !isExpired(existing, now));
      const next = [...fresh, stamped];
      // LRU eviction: keep the most recent QUEUE_CAP entries.
      const trimmed = next.length > QUEUE_CAP ? next.slice(next.length - QUEUE_CAP) : next;
      return { queues: { ...s.queues, [sid]: trimmed } };
    }),
  dismiss: (requestId, sessionId) =>
    set((s) => {
      if (sessionId) {
        const prev = s.queues[sessionId];
        if (!prev) return s;
        return {
          queues: {
            ...s.queues,
            [sessionId]: prev.filter((q) => q.requestId !== requestId),
          },
        };
      }
      const queues = { ...s.queues };
      for (const sid of Object.keys(queues)) {
        queues[sid] = queues[sid].filter((q) => q.requestId !== requestId);
      }
      return { queues };
    }),
  prune: () =>
    set((s) => {
      const now = Date.now();
      const queues: Record<string, QuestionRequest[]> = {};
      for (const [sid, items] of Object.entries(s.queues)) {
        const filtered = items.filter((q) => !isExpired(q, now));
        if (filtered.length > 0) queues[sid] = filtered;
      }
      return { queues };
    }),
}));

export const QUESTION_QUEUE_CAP = QUEUE_CAP;
export const QUESTION_QUEUE_TTL_MS = QUEUE_TTL_MS;

/** Select the first pending question for a given session. */
export const selectQuestionForSession =
  (sessionId: string | null) =>
  (s: QuestionState): QuestionRequest | null => {
    if (!sessionId) return null;
    return s.queues[sessionId]?.[0] ?? null;
  };
