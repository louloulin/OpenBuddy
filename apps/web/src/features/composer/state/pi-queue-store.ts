import { create } from "zustand";
import type { AgentQueue } from "@openbuddy/client/agent-client";

/** A queued prompt as the UI knows it: text plus the native attachments it was queued with (pii W1.8). */
export interface PiQueueItem {
  text: string;
  attachments?: { path: string }[];
}
export interface PiQueue {
  steering: PiQueueItem[];
  followUp: PiQueueItem[];
}
export const EMPTY_PI_QUEUE: PiQueue = { steering: [], followUp: [] };

/**
 * The engine's queue arrives as strings (`agent_get_queue` / steer / followUp). Merge it
 * with what the UI already knew so attachments survive reordering and external updates.
 */
function merge(next: string[], previous: PiQueueItem[]): PiQueueItem[] {
  const pool = [...previous];
  return next.map((text) => {
    const index = pool.findIndex((item) => item.text === text);
    if (index < 0) return { text };
    return pool.splice(index, 1)[0];
  });
}

interface PiQueueState {
  queues: Record<string, PiQueue>;
  apply: (sessionId: string, queue: AgentQueue) => void;
  /** After `agent_steer` / `agent_follow_up`, remember the attachments of the item just queued. */
  applyEnqueued: (sessionId: string, queue: AgentQueue, text: string, attachments: { path: string }[], kind: "steer" | "followUp") => void;
  set: (sessionId: string, queue: PiQueue) => void;
}

export const usePiQueueStore = create<PiQueueState>((set) => ({
  queues: {},
  apply: (sessionId, queue) =>
    set((state) => {
      const previous = state.queues[sessionId] ?? EMPTY_PI_QUEUE;
      return {
        queues: {
          ...state.queues,
          [sessionId]: {
            steering: merge(queue.steering, previous.steering),
            followUp: merge(queue.followUp, previous.followUp),
          },
        },
      };
    }),
  applyEnqueued: (sessionId, queue, text, attachments, kind) =>
    set((state) => {
      const previous = state.queues[sessionId] ?? EMPTY_PI_QUEUE;
      const item: PiQueueItem = attachments.length ? { text, attachments } : { text };
      const merged: PiQueue = {
        steering: merge(queue.steering, previous.steering),
        followUp: merge(queue.followUp, previous.followUp),
      };
      const list = kind === "steer" ? merged.steering : merged.followUp;
      const index = list.findIndex((entry) => entry.text === text);
      if (index >= 0) list[index] = item;
      return { queues: { ...state.queues, [sessionId]: merged } };
    }),
  set: (sessionId, queue) => set((state) => ({ queues: { ...state.queues, [sessionId]: queue } })),
}));
