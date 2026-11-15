import { create } from "zustand";
import { agentTree } from "@openbuddy/client/agent-client";
import type { BranchTree, BranchTurn } from "@openbuddy/protocol/branches";

/**
 * Versions ‹1/2› of the user turns of each session (20261116-pii W1.1), from `agent_tree`.
 * Refreshed when the last turn settles or the transcript is rebuilt (a new branch was shown).
 */
interface BranchState {
  trees: Record<string, BranchTree | undefined>;
  /** A switch in progress, per session (the switcher shows it and blocks a second one). */
  switching: Record<string, "switch" | "summarize" | undefined>;
  refresh(sessionId: string): Promise<void>;
  setSwitching(sessionId: string, value: "switch" | "summarize" | undefined): void;
}

const latest = new Map<string, number>();

export const useBranchStore = create<BranchState>((set) => ({
  trees: {},
  switching: {},
  refresh: async (sessionId) => {
    const token = (latest.get(sessionId) ?? 0) + 1;
    latest.set(sessionId, token);
    // A session picked in the sidebar renders its cached transcript before the engine has
    // reopened it (null): ask again a moment later.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const tree = await agentTree(sessionId);
        if (latest.get(sessionId) !== token) return;
        if (tree) { set((s) => ({ trees: { ...s.trees, [sessionId]: tree } })); return; }
      } catch {
        /* closed: keep what we had */
        return;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  },
  setSwitching: (sessionId, value) => set((s) => ({ switching: { ...s.switching, [sessionId]: value } })),
}));

/** The tree entry of the turn answering the prompt sent at `timestamp` (only when it has other versions). */
export const selectBranchTurn = (sessionId: string, timestamp: number | undefined) => (s: BranchState): BranchTurn | undefined => {
  if (timestamp === undefined) return undefined;
  const turn = s.trees[sessionId]?.turns.find((t) => t.timestamp === timestamp);
  return turn && turn.total > 1 ? turn : undefined;
};
