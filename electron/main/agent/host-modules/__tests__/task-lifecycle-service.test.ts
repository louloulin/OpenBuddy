import { afterEach, describe, expect, it } from "vitest";
import type { TaskLifecyclePersistence, TaskLifecycleState } from "@openbuddy/plugin-host";
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
}

interface Fixture {
  service: TaskLifecycleService;
  persistence: MemoryTaskLifecyclePersistence;
  sessionIds: Set<string>;
}

const resources: Array<() => Promise<void>> = [];

afterEach(async () => { for (const close of resources.splice(0)) await close(); });

function makeService(resolver?: (sessionId: string) => Promise<boolean>): Fixture {
  const persistence = new MemoryTaskLifecyclePersistence();
  const service = createTaskLifecycleService(persistence, resolver ? { sessionExists: resolver } : {});
  resources.push(() => service.close());
  return { service, persistence, sessionIds: new Set(["session-1"]) };
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
});