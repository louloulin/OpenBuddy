#!/usr/bin/env node

import { readReconciliationStatus, validateReconciliationStatus } from "./new-api-reconciliation-worker.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";

export const checkReconciliationHeartbeat = async ({ file, now = Date.now(), maxAgeHours = 26 } = {}) => {
  const statusFile = text(file);
  if (!statusFile) throw new Error("NEW_API_RECONCILIATION_STATUS_FILE is required");
  const status = await readReconciliationStatus(statusFile);
  const result = validateReconciliationStatus(status, { now, maxAgeHours });
  return { status: "passed", statusFile, ...result };
};

export const main = async () => {
  const result = await checkReconciliationHeartbeat({
    file: process.env.NEW_API_RECONCILIATION_STATUS_FILE || "/var/lib/openbuddy/new-api-reconciliation-status.json",
    maxAgeHours: Number(process.env.NEW_API_RECONCILIATION_MAX_AGE_HOURS || "26"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (process.argv[1]?.endsWith("check-reconciliation-heartbeat.mjs")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
