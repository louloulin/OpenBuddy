import { useEffect } from "react";
import { create } from "zustand";
import { subscribePlan, type PlanEvent, type PlanItem } from "@openbuddy/client/api/plan";

/**
 * Task plan per session (20261116-pii W3.2/W3.3), fed by the engine's `agent://plan` event.
 * The engine owns the plan (the `ob_todo` results on the current branch) and re-sends it on
 * every change, open, focus and branch navigation, so this store only mirrors the last event.
 */
interface PlanState {
  plans: Record<string, PlanItem[]>;
  apply(event: PlanEvent): void;
}
export const usePlanStore = create<PlanState>((set) => ({
  plans: {},
  apply: (event) => set((state) => ({ plans: { ...state.plans, [event.sessionId]: event.items } })),
}));

const EMPTY: PlanItem[] = [];
/** The plan of one session (empty when it has none). */
export function usePlan(sessionId: string | null | undefined): PlanItem[] {
  return usePlanStore((state) => (sessionId ? state.plans[sessionId] ?? EMPTY : EMPTY));
}

/** Mounted once by the app shell: keeps the store in sync with `agent://plan`. */
export function usePlanFeed() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    subscribePlan((event) => usePlanStore.getState().apply(event)).then(
      (off) => { if (disposed) off(); else unlisten = off; },
      () => { /* no host bridge (tests, plain browser) */ },
    );
    return () => { disposed = true; unlisten?.(); };
  }, []);
}
