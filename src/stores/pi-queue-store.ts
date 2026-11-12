import { create } from "zustand";
import type { AgentQueue } from "@/lib/agent-client";
export const EMPTY_PI_QUEUE: AgentQueue = { steering: [], followUp: [] };
export const usePiQueueStore = create<{ queues: Record<string, AgentQueue>; apply: (sessionId: string, queue: AgentQueue) => void }>(set => ({
  queues: {},
  apply: (sessionId, queue) => set(state => ({ queues: { ...state.queues, [sessionId]: { steering: [...queue.steering], followUp: [...queue.followUp] } } })),
}));
