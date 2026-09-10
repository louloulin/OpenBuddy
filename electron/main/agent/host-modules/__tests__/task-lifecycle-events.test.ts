import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteTaskLifecycleEventLog } from "../task-lifecycle-events";

const resources: Array<{ log: SqliteTaskLifecycleEventLog; dir: string }> = [];

afterEach(async () => { for (const r of resources.splice(0)) await r.log.close(); });

async function makeLog() {
  const dir = await mkdtemp(join(tmpdir(), "openbuddy-task-events-sqlite-"));
  const log = new SqliteTaskLifecycleEventLog({ databasePath: join(dir, "openbuddy.sqlite") });
  resources.push({ log, dir });
  return log;
}

const rec = (overrides: Partial<{
  taskId: string;
  fromStatus: string | undefined;
  toStatus: string;
  event: string;
  timestamp: string;
  generation: number;
}> = {}) => ({
  taskId: overrides.taskId ?? "worktask-1",
  fromStatus: overrides.fromStatus as never,
  toStatus: (overrides.toStatus ?? "queued") as never,
  event: (overrides.event ?? "queue") as never,
  timestamp: overrides.timestamp ?? "2026-09-10T00:00:00.000Z",
  generation: overrides.generation ?? 0,
});

describe("SqliteTaskLifecycleEventLog", () => {
  it("appends records with monotonically assigned sequences per task and lists them in order", async () => {
    const log = await makeLog();
    const first = await log.append(rec({ toStatus: "draft", event: "create" }));
    const second = await log.append(rec({ toStatus: "queued", event: "queue", fromStatus: "draft" }));
    const third = await log.append(rec({ toStatus: "running", event: "start", fromStatus: "queued" }));
    expect([first.sequence, second.sequence, third.sequence]).toEqual([1, 2, 3]);
    const listed = await log.list("worktask-1");
    expect(listed.map((r) => r.toStatus)).toEqual(["draft", "queued", "running"]);
    expect(listed[2]!.fromStatus).toBe("queued");
  });

  it("persists events across reopen and isolates by task id", async () => {
    const first = await makeLog();
    const dir = resources.at(-1)!.dir;
    await first.append(rec({ taskId: "task-a", toStatus: "draft", event: "create" }));
    await first.append(rec({ taskId: "task-a", toStatus: "queued", event: "queue", fromStatus: "draft" }));
    await first.append(rec({ taskId: "task-b", toStatus: "draft", event: "create" }));
    await first.close();
    resources.pop();

    const reopened = new SqliteTaskLifecycleEventLog({ databasePath: join(dir, "openbuddy.sqlite") });
    resources.push({ log: reopened, dir });
    expect(await reopened.list("task-a")).toHaveLength(2);
    expect(await reopened.list("task-b")).toHaveLength(1);
    expect(await reopened.list("nonexistent")).toEqual([]);
  });

  it("clear() removes only the requested task's records and reports the count", async () => {
    const log = await makeLog();
    await log.append(rec({ taskId: "task-a" }));
    await log.append(rec({ taskId: "task-a", toStatus: "queued" }));
    await log.append(rec({ taskId: "task-b" }));
    const removed = await log.clear("task-a");
    expect(removed).toBe(2);
    expect(await log.list("task-a")).toEqual([]);
    expect(await log.list("task-b")).toHaveLength(1);
  });
});