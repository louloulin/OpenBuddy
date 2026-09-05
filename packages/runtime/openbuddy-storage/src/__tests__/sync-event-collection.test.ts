import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SyncEventCollection } from "../sqlite/sync-event-collection";

interface TestEvent {
  id: string;
  kind: string;
}

describe("SyncEventCollection", () => {
  let root = "";
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "openbuddy-sync-events-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("imports legacy JSONL, writes SQLite, mirrors new events, and is idempotent", async () => {
    const legacyPath = join(root, "events.jsonl");
    await writeFile(legacyPath, `${JSON.stringify({ id: "legacy-1", kind: "room.created" })}\n`);
    const options = { databasePath: join(root, "openbuddy.sqlite"), legacyPath, stream: "collaboration:test" };
    const first = new SyncEventCollection<TestEvent>(options);
    expect(first.list()).toEqual([{ id: "legacy-1", kind: "room.created" }]);
    expect(first.append({ id: "new-1", kind: "task.proposed" })).toBe(true);
    expect(first.append({ id: "new-1", kind: "task.proposed" })).toBe(false);
    first.close();
    const second = new SyncEventCollection<TestEvent>(options);
    expect(second.list().map((event) => event.id)).toEqual(["legacy-1", "new-1"]);
    second.close();
    expect((await readFile(legacyPath, "utf8")).split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("isolates event IDs across streams in one database", async () => {
    const databasePath = join(root, "openbuddy.sqlite");
    const left = new SyncEventCollection<TestEvent>({ databasePath, stream: "collaboration:left" });
    const right = new SyncEventCollection<TestEvent>({ databasePath, stream: "collaboration:right" });
    expect(left.append({ id: "same-id", kind: "left" })).toBe(true);
    expect(right.append({ id: "same-id", kind: "right" })).toBe(true);
    expect(left.list()).toEqual([{ id: "same-id", kind: "left" }]);
    expect(right.list()).toEqual([{ id: "same-id", kind: "right" }]);
    left.close();
    right.close();
  });

  it("allocates unique stream sequences across independent adapters", () => {
    const databasePath = join(root, "openbuddy.sqlite");
    const left = new SyncEventCollection<TestEvent>({ databasePath, stream: "collaboration:shared" });
    const right = new SyncEventCollection<TestEvent>({ databasePath, stream: "collaboration:shared" });
    expect(left.append({ id: "left", kind: "left" })).toBe(true);
    expect(right.append({ id: "right", kind: "right" })).toBe(true);
    left.close();
    right.close();

    const reopened = new SyncEventCollection<TestEvent>({ databasePath, stream: "collaboration:shared" });
    expect(reopened.list().map((event) => event.id)).toEqual(["left", "right"]);
    reopened.close();
  });

});
