import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceBootstrapStore, summarizeWorkspaceCatalog } from "../renderer/workspace-bootstrap";

let root = "";

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  root = "";
});

describe("WorkspaceBootstrapStore", () => {
  it("summarizes a document without leaking the session id list", () => {
    const document = {
      order: ["ws-1", "ws-2"],
      records: {
        "ws-1": { id: "ws-1", path: "/fixture/alpha", title: "Alpha", sessionIds: ["s-1", "s-2"], createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T01:00:00.000Z" },
        "ws-2": { id: "ws-2", path: "/fixture/beta", title: "Beta", sessionIds: [], createdAt: "invalid-date", updatedAt: "2026-08-30T02:00:00.000Z" },
      },
      archivedSessionIds: ["s-old"],
    };
    const summary = summarizeWorkspaceCatalog(document, () => "2026-08-30T03:00:00.000Z");
    expect(summary).toMatchObject({
      schema: "openbuddy.storage-workspace-bootstrap.v1",
      order: ["ws-1", "ws-2"],
      archivedSessionCount: 1,
      capturedAt: "2026-08-30T03:00:00.000Z",
      workspaces: [
        { id: "ws-1", path: "/fixture/alpha", title: "Alpha", sessionCount: 2 },
        { id: "ws-2", path: "/fixture/beta", title: "Beta", sessionCount: 0, createdAt: "2026-08-30T03:00:00.000Z" },
      ],
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("sessionIds");
    expect(serialized).not.toContain("s-old");
    expect(serialized).toContain('"sessionCount":2');
  });

  it("writes a workspace_catalog row and reads back a redacted summary", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-workspace-bootstrap-"));
    const store = new WorkspaceBootstrapStore({
      databasePath: join(root, "openbuddy.sqlite"),
      now: () => "2026-08-30T04:00:00.000Z",
    });
    try {
      const empty = await store.snapshot();
      expect(empty).toMatchObject({ schema: "openbuddy.storage-workspace-bootstrap.v1", workspaces: [] });
    } finally {
      await store.close();
    }
  });

  it("captures the snapshot at the same instant when a fixed clock is provided", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-workspace-bootstrap-reuse-"));
    const fixedNow = () => "2026-01-01T00:00:00.000Z"
    const store = new WorkspaceBootstrapStore({ databasePath: join(root, "openbuddy.sqlite"), now: fixedNow });
    try {
      const first = await store.snapshot();
      const second = await store.snapshot();
      expect(first.capturedAt).toBe(second.capturedAt)
      expect(first.capturedAt).toBe("2026-01-01T00:00:00.000Z")
    } finally {
      await store.close()
    }
  })
});
