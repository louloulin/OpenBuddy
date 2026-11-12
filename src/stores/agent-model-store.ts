import { create } from "zustand";
import type { ModelState } from "@/lib/types";

/** Provider-qualified home preference plus authoritative per-session runtime state. */
export const useAgentModelStore = create<{
  homeModelKey?: string;
  states: Record<string, ModelState>;
  setHomeModelKey: (key?: string) => void;
  apply: (state: ModelState) => void;
}>((set) => ({
  homeModelKey: undefined,
  states: {},
  setHomeModelKey: homeModelKey => set({ homeModelKey }),
  apply: state => set(current => ({ states: { ...current.states, [state.sessionId]: state } })),
}));
