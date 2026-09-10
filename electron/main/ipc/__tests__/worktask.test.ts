import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TaskLifecycleService } from "../../agent/host-modules/task-lifecycle-service";

type Handler = (event: unknown, args: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: Handler) => { handlers.set(channel, listener); },
  },
}));

const taskLifecycleModule = await import("../../agent/host-modules/task-lifecycle-service");
const { registerWorktaskIpc } = await import("../worktask");

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

async function mountService(): Promise<TaskLifecycleService> {
  const dir = await mkdtemp(join(tmpdir(), "openbuddy-worktask-ipc-"));
  process.env.OPENBUDDY_DATA_DIR = dir;
  cleanups.push(async () => { delete process.env.OPENBUDDY_DATA_DIR; });
  const service = taskLifecycleModule.defaultTaskLifecycleService({});
  taskLifecycleModule.registerTaskLifecycleService(service);
  cleanups.push(async () => {
    taskLifecycleModule.clearTaskLifecycleService(service);
    await service.close();
  });
  return service;
}

async function invoke(channel: string, payload: unknown): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return await handler({}, payload);
}

beforeEach(() => { handlers.clear(); });

describe("worktask IPC", () => {
  it("registers every worktask:* channel with the expected names", () => {
    registerWorktaskIpc();
    expect([...handlers.keys()].sort()).toEqual([
      "worktask:create",
      "worktask:events",
      "worktask:get",
      "worktask:recover",
      "worktask:transition",
    ]);
  });

  it("rejects invocation when the lifecycle service is not mounted", async () => {
    registerWorktaskIpc();
    await expect(invoke("worktask:get", { taskId: "x" })).rejects.toThrow(/not mounted/);
  });

  it("runs a create → transition → recover → events journey through IPC", async () => {
    await mountService();
    registerWorktaskIpc();
    const created = await invoke("worktask:create", { sessionId: "session-1" }) as { taskId: string; status: string };
    expect(created.status).toBe("draft");
    const queued = await invoke("worktask:transition", { taskId: created.taskId, event: "queue" }) as { status: string };
    expect(queued.status).toBe("queued");
    const got = await invoke("worktask:get", { taskId: created.taskId }) as { status: string };
    expect(got.status).toBe("queued");
    const recovered = await invoke("worktask:recover", { taskId: created.taskId, currentGeneration: 0 }) as { kind: string };
    expect(recovered.kind).toBe("recovered");
    const events = await invoke("worktask:events", { taskId: created.taskId }) as Array<{ toStatus: string }>;
    expect(events.map((e) => e.toStatus)).toEqual(["draft", "queued"]);
  });

  it("rejects invalid input with informative errors", async () => {
    await mountService();
    registerWorktaskIpc();
    await expect(invoke("worktask:get", {})).rejects.toThrow(/taskId/);
    await expect(invoke("worktask:create", { sessionId: 42 })).rejects.toThrow(/sessionId/);
    await expect(invoke("worktask:create", { sessionId: "s", status: "made-up" })).rejects.toThrow(/status/);
    await expect(invoke("worktask:transition", { taskId: "x", event: "banana" })).rejects.toThrow(/event/);
    await expect(invoke("worktask:recover", { taskId: "x" })).rejects.toThrow(/currentGeneration/);
    await expect(invoke("worktask:create", { sessionId: "s", generation: -1 })).rejects.toThrow(/generation/);
  });

  it("propagates lifecycle service errors (illegal transition / unknown task)", async () => {
    await mountService();
    registerWorktaskIpc();
    const created = await invoke("worktask:create", { sessionId: "session-1" }) as { taskId: string };
    await expect(invoke("worktask:transition", { taskId: created.taskId, event: "complete" })).rejects.toMatchObject({ code: "invalid_task_transition" });
    await expect(invoke("worktask:transition", { taskId: "nonexistent", event: "queue" })).rejects.toThrow(/does not exist/);
  });
});