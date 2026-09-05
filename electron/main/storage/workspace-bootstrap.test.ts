import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storageMetricsRegistry } from "@openbuddy/storage";
import { loadWorkspaceBootstrap, recentStorageMetrics, resetWorkspaceBootstrapStore } from "./workspace-bootstrap";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-workspace-bootstrap-ipc-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
  await resetWorkspaceBootstrapStore();
});

afterEach(async () => {
  await resetWorkspaceBootstrapStore();
  delete process.env.PI_CODING_AGENT_DIR;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = "";
});

describe("workspace-bootstrap IPC façade", () => {
  it("returns a redacted bootstrap snapshot for renderer", async () => {
    const summary = await loadWorkspaceBootstrap();
    expect(summary).toMatchObject({ schema: "openbuddy.storage-workspace-bootstrap.v1", workspaces: [], archivedSessionCount: 0 });
    expect(JSON.stringify(summary)).not.toContain("apiKey");
    expect(JSON.stringify(summary)).not.toContain("sessionIds");
  });

  it("exposes bounded metrics history", () => {
    storageMetricsRegistry().clearHistory();
    for (let i = 0; i < 5; i += 1) {
      storageMetricsRegistry().recordSnapshot({
        writes: i,
        busy: 0,
        rollbacks: 0,
        totalLatencyMs: i,
        maxLatencyMs: i,
        queueDepth: 0,
        schemaVersion: 10,
        migrationIssues: 0,
      }, 8);
    }
    const recent = recentStorageMetrics(3);
    expect(recent.map((entry) => entry.writes)).toEqual([2, 3, 4]);
  });
});
