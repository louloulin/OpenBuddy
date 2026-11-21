/**
 * Task plan (20261116-pii W3.1–W3.3). The model records the steps of a task with the built-in
 * `ob_todo` tool; the full list is stored in each tool result's `details`, so the plan of any
 * branch is rebuilt from that branch's results (forks, regenerations and branch switches stay
 * correct). The renderer only receives the slim `agent://plan` event.
 */
export const PLAN_TOOL = "ob_todo";

export type PlanItemStatus = "pending" | "in_progress" | "done";

export interface PlanItem {
  /** Stable within a plan; the model refers to steps by this number. */
  id: number;
  text: string;
  status: PlanItemStatus;
  /** Short remark the model attached (a result, a blocker). */
  note?: string;
}

/** Payload of `agent://plan`: the whole plan of the session's current branch, nothing else. */
export interface PlanEvent {
  sessionId: string;
  items: PlanItem[];
}

export type TodoAction = "add" | "update" | "complete" | "remove" | "list";

/** `details` of an `ob_todo` tool result (persisted with the session). */
export interface TodoDetails {
  action: TodoAction;
  /** The plan after this call. */
  items: PlanItem[];
  /** Id the next added step gets. */
  nextId: number;
  /** Steps this call added or changed (for the transcript row). */
  changed: number[];
  /** Steps this call removed. */
  removed?: PlanItem[];
}

/** Steps finished / total, and the step being worked on. */
export function planProgress(items: readonly PlanItem[]): { done: number; total: number; current?: PlanItem } {
  return {
    done: items.filter((item) => item.status === "done").length,
    total: items.length,
    current: items.find((item) => item.status === "in_progress"),
  };
}
