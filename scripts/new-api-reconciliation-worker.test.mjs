import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAdminHeaders, buildLogQuery, buildRecords, deriveQuotaBasedCost, readReconciliationCheckpoint, readReconciliationStatus, resolveCheckpointWindow, resolveLogWindow, resolveQuotaPerUnit, validateCapabilitySnapshotGate, validateFetchedLogWindow, validateMappedGroups, validateReconciliationQuality, validateReconciliationStatus, writeReconciliationCheckpoint, writeReconciliationStatus } from "./new-api-reconciliation-worker.mjs";

describe("New API reconciliation worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the verified instance quota unit instead of a hard-coded conversion", () => {
    expect(deriveQuotaBasedCost({ quota: 500000 }, 500000)).toBe(1);
    expect(deriveQuotaBasedCost({ quota: 500 }, 500)).toBe(1);
    expect(deriveQuotaBasedCost({ quota: 500000 }, 500)).toBe(1000);
  });

  it("reads quota_per_unit from New API status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { quota_per_unit: 500000 } }), { status: 200 })));
    await expect(resolveQuotaPerUnit("https://new-api.test", { authorization: "Bearer short-lived" })).resolves.toBe(500000);
  });

  it("rejects a stale explicit quota unit unless migration override is enabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { quota_per_unit: 500000 } }), { status: 200 })));
    await expect(resolveQuotaPerUnit("https://new-api.test", {}, "50")).rejects.toThrow("does not match");
    await expect(resolveQuotaPerUnit("https://new-api.test", {}, "50", { allowExplicitOverride: true })).resolves.toBe(50);
  });

  it("uses the current New API admin user identity", () => {
    expect(buildAdminHeaders("short-lived", "42", "session-1")).toEqual({
      authorization: "Bearer short-lived",
      "new-api-user": "42",
      "x-auth-session": "session-1",
    });
    expect(() => buildAdminHeaders("short-lived", "")).toThrow("NEW_API_ADMIN_USER_ID");
  });

  it("fails closed when status has no usable quota unit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { quota_per_unit: 0 } }), { status: 200 })));
    await expect(resolveQuotaPerUnit("https://new-api.test", {})).rejects.toThrow("quota_per_unit");
  });

  it("uses New API's current page_size log query parameter", () => {
    const query = buildLogQuery(2, 25, "2026-08-29T00:00:00.000Z", "2026-08-29T01:00:00.000Z");
    expect(Object.fromEntries(query)).toEqual({
      p: "2",
      page_size: "25",
      type: "2",
      start_timestamp: "1787961600",
      end_timestamp: "1787965200",
    });
    expect(query.has("size")).toBe(false);
  });

  it("fails closed when a mapped Group no longer exists in New API", async () => {
    await expect(validateMappedGroups("https://new-api.test", {}, { groups: { default: {}, enterprise: {} } }, async () => ({ data: [{ group: "default" }] }))).rejects.toThrow("enterprise");
    await expect(validateMappedGroups("https://new-api.test", {}, { groups: { default: {} } }, async () => ({ data: [{ name: "default" }] }))).resolves.toEqual({ checked: 1, missing: [] });
  });

  it("requires a fresh capability snapshot with matching quota before write mode", () => {
    const snapshot = { schema: "openbuddy.new-api-capability-snapshot.v1", generatedAt: "2026-08-30T00:00:00.000Z", status: { quotaPerUnit: 500000 }, groups: [{ name: "default" }], models: [{ id: "MiniMax-M3" }], channels: [{ id: "2", group: "default", models: ["MiniMax-M3"] }] };
    const capabilities = { default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "required", verifiedAt: "2026-08-30" } } } };
    expect(validateCapabilitySnapshotGate(snapshot, capabilities, { now: Date.parse("2026-08-30T06:00:00.000Z"), quotaPerUnit: 500000, groups: ["default"], models: ["MiniMax-M3"], channels: ["2"] })).toMatchObject({ quotaPerUnit: 500000, groups: 1 });
    expect(() => validateCapabilitySnapshotGate(snapshot, capabilities, { now: Date.parse("2026-08-30T06:00:00.000Z"), quotaPerUnit: 50 })).toThrow("does not match");
  });

  it("builds a rolling window for scheduled runs", () => {
    expect(resolveLogWindow(Date.parse("2026-08-29T01:00:00.000Z"), undefined, undefined, 60)).toEqual({
      since: "2026-08-29T00:00:00.000Z",
      until: "2026-08-29T01:00:00.000Z",
    });
  });

  it("replays an overlap from the last successful checkpoint", () => {
    const now = Date.parse("2026-08-29T02:00:00.000Z");
    expect(resolveCheckpointWindow(now, { lastSuccessfulUntil: "2026-08-29T01:00:00.000Z" }, 60, 10)).toEqual({
      since: "2026-08-29T00:50:00.000Z",
      until: "2026-08-29T02:00:00.000Z",
    });
    expect(resolveCheckpointWindow(now, undefined, 60, 10)).toEqual({
      since: "2026-08-29T01:00:00.000Z",
      until: "2026-08-29T02:00:00.000Z",
    });
  });

  it("writes and reads a restrictive checkpoint atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-reconciliation-checkpoint-"));
    const file = join(directory, "state", "checkpoint.json");
    try {
      await writeReconciliationCheckpoint(file, { lastSuccessfulUntil: "2026-08-29T02:00:00.000Z", imported: 4 });
      await expect(readReconciliationCheckpoint(file)).resolves.toMatchObject({ schemaVersion: 1, lastSuccessfulUntil: "2026-08-29T02:00:00.000Z", imported: 4 });
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ schemaVersion: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes a restrictive heartbeat and validates freshness", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-reconciliation-status-"));
    const file = join(directory, "state", "status.json");
    try {
      const completedAt = "2026-08-30T05:00:00.000Z";
      await writeReconciliationStatus(file, { runId: "run-1", status: "succeeded", startedAt: "2026-08-30T04:59:00.000Z", completedAt, imported: 3 });
      await expect(readReconciliationStatus(file)).resolves.toMatchObject({ schemaVersion: 1, runId: "run-1", status: "succeeded", imported: 3 });
      expect(validateReconciliationStatus(await readReconciliationStatus(file), { now: Date.parse("2026-08-30T06:00:00.000Z") })).toMatchObject({ runId: "run-1", completedAt });
      expect(() => validateReconciliationStatus({ schemaVersion: 1, status: "failed", completedAt }, { now: Date.parse("2026-08-30T06:00:00.000Z") })).toThrow("failed");
      expect(() => validateReconciliationStatus({ schemaVersion: 1, status: "succeeded", completedAt: "2026-08-29T00:00:00.000Z" }, { now: Date.parse("2026-08-30T06:00:00.000Z") })).toThrow("older");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires explicit reconciliation bounds to be paired", () => {
    expect(() => resolveLogWindow(Date.now(), "2026-08-29T00:00:00Z", undefined)).toThrow("provided together");
  });

  it("fails closed before checkpoint advancement when production import skips a log", () => {
    const result = { skipped: 1, skippedReasons: { "unknown-group": 1 } };
    expect(() => validateReconciliationQuality(result, true)).toThrow("refuses to advance checkpoint");
    expect(() => validateReconciliationQuality(result, false)).not.toThrow();
    expect(() => validateReconciliationQuality({ skipped: 0, skippedReasons: {} }, true)).not.toThrow();
  });

  it("fails closed when New API pagination does not cover the reported total", () => {
    expect(() => validateFetchedLogWindow(90, 100, true)).toThrow("incomplete pagination");
    expect(() => validateFetchedLogWindow(90, 100, false)).not.toThrow();
    expect(() => validateFetchedLogWindow(100, 100, true)).not.toThrow();
  });

  it("preserves quota-derived cost basis in imported records", () => {
    const result = buildRecords(
      { alice: { tenantId: "tenant-a", subject: "user-a" } },
      {},
      "new-api-log",
      "USD",
      [{ username: "alice", model_name: "MiniMax-M3", prompt_tokens: 10, completion_tokens: 5, quota: 500000, request_id: "request-1", created_at: "2026-08-29T00:00:00.000Z" }],
      500000,
    );
    const record = result.recordsByTenant.get("tenant-a")?.[0];
    expect(record).toMatchObject({ upstreamCost: 1, costBasis: "provider-reported-quota" });
  });

  it("requires a known New API group when the mapping declares groups", () => {
    const result = buildRecords(
      {
        groups: { default: { tenantId: "tenant-a" } },
        users: { alice: { tenantId: "tenant-a", subject: "user-a", group: "default" } },
      },
      {},
      "new-api-log",
      "USD",
      [{ username: "alice", group: "unknown", model_name: "MiniMax-M3", prompt_tokens: 10, completion_tokens: 5, quota: 500000, request_id: "request-unknown-group", created_at: "2026-08-29T00:00:00.000Z" }],
      500000,
    );
    expect(result.recordsByTenant.size).toBe(0);
    expect(result.skippedReasons).toEqual({ "unknown-group": 1 });
  });

  it("cross-checks token, user, and group tenant identity", () => {
    const result = buildRecords(
      {
        groups: { default: { tenantId: "tenant-a" } },
        users: { alice: { tenantId: "tenant-a", subject: "user-a", group: "default" } },
        tokens: { "7": { tenantId: "tenant-b", subject: "user-b", group: "default" } },
      },
      {},
      "new-api-log",
      "USD",
      [{ username: "alice", token_id: 7, group: "default", model_name: "MiniMax-M3", prompt_tokens: 10, completion_tokens: 5, quota: 500000, request_id: "request-mismatch", created_at: "2026-08-29T00:00:00.000Z" }],
      500000,
    );
    expect(result.recordsByTenant.size).toBe(0);
    expect(result.skippedReasons).toEqual({ "token-user-mismatch": 1 });
  });

  it("keeps the legacy username mapping compatible and records the log group", () => {
    const result = buildRecords(
      { alice: { tenantId: "tenant-a", subject: "user-a" } },
      {},
      "new-api-log",
      "USD",
      [{ username: "alice", group: "default", model_name: "MiniMax-M3", prompt_tokens: 10, completion_tokens: 5, quota: 500000, request_id: "request-legacy", created_at: "2026-08-29T00:00:00.000Z" }],
      500000,
    );
    expect(result.recordsByTenant.get("tenant-a")?.[0]).toMatchObject({ newApiGroup: "default" });
  });
  it("resolves Gateway subject metadata and rejects a conflicting actor", () => {
    const mapping = { groups: { default: { tenantId: "tenant-a" } }, subjects: { "user-a": { tenantId: "tenant-a", subject: "user-a", group: "default" } } };
    const accepted = buildRecords(mapping, {}, "new-api-log", "USD", [{ group: "default", openbuddy_subject: "user-a", openbuddy_actor: "user-a", model_name: "MiniMax-M3", prompt_tokens: 10, completion_tokens: 5, quota: 500000, request_id: "request-subject", created_at: "2026-08-29T00:00:00.000Z" }], 500000);
    expect(accepted.recordsByTenant.get("tenant-a")?.[0]).toMatchObject({ subject: "user-a", actorSubject: "user-a" });
    const rejected = buildRecords(mapping, {}, "new-api-log", "USD", [{ group: "default", openbuddy_subject: "user-a", openbuddy_actor: "other-user", model_name: "MiniMax-M3", prompt_tokens: 10, completion_tokens: 5, quota: 500000, request_id: "request-conflict", created_at: "2026-08-29T00:00:00.000Z" }], 500000);
    expect(rejected.recordsByTenant.size).toBe(0);
    expect(rejected.skippedReasons).toEqual({ "actor-subject-mismatch": 1 });
  });
  it("fails closed when a subject contract receives an unknown subject", () => {
    const result = buildRecords({ groups: { default: { tenantId: "tenant-a" } }, subjects: { "user-a": { tenantId: "tenant-a", subject: "user-a", group: "default" } }, users: { alice: { tenantId: "tenant-a", subject: "user-a", group: "default" } } }, {}, "new-api-log", "USD", [{ username: "alice", group: "default", openbuddy_subject: "unknown", model_name: "MiniMax-M3", prompt_tokens: 10, completion_tokens: 5, quota: 500000, request_id: "request-unknown-subject", created_at: "2026-08-29T00:00:00.000Z" }], 500000);
    expect(result.recordsByTenant.size).toBe(0);
    expect(result.skippedReasons).toEqual({ "unknown-subject": 1 });
  });
  it("captures New API channel routing and prompt cache telemetry into import records", () => {
    const result = buildRecords(
      { users: { "linchong": { tenantId: "tenant-cache", subject: "linchong" } } },
      {},
      "new-api-log",
      "USD",
      [
        {
          id: 9001,
          user_id: 1,
          created_at: 1788055000,
          type: 2,
          username: "linchong",
          token_name: "openbuddy-gateway-service",
          model_name: "MiniMax-M3",
          quota: 22,
          prompt_tokens: 200,
          completion_tokens: 5,
          channel: 2,
          channel_name: "OpenBuddy MiniMax M3",
          group: "default",
          request_id: "req-cache-001",
          other: JSON.stringify({ cache_ratio: 0.65, cache_tokens: 130, completion_ratio: 4, model_ratio: 0.0205, billing_source: "wallet" }),
        },
      ],
      500000,
    );
    const records = result.recordsByTenant.get("tenant-cache");
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.channel).toEqual({ id: "2", name: "OpenBuddy MiniMax M3" });
    expect(record.cache).toEqual({ ratio: 0.65, tokens: 130 });
    expect(record.costBasis).toBe("provider-reported-quota");
    expect(record.upstreamCost).toBeGreaterThan(0);
  });

  it("propagates OpenBuddy agent and session dimensions from log metadata", () => {
    const result = buildRecords(
      { users: { alice: { tenantId: "tenant-dimensions", subject: "user-a" } } },
      {},
      "new-api-log",
      "USD",
      [{ username: "alice", model_name: "MiniMax-M3", prompt_tokens: 10, completion_tokens: 5, quota: 500000, request_id: "request-dimensions", created_at: "2026-08-29T00:00:00.000Z", other: JSON.stringify({ agentId: "coding-agent", session_id: "session-001", x_openbuddy_wallet: "wallet-team" }) }],
      500000,
    );
    expect(result.recordsByTenant.get("tenant-dimensions")?.[0]).toMatchObject({ agentId: "coding-agent", sessionId: "session-001", walletId: "wallet-team", actorSubject: "user-a" });
  });

});
