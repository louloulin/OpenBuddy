import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTaskLifecycleStore, type TaskLifecycleState } from "@openbuddy/plugin-host";
import { SqliteTaskLifecyclePersistence } from "./task-lifecycle-sqlite";

const base: TaskLifecycleState = { taskId: "task-sqlite-1", sessionId: "session-1", generation: 4, status: "draft", updatedAt: "t0" };
const resources: Array<{ persistence: SqliteTaskLifecyclePersistence; dir: string }> = [];

afterEach(async () => { for (const resource of resources.splice(0)) await resource.persistence.close(); });

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "openbuddy-task-lifecycle-sqlite-"));
  const databasePath = join(dir, "openbuddy.sqlite");
  const persistence = new SqliteTaskLifecyclePersistence(databasePath);
  resources.push({ persistence, dir });
  return { store: createTaskLifecycleStore(persistence), databasePath };
}

describe("SqliteTaskLifecyclePersistence", () => {
  it("recovers a persisted lifecycle state after reopening the database", async () => {
    const { store: first, databasePath } = await makeStore();
    await first.create(base);
    await first.transition(base.taskId, "queue", "t1");
    await first.transition(base.taskId, "start", "t2");
    await first.transition(base.taskId, "fail", "t3");
    const original = resources.shift()!;
    await original.persistence.close();

    const reopenedPersistence = new SqliteTaskLifecyclePersistence(databasePath);
    resources.push({ persistence: reopenedPersistence, dir: original.dir });
    const reopened = createTaskLifecycleStore(reopenedPersistence);
    expect(await reopened.get(base.taskId)).toMatchObject({ status: "failed", generation: 4 });
  });

  it("serializes concurrent transitions through the canonical SQLite adapter", async () => {
    const { store } = await makeStore();
    await store.create(base);
    const [queued, started] = await Promise.all([
      store.transition(base.taskId, "queue", "t1"),
      store.transition(base.taskId, "start", "t2"),
    ]);
    expect(queued.status).toBe("queued");
    expect(started.status).toBe("running");
    expect(await store.get(base.taskId)).toMatchObject({ status: "running" });
  });
});
