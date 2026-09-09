import { describe, expect, it } from "vitest";
import { canRecoverTask, isTaskTerminal, transitionTask, TaskLifecycleError } from "./task-lifecycle";

const base = { taskId: "task-1", sessionId: "session-1", generation: 2, status: "draft" as const, updatedAt: "t0" };

describe("task lifecycle", () => {
  it("covers the normal approval and completion path", () => {
    let state = transitionTask(base, "queue", "t1");
    state = transitionTask(state, "start", "t2");
    state = transitionTask(state, "approval_required", "t3");
    state = transitionTask(state, "approve", "t4");
    state = transitionTask(state, "complete", "t5");
    expect(state.status).toBe("completed");
    expect(isTaskTerminal(state.status)).toBe(true);
  });

  it("supports failure retry and pause resume", () => {
    let state = transitionTask(transitionTask(base, "queue", "t1"), "start", "t2");
    state = transitionTask(state, "fail", "t3");
    expect(canRecoverTask(state, 2)).toBe(true);
    state = transitionTask(state, "retry", "t4");
    state = transitionTask(state, "start", "t5");
    state = transitionTask(state, "pause", "t6");
    expect(transitionTask(state, "resume", "t7").status).toBe("queued");
  });

  it("rejects illegal transitions and stale generation recovery", () => {
    expect(() => transitionTask(base, "complete", "t1")).toThrow(TaskLifecycleError);
    expect(canRecoverTask({ status: "failed", generation: 1 }, 2)).toBe(false);
  });
});
