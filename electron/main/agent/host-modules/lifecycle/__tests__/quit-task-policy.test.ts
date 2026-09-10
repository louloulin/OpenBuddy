/**
 * quit-task-policy.test.ts — Phase 4.5 plan4.md
 *
 * Deterministic unit tests for quit-task-policy.ts.
 * No Electron, no IPC — tests only the pure classifyQuitTasks() logic.
 */
import { describe, it, expect } from "vitest";
import {
  classifyQuitTasks,
  formatQuitDialogBody,
  isBlockingDecision,
  shouldAbortTasksOnQuit,
  isBackgroundQuit,
  QUIT_DECISION_OPTIONS,
  type HarnessTaskSnapshot,
} from "../quit-task-policy";

function makeTask(overrides: Partial<HarnessTaskSnapshot> = {}): HarnessTaskSnapshot {
  return {
    id: "task-1",
    kind: "pi-subagent",
    description: "Test subagent task",
    status: "running",
    sessionId: "sess-abc",
    ...overrides,
  };
}

describe("classifyQuitTasks", () => {
  it("returns proceed when task list is empty", () => {
    const result = classifyQuitTasks([]);
    expect(result.kind).toBe("proceed");
  });

  it("returns proceed when all tasks are completed", () => {
    const tasks = [
      makeTask({ id: "t1", status: "completed" }),
      makeTask({ id: "t2", status: "killed" }),
      makeTask({ id: "t3", status: "failed" }),
    ];
    const result = classifyQuitTasks(tasks);
    expect(result.kind).toBe("proceed");
  });

  it("returns ask_user when a task is running", () => {
    const tasks = [makeTask({ id: "t1", status: "running" })];
    const result = classifyQuitTasks(tasks);
    expect(result.kind).toBe("ask_user");
    if (result.kind === "ask_user") {
      expect(result.activeTasks).toHaveLength(1);
      expect(result.activeTasks[0]!.id).toBe("t1");
    }
  });

  it("returns ask_user when a task is stopping", () => {
    const tasks = [makeTask({ id: "t-stopping", status: "stopping" })];
    const result = classifyQuitTasks(tasks);
    expect(result.kind).toBe("ask_user");
    if (result.kind === "ask_user") {
      expect(result.activeTasks[0]!.status).toBe("stopping");
    }
  });

  it("filters out done-status tasks and returns ask_user for mixed list", () => {
    const tasks = [
      makeTask({ id: "t1", status: "running" }),
      makeTask({ id: "t2", status: "completed" }),
      makeTask({ id: "t3", status: "failed" }),
      makeTask({ id: "t4", status: "killed" }),
      makeTask({ id: "t5", status: "stopping" }),
    ];
    const result = classifyQuitTasks(tasks);
    expect(result.kind).toBe("ask_user");
    if (result.kind === "ask_user") {
      expect(result.activeTasks).toHaveLength(2);
      const ids = result.activeTasks.map((t) => t.id);
      expect(ids).toContain("t1");
      expect(ids).toContain("t5");
      expect(ids).not.toContain("t2");
      expect(ids).not.toContain("t3");
      expect(ids).not.toContain("t4");
    }
  });

  it("maps harness task fields into ActiveTask shape", () => {
    const tasks = [
      makeTask({
        id: "my-task-id",
        kind: "my-kind",
        description: "My description",
        sessionId: "my-session",
        status: "running",
      }),
    ];
    const result = classifyQuitTasks(tasks);
    expect(result.kind).toBe("ask_user");
    if (result.kind === "ask_user") {
      const [t] = result.activeTasks;
      expect(t.id).toBe("my-task-id");
      expect(t.kind).toBe("my-kind");
      expect(t.description).toBe("My description");
      expect(t.sessionId).toBe("my-session");
      expect(t.status).toBe("running");
    }
  });

  it("handles a large number of active tasks", () => {
    const tasks = Array.from({ length: 100 }, (_, i) =>
      makeTask({ id: `task-${i}`, status: i % 2 === 0 ? "running" : "completed" }),
    );
    const result = classifyQuitTasks(tasks);
    expect(result.kind).toBe("ask_user");
    if (result.kind === "ask_user") {
      // Only running tasks (even indices) should appear.
      expect(result.activeTasks).toHaveLength(50);
      expect(result.activeTasks.every((t) => t.status === "running")).toBe(true);
    }
  });
});

