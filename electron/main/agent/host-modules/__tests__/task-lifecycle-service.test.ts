import { afterEach, describe, expect, it } from "vitest";
import type { TaskLifecyclePersistence, TaskLifecycleState } from "@openbuddy/plugin-host";
import { InMemoryTaskLifecycleEventLog, type TaskLifecycleEventLog } from "../task-lifecycle-events";
import { TaskLifecycleService, createTaskLifecycleService } from "../task-lifecycle-service";

/** Deterministic in-memory persistence for journey tests. */
class MemoryTaskLifecyclePersistence implements TaskLifecyclePersistence {
  private readonly states = new Map<string, TaskLifecycleState>();

  async read(taskId: string): Promise<TaskLifecycleState | null> {
    const state = this.states.get(taskId);
    return state ? { ...state } : null;
  }

  async write(state: TaskLifecycleState): Promise<void> {
    this.states.set(state.taskId, { ...state });
  }

  async list(): Promise<TaskLifecycleState[]> {
    return [...this.states.values()].map((state) => ({ ...state }));
  }
}

interface Fixture {
  service: TaskLifecycleService;
  persistence: MemoryTaskLifecyclePersistence;
  sessionIds: Set<string>;
  events: TaskLifecycleEventLog;
}

const resources: Array<() => Promise<void>> = [];

afterEach(async () => { for (const close of resources.splice(0)) await close(); });

function makeService(resolver?: (sessionId: string) => Promise<boolean>): Fixture {
  const persistence = new MemoryTaskLifecyclePersistence();
  const events = new InMemoryTaskLifecycleEventLog();
  const service = createTaskLifecycleService(persistence, {
    sessionExists: resolver,
    events,
  });
  resources.push(() => service.close());
  return { service, persistence, sessionIds: new Set(["session-1"]), events };
}

async function seededService(resolver?: (sessionId: string) => Promise<boolean>) {
  const fixture = makeService(resolver);
  await fixture.service.createTask({
    taskId: "worktask-1",
    sessionId: "session-1",
    workspaceId: "workspace-1",
    generation: 4,
  });
  return fixture;
}

