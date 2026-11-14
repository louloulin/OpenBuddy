// Task plan (20261116-pii W3.1–W3.3): the engine's `agent://plan` event, the plan of a session's
// current branch as recorded by the built-in `ob_todo` tool. No command: the engine re-sends the
// plan whenever a session is opened, focused or navigated.
import type { PlanEvent } from "@openbuddy/protocol/plan";
import { listen, type UnlistenFn } from "../ipc";

export type { PlanEvent, PlanItem, PlanItemStatus, TodoDetails } from "@openbuddy/protocol/plan";
export { PLAN_TOOL, planProgress } from "@openbuddy/protocol/plan";

/** Subscribe to plan updates of every session. */
export function subscribePlan(handler: (event: PlanEvent) => void): Promise<UnlistenFn> {
  return listen<PlanEvent>("agent://plan", (event) => {
    const payload = event.payload;
    if (payload && typeof payload.sessionId === "string" && Array.isArray(payload.items)) handler(payload);
  });
}
