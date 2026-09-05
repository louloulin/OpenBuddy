/**
 * task-service tests — Phase R3.0 / Stage G-1d.
 *
 * Pins the contract the `pi-todo` adapter invokes at
 * `electron/main/agent/pi-extensions.ts:756-791`. Without a real
 * implementation backed by TaskCatalog, the adapter's "real tool" path
 * was dead code in production.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskService } from "../task-service";
import { TaskCatalog } from "@openbuddy/storage";

function makeService(): TaskService {
  const tmp = mkdtempSync(join(tmpdir(), "openbuddy-task-svc-"));
  const dbPath = join(tmp, "sessions.db");
  const catalog = new TaskCatalog({ databasePath: dbPath });
  return new TaskService(catalog);
}

describe("TaskService", () => {
  let service: TaskService;
  const SESSION = "session-under-test";

  beforeEach(() => {
    service = makeService();
  });

  it("list returns an empty array for a fresh session", async () => {
    expect(await service.list(SESSION)).toEqual([]);
  });

  it("add inserts a task and returns its id", async () => {
    const result = await service.add(SESSION, "ship the dashboard");
    expect(result.id).toMatch(/^task-/);
    const list = await service.list(SESSION);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: result.id,
      content: "ship the dashboard",
      status: "pending",
    });
  });

  it("update marks a task completed and returns its id", async () => {
    const { id } = await service.add(SESSION, "x");
    const updated = await service.update(SESSION, id, { status: "completed" });
    expect(updated).toEqual({ id });
    const list = await service.list(SESSION);
    expect(list[0]?.status).toBe("completed");
  });

  it("update returns null when the task id is unknown", async () => {
    expect(await service.update(SESSION, "missing-id", { status: "completed" })).toBeNull();
  });

  it("remove drops the task by id", async () => {
    const a = await service.add(SESSION, "a");
    await service.add(SESSION, "b");
    await service.remove(SESSION, a.id);
    const list = await service.list(SESSION);
    expect(list.map((entry) => entry.content)).toEqual(["b"]);
  });

  it("remove is a no-op when the task id is unknown", async () => {
    await service.add(SESSION, "a");
    await service.remove(SESSION, "missing");
    expect(await service.list(SESSION)).toHaveLength(1);
  });

  it("clear removes completed tasks but keeps pending ones", async () => {
    const a = await service.add(SESSION, "todo");
    await service.add(SESSION, "done");
    // Updating an unknown id must resolve to `null`, not throw.
    expect(await service.update(SESSION, "unknown-id", { status: "completed" })).toBeNull();
    const ids = await service.list(SESSION);
    const done = ids.find((entry) => entry.content === "done");
    if (done) await service.update(SESSION, done.id, { status: "completed" });
    await service.clear(SESSION);
    const remaining = await service.list(SESSION);
    expect(remaining.map((entry) => entry.content)).toContain("todo");
    expect(remaining.find((entry) => entry.content === "done")).toBeUndefined();
    void a;
  });
});