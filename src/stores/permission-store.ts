import { create } from "zustand";
import type { PermissionRequest } from "@openbuddy/shared-types";

/**
 * Permission requests indexed by sessionId. Each session owns its own queue
 * so the inline permission card only shows requests for the active session,
 * and switching conversations is never blocked.
 *
 * LRU + TTL bound (PR 5):
 *   - LRU cap per session: `OPENBUDDY_PERMISSION_QUEUE_CAP` (default 8).
 *   - TTL: `OPENBUDDY_PERMISSION_TTL_MS` (default 5 min). When a push
 *     happens, every request older than the TTL is dropped first.
 *   - On cap overflow, the OLDEST request in that session's queue is
 *     dropped (LRU eviction).
 */
interface PermissionState {
  /** sessionId → ordered queue of pending permission requests. */
  queues: Record<string, PermissionRequest[]>;
  /** Push a new request emitted by the backend. */
  request: (p: PermissionRequest) => void;
  /** Remove a request from its session's queue (without resolving the agent). */
  dismiss: (requestId: string, sessionId?: string) => void;
  /** Drop entries older than the TTL or evict the oldest when the cap is hit. */
  prune: () => void;
}

const QUEUE_CAP = Math.max(1, Number(import.meta.env?.VITE_OPENBUDDY_PERMISSION_QUEUE_CAP
  ?? (typeof window !== "undefined" && (window as { __OPENBUDDY_PERMISSION_QUEUE_CAP?: string }).__OPENBUDDY_PERMISSION_QUEUE_CAP)
  ?? 8));
const QUEUE_TTL_MS = Math.max(1_000, Number(import.meta.env?.VITE_OPENBUDDY_PERMISSION_TTL_MS
  ?? (typeof window !== "undefined" && (window as { __OPENBUDDY_PERMISSION_TTL_MS?: string }).__OPENBUDDY_PERMISSION_TTL_MS)
  ?? 5 * 60_000));

function isExpired(p: PermissionRequest, now: number): boolean {
  const issued = (p as { issuedAt?: number }).issuedAt;
  if (typeof issued !== "number") return false;
  return now - issued > QUEUE_TTL_MS;
}

export const usePermissionStore = create<PermissionState>((set) => ({
  queues: {},
  request: (p) =>
    set((s) => {
      const sid = p.sessionId || "__global";
      const prev = s.queues[sid] ?? [];
      const now = Date.now();
      const fresh = prev.filter((q) => !isExpired(q, now));
      const next = [...fresh, p];
      // LRU eviction: keep the most recent QUEUE_CAP entries.
      const trimmed = next.length > QUEUE_CAP ? next.slice(next.length - QUEUE_CAP) : next;
      return { queues: { ...s.queues, [sid]: trimmed } };
    }),
  dismiss: (requestId, sessionId) =>
    set((s) => {
      if (sessionId) {
        const sid = sessionId;
        const prev = s.queues[sid];
        if (!prev) return s;
        return {
          queues: {
            ...s.queues,
            [sid]: prev.filter((q) => q.requestId !== requestId),
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
      const queues: Record<string, PermissionRequest[]> = {};
      for (const [sid, items] of Object.entries(s.queues)) {
        const filtered = items.filter((q) => !isExpired(q, now));
        if (filtered.length > 0) queues[sid] = filtered;
      }
      return { queues };
    }),
}));

export const PERMISSION_QUEUE_CAP = QUEUE_CAP;
export const PERMISSION_QUEUE_TTL_MS = QUEUE_TTL_MS;

/** Select the first pending permission for a given session. */
export const selectPermissionForSession =
  (sessionId: string | null) =>
  (s: PermissionState): PermissionRequest | null => {
    if (!sessionId) return null;
    return s.queues[sessionId]?.[0] ?? null;
  };

/** Legacy: head of all queues (used nowhere after migration to inline). */
export const selectPermissionHead = (s: PermissionState): PermissionRequest | null => {
  for (const sid of Object.keys(s.queues)) {
    if (s.queues[sid].length > 0) return s.queues[sid][0];
  }
  return null;
};
