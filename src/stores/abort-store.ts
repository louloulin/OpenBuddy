/**
 * R5.3 — Centralized abort controller registry.
 *
 * Why a registry? Pre-R5, `piCancel(sessionId)` directly hit the bridge
 * without any in-process state. Concurrent sends for the same session
 * couldn't be distinguished — a "cancel" might abort a freshly-started
 * send instead of the in-flight one, or vice versa.
 *
 * This store tracks the active `AbortController` per session id so callers
 * can grab the controller, attach signal listeners, and abort deterministically.
 *
 * Lifecycle:
 *   1. `register(sessionId)` when a new send starts; returns the controller.
 *   2. `abort(sessionId)` when the user clicks Cancel — calls `.abort()` on
 *      the stored controller and removes it from the registry.
 *   3. `clear(sessionId)` once the send completes (success or failure) to
 *      release the registry slot.
 *
 * Idempotent: calling `abort` for an unknown session is a no-op.
 */
import { create } from "zustand";

interface AbortState {
  controllers: Record<string, AbortController>;
  register: (sessionId: string) => AbortController;
  abort: (sessionId: string) => void;
  clear: (sessionId: string) => void;
}

export const useAbortStore = create<AbortState>((set, get) => ({
  controllers: {},
  register: (sessionId) => {
    // If a controller already exists for this session, abort it before
    // allocating a new one — the prior send was orphaned by the new request
    // and must not keep consuming the bridge.
    const existing = get().controllers[sessionId];
    if (existing && !existing.signal.aborted) existing.abort();
    const controller = new AbortController();
    set((s) => ({ controllers: { ...s.controllers, [sessionId]: controller } }));
    return controller;
  },
  abort: (sessionId) => {
    const c = get().controllers[sessionId];
    if (!c) return;
    if (!c.signal.aborted) c.abort();
    set((s) => {
      const next = { ...s.controllers };
      delete next[sessionId];
      return { controllers: next };
    });
  },
  clear: (sessionId) => {
    set((s) => {
      if (!(sessionId in s.controllers)) return s;
      const next = { ...s.controllers };
      delete next[sessionId];
      return { controllers: next };
    });
  },
}));

/** Convenience selector — returns the AbortSignal for the session if any. */
export function selectAbortSignal(sessionId: string): AbortSignal | undefined {
  return useAbortStore.getState().controllers[sessionId]?.signal;
}