describe("formatQuitDialogBody", () => {
  it("returns '没有正在运行的任务' for empty array", () => {
    const body = formatQuitDialogBody([]);
    expect(body).toBe("没有正在运行的任务。");
  });

  it("formats a single running task", () => {
    const tasks = [{ id: "t1", kind: "subagent", description: "Do the thing", sessionId: "s1", status: "running" as const }];
    const body = formatQuitDialogBody(tasks);
    expect(body).toContain("有 1 个任务正在运行");
    expect(body).toContain("Do the thing");
    expect(body).toContain("运行中");
  });

  it("formats stopping tasks with '正在停止'", () => {
    const tasks = [{ id: "t1", kind: "subagent", description: "Stopping task", sessionId: "s1", status: "stopping" as const }];
    const body = formatQuitDialogBody(tasks);
    expect(body).toContain("正在停止");
  });

  it("truncates at maxItems and shows count", () => {
    const tasks = [
      { id: "t1", description: "Task 1", status: "running" as const, kind: "", sessionId: "" },
      { id: "t2", description: "Task 2", status: "running" as const, kind: "", sessionId: "" },
      { id: "t3", description: "Task 3", status: "running" as const, kind: "", sessionId: "" },
      { id: "t4", description: "Task 4", status: "running" as const, kind: "", sessionId: "" },
      { id: "t5", description: "Task 5", status: "running" as const, kind: "", sessionId: "" },
    ];
    const body = formatQuitDialogBody(tasks, 3);
    expect(body).toContain("有 5 个任务正在运行");
    expect(body).toContain("Task 1");
    expect(body).toContain("Task 2");
    expect(body).toContain("Task 3");
    expect(body).toContain("…还有 2 个任务");
    expect(body).not.toContain("Task 4");
  });
});

describe("QuitDecision helpers", () => {
  it("CANCEL is blocking", () => {
    expect(isBlockingDecision(QUIT_DECISION_OPTIONS.CANCEL)).toBe(true);
  });

  it("FORCE is not blocking", () => {
    expect(isBlockingDecision(QUIT_DECISION_OPTIONS.FORCE)).toBe(false);
  });

  it("BACKGROUND is not blocking", () => {
    expect(isBlockingDecision(QUIT_DECISION_OPTIONS.BACKGROUND)).toBe(false);
  });

  it("FORCE should abort tasks", () => {
    expect(shouldAbortTasksOnQuit(QUIT_DECISION_OPTIONS.FORCE)).toBe(true);
  });

  it("CANCEL should not abort tasks", () => {
    expect(shouldAbortTasksOnQuit(QUIT_DECISION_OPTIONS.CANCEL)).toBe(false);
  });

  it("BACKGROUND should not abort tasks", () => {
    expect(shouldAbortTasksOnQuit(QUIT_DECISION_OPTIONS.BACKGROUND)).toBe(false);
  });

  it("BACKGROUND is background quit", () => {
    expect(isBackgroundQuit(QUIT_DECISION_OPTIONS.BACKGROUND)).toBe(true);
  });

  it("CANCEL is not background quit", () => {
    expect(isBackgroundQuit(QUIT_DECISION_OPTIONS.CANCEL)).toBe(false);
  });

  it("FORCE is not background quit", () => {
    expect(isBackgroundQuit(QUIT_DECISION_OPTIONS.FORCE)).toBe(false);
  });
});