describe("TaskLifecycleService", () => {
  it("runs the deterministic draft→queued→running→approval→completed journey", async () => {
    const { service } = await seededService();
    expect(await service.transitionTask("worktask-1", "queue")).toMatchObject({ status: "queued" });
    expect(await service.transitionTask("worktask-1", "start")).toMatchObject({ status: "running" });
    expect(await service.transitionTask("worktask-1", "approval_required")).toMatchObject({ status: "awaiting_approval" });
    expect(await service.transitionTask("worktask-1", "approve")).toMatchObject({ status: "running" });
    const completed = await service.transitionTask("worktask-1", "complete");
    expect(completed).toMatchObject({ status: "completed", sessionId: "session-1", workspaceId: "workspace-1", generation: 4 });
  });

  it("supports failure retry and pause/resume recovery paths", async () => {
    const { service } = await seededService();
    await service.transitionTask("worktask-1", "queue");
    await service.transitionTask("worktask-1", "start");
    await service.transitionTask("worktask-1", "fail");
    expect(await service.transitionTask("worktask-1", "retry")).toMatchObject({ status: "retrying" });
    expect(await service.transitionTask("worktask-1", "start")).toMatchObject({ status: "running" });
    expect(await service.transitionTask("worktask-1", "pause")).toMatchObject({ status: "paused" });
    expect(await service.transitionTask("worktask-1", "resume")).toMatchObject({ status: "queued" });
  });

  it("rejects illegal transitions without mutating persisted state", async () => {
    const { service } = await seededService();
    await expect(service.transitionTask("worktask-1", "start")).rejects.toMatchObject({ code: "invalid_task_transition" });
    expect(await service.getTask("worktask-1")).toMatchObject({ status: "draft" });
    await expect(service.transitionTask("worktask-unknown", "start")).rejects.toThrow(/does not exist/);
  });

  it("rejects creation with terminal status or invalid generation", async () => {
    const { service } = await seededService();
    await expect(service.createTask({ sessionId: "session-1", status: "completed" })).rejects.toThrow(/terminal status/);
    await expect(service.createTask({ sessionId: "session-1", generation: -1 })).rejects.toThrow(/generation/);
    await expect(service.createTask({ sessionId: "session-1", generation: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow(/generation/);
  });

  it("fences recovery by generation and terminal status", async () => {
    const { service } = await seededService();
    expect(await service.recoverTask("worktask-1", 4)).toMatchObject({ kind: "not_recoverable", reason: "status_not_recoverable" });
    await service.transitionTask("worktask-1", "queue");
    expect(await service.recoverTask("worktask-1", 4)).toMatchObject({ kind: "recovered", state: { status: "queued", generation: 4 } });
    expect(await service.recoverTask("worktask-1", 5)).toMatchObject({ kind: "not_recoverable", reason: "generation_mismatch" });
    expect(await service.recoverTask("worktask-unknown", 4)).toMatchObject({ kind: "not_recoverable", reason: "not_found" });
    await service.transitionTask("worktask-1", "start");
    await service.transitionTask("worktask-1", "cancel");
    expect(await service.recoverTask("worktask-1", 4)).toMatchObject({ kind: "not_recoverable", reason: "terminal_status" });
  });

  it("returns an actionable session_missing outcome instead of a silent empty result", async () => {
    const fixture = await seededService();
    const sessionIds = new Set(["session-1"]);
    // Same persistence, a resolver that answers against the session set.
    const bound = createTaskLifecycleService(fixture.persistence, {
      sessionExists: (id) => Promise.resolve(sessionIds.has(id)),
    });
    resources.push(() => bound.close());
    await bound.transitionTask("worktask-1", "queue");
    expect(await bound.recoverTask("worktask-1", 4)).toMatchObject({
      kind: "recovered",
      state: { status: "queued" },
    });
    sessionIds.delete("session-1");
    const outcome = await bound.recoverTask("worktask-1", 4);
    expect(outcome).toMatchObject({ kind: "session_missing", action: "rebind_session_or_restart", state: { sessionId: "session-1" } });
  });

  it("does not block recovery when no session resolver is wired", async () => {
    const fixture = makeService();
    await fixture.service.createTask({ taskId: "worktask-2", sessionId: "session-1" });
    await fixture.service.transitionTask("worktask-2", "queue");
    expect(await fixture.service.recoverTask("worktask-2", 0)).toMatchObject({ kind: "recovered" });
  });

  it("closes idempotently and rejects further access", async () => {
    const fixture = makeService();
    await fixture.service.createTask({ taskId: "worktask-3", sessionId: "session-1" });
    await fixture.service.close();
    await expect(fixture.service.close()).resolves.toBeUndefined();
    await expect(fixture.service.getTask("worktask-3")).rejects.toThrow(/closed/);
    await expect(fixture.service.transitionTask("worktask-3", "queue")).rejects.toThrow(/closed/);
    await expect(fixture.service.recoverTask("worktask-3", 0)).rejects.toThrow(/closed/);
    await expect(fixture.service.createTask({ sessionId: "session-1" })).rejects.toThrow(/closed/);
  });

  it("persists state through the store boundary", async () => {
    const { service, persistence } = await seededService();
    await service.transitionTask("worktask-1", "queue");
    const persisted = await persistence.read("worktask-1");
    expect(persisted).toMatchObject({ status: "queued", generation: 4, sessionId: "session-1" });
  });

  it("appends a create event and one event per transition with monotonic sequences", async () => {
    const { service, events } = await seededService();
    // createTask itself writes the first event.
    expect(await events.list("worktask-1")).toHaveLength(1);
    await service.transitionTask("worktask-1", "queue");
    await service.transitionTask("worktask-1", "start");
    await service.transitionTask("worktask-1", "complete");
    const records = await service.listEvents("worktask-1");
    expect(records.map((r) => `${r.event}:${r.toStatus}`)).toEqual([
      "create:draft",
      "queue:queued",
      "start:running",
      "complete:completed",
    ]);
    expect(records.map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
    expect(records[2]!.fromStatus).toBe("queued");
    expect(records[2]!.toStatus).toBe("running");
    // The listEvents API returns clones, not references to the log.
    expect(records[0]).not.toBe((await events.list("worktask-1"))[0]);
  });

  it("rejected transitions do not append events", async () => {
    const { service, events } = await seededService();
    const before = (await service.listEvents("worktask-1")).length;
    await expect(service.transitionTask("worktask-1", "complete")).rejects.toMatchObject({ code: "invalid_task_transition" });
    expect((await service.listEvents("worktask-1")).length).toBe(before);
    void events;
  });

  it("listEvents returns [] when no event log is wired", async () => {
    const persistence = new MemoryTaskLifecyclePersistence();
    const service = createTaskLifecycleService(persistence);
    resources.push(() => service.close());
    const state = await service.createTask({ sessionId: "session-x" });
    expect(await service.listEvents(state.taskId)).toEqual([]);
  });

  it("listTasks returns every persisted task by default and supports status / includeTerminal filters", async () => {
    const { service } = makeService();
    const draft = await service.createTask({ taskId: "task-draft", sessionId: "session-1" });
    const queued = await service.createTask({ taskId: "task-queued", sessionId: "session-1" });
    await service.transitionTask("task-queued", "queue");
    const done = await service.createTask({ taskId: "task-done", sessionId: "session-1" });
    await service.transitionTask("task-done", "queue");
    await service.transitionTask("task-done", "start");
    await service.transitionTask("task-done", "complete");

    // Default: non-terminal only.
    const live = await service.listTasks();
    expect(live.map((s) => s.taskId).sort()).toEqual(["task-draft", "task-queued"]);

    // Status filter narrows further.
    expect(await service.listTasks({ statuses: ["running"] })).toEqual([]);
    expect((await service.listTasks({ statuses: ["draft", "queued"] })).map((s) => s.taskId).sort()).toEqual(["task-draft", "task-queued"]);

    // includeTerminal exposes completed/cancelled too.
    const all = await service.listTasks({ includeTerminal: true });
    expect(all.map((s) => s.taskId).sort()).toEqual(["task-done", "task-draft", "task-queued"]);
    expect(all.find((s) => s.taskId === "task-done")!.status).toBe("completed");

    // Defensive: returned objects are clones, not references to the store.
    const snapshot = await service.listTasks();
    snapshot[0]!.status = "cancelled" as never;
    expect((await service.getTask(draft.taskId))!.status).toBe(draft.status);
    expect((await service.getTask(queued.taskId))!.status).toBe("queued");
  });

  it("listTasks returns [] and rejects nothing on an empty store", async () => {
    const persistence = new MemoryTaskLifecyclePersistence();
    const service = createTaskLifecycleService(persistence);
    resources.push(() => service.close());
    expect(await service.listTasks()).toEqual([]);
  });
});