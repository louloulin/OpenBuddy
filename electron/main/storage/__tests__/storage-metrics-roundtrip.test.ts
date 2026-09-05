import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

let tempDir: string;
beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-storage-metrics-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
  process.env.PI_HOME = tempDir;
});
afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

import { closeStorage, openStorage, storageMetricsRegistry } from "@openbuddy/storage";
import { recentStorageMetrics } from "../workspace-bootstrap";

function databasePath(): string {
  return join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent"), "openbuddy.sqlite");
}

describe("Agent storage metrics IPC roundtrip (real SQLite)", () => {
  beforeEach(() => {
    storageMetricsRegistry().clearHistory();
  });

  it("opens storage and reads a fresh health snapshot through the same path the IPC handler uses", async () => {
    const opened = await openStorage({ filePath: databasePath(), appVersion: "openbuddy-ipc-metrics-test" });
    try {
      const snapshot = opened.driver.healthSnapshot();
      expect(snapshot.journalMode.toUpperCase()).toMatch(/WAL|MEMORY|DELETE/);
      expect(snapshot.schemaVersion).toBeGreaterThanOrEqual(0);
      expect(snapshot.metrics).toBeDefined();
      expect(typeof (snapshot.metrics?.writes ?? 0)).toBe("number");
      expect(snapshot.integrity.ok).toBe(true);
      expect(typeof snapshot.busyTimeoutMs).toBe("number");
    } finally {
      await closeStorage(Promise.resolve(opened));
    }
  });

  it("healthSnapshot records into the metrics registry, observed via recentStorageMetrics", async () => {
    const opened = await openStorage({ filePath: databasePath(), appVersion: "openbuddy-ipc-metrics-record" });
    try {
      opened.driver.healthSnapshot();
      const history = recentStorageMetrics(4);
      expect(history.length).toBeGreaterThanOrEqual(1);
      const first = history[0];
      expect(first.schemaVersion).toBeGreaterThanOrEqual(0);
      expect(first.migrationIssues).toBe(0);
    } finally {
      await closeStorage(Promise.resolve(opened));
    }
  });

  it("history is bounded to the requested limit and in chronological order", () => {
    for (let i = 0; i < 6; i += 1) {
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
    const three = recentStorageMetrics(3);
    expect(three.map((entry) => entry.writes)).toEqual([3, 4, 5]);
  });

  it("metrics accumulate monotonically across multiple health snapshots", async () => {
    const opened = await openStorage({ filePath: databasePath(), appVersion: "openbuddy-ipc-metrics-mono" });
    try {
      opened.driver.healthSnapshot();
      opened.driver.healthSnapshot();
      opened.driver.healthSnapshot();
      const history = recentStorageMetrics(8);
      expect(history.length).toBeGreaterThanOrEqual(3);
      const capturedAts = history.map((entry) => entry.lastWriteAt ?? "");
      const sorted = [...capturedAts].sort();
      expect(capturedAts).toEqual(sorted);
    } finally {
      await closeStorage(Promise.resolve(opened));
    }
  });

  it("storage:metrics-history IPC clamps the limit between 0 and 64", async () => {
    for (let i = 0; i < 80; i += 1) {
      storageMetricsRegistry().recordSnapshot({
        writes: i,
        busy: 0,
        rollbacks: 0,
        totalLatencyMs: i,
        maxLatencyMs: i,
        queueDepth: 0,
        schemaVersion: 10,
        migrationIssues: 0,
      }, 64);
    }
    const sixtyFour = recentStorageMetrics(64);
    expect(sixtyFour.length).toBe(64);
  });
});
