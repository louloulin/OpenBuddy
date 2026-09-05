import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReconciliationHeartbeat } from "./check-reconciliation-heartbeat.mjs";
import { writeReconciliationStatus } from "./new-api-reconciliation-worker.mjs";

describe("reconciliation heartbeat watchdog", () => {
  it("accepts a recent successful run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-heartbeat-"));
    const file = join(directory, "status.json");
    try {
      await writeReconciliationStatus(file, { runId: "run-1", status: "succeeded", completedAt: "2026-08-30T05:00:00.000Z" });
      await expect(checkReconciliationHeartbeat({ file, now: Date.parse("2026-08-30T06:00:00.000Z") })).resolves.toMatchObject({ status: "passed", runId: "run-1" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails when the latest run is failed, running, missing, or stale", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-heartbeat-"));
    const file = join(directory, "status.json");
    try {
      await expect(checkReconciliationHeartbeat({ file, now: Date.parse("2026-08-30T06:00:00.000Z") })).rejects.toThrow("missing");
      await writeReconciliationStatus(file, { runId: "run-2", status: "failed", completedAt: "2026-08-30T05:00:00.000Z" });
      await expect(checkReconciliationHeartbeat({ file, now: Date.parse("2026-08-30T06:00:00.000Z") })).rejects.toThrow("failed");
      await writeReconciliationStatus(file, { runId: "run-3", status: "succeeded", completedAt: "2026-08-28T05:00:00.000Z" });
      await expect(checkReconciliationHeartbeat({ file, now: Date.parse("2026-08-30T06:00:00.000Z") })).rejects.toThrow("older");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
