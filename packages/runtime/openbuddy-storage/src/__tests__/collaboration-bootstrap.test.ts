import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CollaborationBootstrapStore, summarizeContract, summarizeCursor, summarizeEvent } from "../renderer/collaboration-bootstrap";

let root = "";

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  root = "";
});

describe("summarizers", () => {
  it("summarizes a contract and marks it as redacted", () => {
    const summary = summarizeContract({ taskId: "task-1", mode: "review", apiKey: "fixture-secret" });
    expect(summary).toEqual({ taskId: "task-1", mode: "review", redacted: true });
  });

  it("summarizes a cursor with acknowledged event count", () => {
    const summary = summarizeCursor({ principalId: "alice", lastReadEventId: "e-3", acknowledgedEventIds: ["e-1", "e-2", "e-3"] });
    expect(summary).toEqual({ principalId: "alice", lastReadEventId: "e-3", acknowledgedEventCount: 3 });
  });

  it("summarizes a sync event without leaking payload bytes", () => {
    const summary = summarizeEvent({ id: "e-1", kind: "task:proposed", payload: { apiKey: "fixture-secret" } });
    expect(summary).toEqual({ id: "e-1", redacted: true, payloadKeys: ["kind", "payload"] });
  });
});

describe("CollaborationBootstrapStore", () => {
  it("returns an empty snapshot when the database has no rows", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-collab-bootstrap-empty-"));
    const store = new CollaborationBootstrapStore({ databasePath: join(root, "openbuddy.sqlite"), stream: "collaboration:bootstrap-empty", now: () => "2026-08-30T20:00:00.000Z" });
    try {
      const snapshot = store.snapshot();
      expect(snapshot).toMatchObject({ schema: "openbuddy.storage-collaboration-bootstrap.v1", contracts: [], cursors: [], recentEvents: [], capturedAt: "2026-08-30T20:00:00.000Z" });
    } finally {
      await store.close();
    }
  });

  it("returns a snapshot with redacted contracts, cursors, and recent sync events", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-collab-bootstrap-populated-"));
    const store = new CollaborationBootstrapStore({ databasePath: join(root, "openbuddy.sqlite"), stream: "collaboration:bootstrap-pop", now: () => "2026-08-30T21:00:00.000Z", recentEventLimit: 4 });
    try {
      const internal = store as unknown as {
        contractInstance(): { upsert(contract: { taskId: string; mode: string }): void };
        cursorInstance(): { write(cursor: { principalId: string; acknowledgedEventIds: string[] }): void };
        syncInstance(): { append(value: Record<string, unknown>): boolean };
      };
      internal.contractInstance().upsert({ taskId: "task-1", mode: "review" });
      internal.contractInstance().upsert({ taskId: "task-2", mode: "execute" });
      internal.cursorInstance().write({ principalId: "alice", acknowledgedEventIds: ["e-1", "e-2"] });
      internal.syncInstance().append({ id: "e-1", kind: "task:proposed" });
      internal.syncInstance().append({ id: "e-2", kind: "task:settled" });
      const snapshot = store.snapshot();
      expect(snapshot).toMatchObject({ schema: "openbuddy.storage-collaboration-bootstrap.v1", capturedAt: "2026-08-30T21:00:00.000Z" });
      expect(snapshot.contracts.map((contract) => contract.taskId).sort()).toEqual(["task-1", "task-2"]);
      expect(snapshot.cursors).toEqual([{ principalId: "alice", acknowledgedEventCount: 2 }]);
      expect(snapshot.recentEvents.map((event) => event.id).sort()).toEqual(["e-1", "e-2"]);
      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain("fixture-secret");
    } finally {
      await store.close();
    }
  });
});
