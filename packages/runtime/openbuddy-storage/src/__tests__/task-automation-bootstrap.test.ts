// Stage G-1c: openbuddy-automation removed; automation is owned by
// pi-background-tasks + pi-goal (passthrough). This test file used to
// also exercise AutomationBootstrapStore / redactAutomation*. That half
// has been deleted; only the task bootstrap tests remain.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { redactTaskSnapshot, TaskBootstrapStore } from "../renderer/task-automation-bootstrap";

let root = "";

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  root = "";
});

describe("TaskBootstrapStore", () => {
  it("returns a redacted task snapshot for a known session", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-task-bootstrap-"));
    const store = new TaskBootstrapStore({ databasePath: join(root, "openbuddy.sqlite"), now: () => "2026-08-30T10:00:00.000Z" });
    try {
      const empty = await store.snapshot("s-fixture");
      expect(empty).toMatchObject({ schema: "openbuddy.storage-task-bootstrap.v1", sessionId: "s-fixture", tasks: [], capturedAt: "2026-08-30T10:00:00.000Z" });
    } finally {
      await store.close();
    }
  });

  it("scrubs secret-shaped values embedded in task content via redact envelope", () => {
    const snapshot = {
      schema: "openbuddy.storage-task-bootstrap.v1" as const,
      sessionId: "s",
      capturedAt: "2026-08-30T10:00:00.000Z",
      tasks: [
        { id: "t1", content: "deploy apiKey=fixture-secret", status: "pending", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z", order: 0 },
      ],
    };
    const redacted = redactTaskSnapshot(snapshot);
    expect(redacted.tasks[0].content).not.toContain("fixture-secret");
    expect(redacted.tasks[0].content).toContain("[redacted]");
  });
});
