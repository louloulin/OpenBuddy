// Stage G-1c: openbuddy-automation removed; automation is owned by
// pi-background-tasks + pi-goal (passthrough). This test file used to
// also exercise loadAutomationBootstrap. That half has been deleted;
// only the task bootstrap remains.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTaskBootstrap, resetTaskBootstrapStore } from "./workspace-bootstrap";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-task-ipc-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
  await resetTaskBootstrapStore();
});

afterEach(async () => {
  await resetTaskBootstrapStore();
  delete process.env.PI_CODING_AGENT_DIR;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = "";
});

describe("task bootstrap IPC façade", () => {
  it("returns a redacted task snapshot for renderer", async () => {
    const summary = await loadTaskBootstrap("s-fixture");
    expect(summary).toMatchObject({ schema: "openbuddy.storage-task-bootstrap.v1", sessionId: "s-fixture", tasks: [] });
    expect(JSON.stringify(summary)).not.toContain("apiKey");
  });
});
