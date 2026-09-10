import { describe, expect, it } from "vitest";
import { canRecoverTask, createTaskLifecycleStore, isTaskTerminal, transitionTask, TaskLifecycleError, type TaskLifecycleState } from "./task-lifecycle";

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

  it("persists transitions and fences recovery by generation", async () => {
    const persisted = new Map<string, TaskLifecycleState>();
    const store = createTaskLifecycleStore({
      async read(taskId) { return persisted.get(taskId) ?? null; },
      async write(state) { persisted.set(state.taskId, { ...state }); },
    });
    await store.create(base);
    await store.transition("task-1", "queue", "t1");
    await store.transition("task-1", "start", "t2");
    await store.transition("task-1", "fail", "t3");
    expect((await store.get("task-1"))?.status).toBe("failed");
    expect(await store.recover("task-1", 1)).toBeNull();
    expect(await store.recover("task-1", 2)).toMatchObject({ taskId: "task-1", status: "failed", generation: 2 });
    await expect(store.create(base)).rejects.toThrow("already exists");
  });

  it("does not persist an invalid transition or unknown task", async () => {
    const persisted = new Map<string, TaskLifecycleState>();
    const writes: TaskLifecycleState[] = [];
    const store = createTaskLifecycleStore({
      read: async (taskId) => persisted.get(taskId) ?? null,
      write: async (state) => { persisted.set(state.taskId, { ...state }); writes.push(state); },
    });
    await expect(store.transition("missing", "queue", "t1")).rejects.toThrow("does not exist");
    await store.create(base);
    await expect(store.transition("task-1", "complete", "t2")).rejects.toThrow(TaskLifecycleError);
    expect(writes).toHaveLength(1);
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
