import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CollaborationContractStore, CollaborationInboxCursorStore } from "../sqlite/collaboration-state";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

describe("collaboration SQLite state", () => {
  it("imports contracts once, persists them in SQLite, and mirrors legacy JSON", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-state-"));
    const legacyPath = join(root, "events.contracts.json");
    const contract = { taskId: "task-1", mode: "personal", title: "标题", objective: "private objective", executionRef: { taskId: "task-1" } };
    await writeFile(legacyPath, `${JSON.stringify({ "task-1": contract })}\n`);
    const databasePath = join(root, "openbuddy.sqlite");
    const first = new CollaborationContractStore({ databasePath, legacyPath });
    expect(first.list()).toEqual([contract]);
    first.upsert({ ...contract, title: "updated" });
    expect(JSON.parse(await readFile(legacyPath, "utf8"))["task-1"].title).toBe("updated");
    first.close();
    const reopened = new CollaborationContractStore({ databasePath, legacyPath });
    expect(reopened.get("task-1")).toMatchObject({ title: "updated" });
    reopened.close();
  });

  it("imports and persists inbox cursors without losing acknowledgements", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-cursor-state-"));
    const legacyPath = join(root, "events.cursor.json");
    await writeFile(legacyPath, JSON.stringify({ principalId: "buddy-local", lastReadEventId: "event-1", acknowledgedEventIds: ["event-1"] }));
    const databasePath = join(root, "openbuddy.sqlite");
    const store = new CollaborationInboxCursorStore({ databasePath, legacyPath });
    expect(store.read("buddy-local")).toEqual({ principalId: "buddy-local", lastReadEventId: "event-1", acknowledgedEventIds: ["event-1"] });
    store.write({ principalId: "buddy-local", acknowledgedEventIds: ["event-1", "event-2", "event-2"] });
    expect(JSON.parse(await readFile(legacyPath, "utf8"))).toEqual({ principalId: "buddy-local", acknowledgedEventIds: ["event-1", "event-2"] });
    store.close();
  });

  it("fails closed for malformed contract and cursor legacy files", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-invalid-state-"));
    const contractsPath = join(root, "events.contracts.json");
    await writeFile(contractsPath, "not-json\n");
    expect(() => new CollaborationContractStore({ databasePath: join(root, "invalid-contracts.sqlite"), legacyPath: contractsPath })).toThrow("collaboration contracts legacy source failed");
    const cursorPath = join(root, "events.cursor.json");
    await writeFile(cursorPath, "not-json\n");
    expect(() => new CollaborationInboxCursorStore({ databasePath: join(root, "invalid-cursor.sqlite"), legacyPath: cursorPath })).toThrow("collaboration cursor legacy source failed");
  });
});
