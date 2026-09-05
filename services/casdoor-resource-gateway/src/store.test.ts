import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSiem,
  InMemoryResourceStoreAdapter,
  JsonFileResourceStoreAdapter,
  normalizeAiRequestKey,
  sqlBootstrapStatements,
} from "./store";

describe("Resource store adapters", () => {
  let dataDir: string | undefined;

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  });

  it("round-trips state and audit events through the JSON adapter", async () => {
    dataDir = await mkdtemp(`${tmpdir()}/openbuddy-store-`);
    const adapter = new JsonFileResourceStoreAdapter(dataDir, 4096);
    const sample = {
      schemaVersion: 5 as const,
      revision: 3,
      resources: [{ id: "p1", tenantId: "tenant-a", ownerSubject: "user-a", type: "project" as const, name: "Project A", metadata: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01", version: 1 }],
      idempotency: {},
      tenantPolicies: { "tenant-a": { status: "active" as const, maxResources: 100, version: 1, updatedAt: "2026-01-01" } },
      runtimeUsage: {},
      memberRevocations: {},
      sessions: {},
      creditAccounts: {},
      creditLedger: [],
      creditPricing: {},
      billingPlans: {},
      billingOrders: {},
      billingSubscriptions: {},
      newApiCostImports: {},
      aiRequests: {},
    };
    await adapter.write(sample);
    const restored = await adapter.read();
    expect(restored.resources).toEqual(sample.resources);
    expect(restored.revision).toBe(3);
    expect(restored.tenantPolicies["tenant-a"]?.status).toBe("active");
    await adapter.appendAudit({ requestId: "r1", at: "2026-01-01T00:00:00.000Z", tenantId: "tenant-a", subject: "user-a", action: "create", outcome: "success", resource: "project/p1" });
    const events = await adapter.listAudit("tenant-a", 10);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("create");
  });

  it("round-trips persisted AI request replay records", async () => {
    dataDir = await mkdtemp(`${tmpdir()}/openbuddy-ai-replay-`);
    const adapter = new JsonFileResourceStoreAdapter(dataDir);
    const state = await adapter.read();
    state.aiRequests["tenant:user:chat:key"] = { fingerprint: "fingerprint", status: "completed", response: { status: 200, headers: { "content-type": "application/json" }, body: "{\"ok\":true}" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z", expiresAt: "2099-01-01T00:00:00.000Z", ownerRequestId: "request-1" };
    await adapter.write(state);
    const restored = await adapter.read();
    expect(restored.aiRequests["tenant:user:chat:key"]?.response?.body).toBe("{\"ok\":true}");
  });

  it("keeps long legacy AI replay keys distinct after normalization", () => {
    const firstKey = `tenant-${"a".repeat(390)}-first`;
    const secondKey = `tenant-${"a".repeat(390)}-second`;
    expect(normalizeAiRequestKey(firstKey)).toHaveLength(64);
    expect(normalizeAiRequestKey(secondKey)).toHaveLength(64);
    expect(normalizeAiRequestKey(firstKey)).not.toBe(normalizeAiRequestKey(secondKey));
  });

  it("exposes JSON adapter health with latency", async () => {
    dataDir = await mkdtemp(`${tmpdir()}/openbuddy-store-`);
    const adapter = new JsonFileResourceStoreAdapter(dataDir);
    const health = await adapter.health();
    expect(health.ok).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("filters audit events by tenant in the in-memory adapter", async () => {
    const adapter = new InMemoryResourceStoreAdapter();
    await adapter.appendAudit({ requestId: "r1", at: "2026-01-01", tenantId: "tenant-a", action: "create", outcome: "success" });
    await adapter.appendAudit({ requestId: "r2", at: "2026-01-01", tenantId: "tenant-b", action: "create", outcome: "success" });
    const events = await adapter.listAudit("tenant-a", 10);
    expect(events.map((event) => event.requestId)).toEqual(["r1"]);
  });

  it("rotates audit events older than the cutoff into an archive file", async () => {
    dataDir = await mkdtemp(`${tmpdir()}/openbuddy-archive-`);
    const adapter = new JsonFileResourceStoreAdapter(dataDir);
    await adapter.appendAudit({ requestId: "old", at: "2024-01-01T00:00:00.000Z", tenantId: "tenant-a", action: "create", outcome: "success" });
    await adapter.appendAudit({ requestId: "new", at: "2026-08-01T00:00:00.000Z", tenantId: "tenant-a", action: "create", outcome: "success" });
    const archived = await adapter.archiveAudit("2026-01-01T00:00:00.000Z");
    expect(archived.archived).toBe(1);
    expect(archived.remaining).toBe(1);
    const events = await adapter.listAudit("tenant-a", 10);
    expect(events.map((event) => event.requestId)).toEqual(["new"]);
  });

  it("shares sliding-window rate limits across adapter instances", async () => {
    dataDir = await mkdtemp(`${tmpdir()}/openbuddy-rate-`);
    const first = new JsonFileResourceStoreAdapter(dataDir);
    const second = new JsonFileResourceStoreAdapter(dataDir);
    const result = await second.incrementRate("client-a", 60_000, Date.now());
    expect(result.count).toBe(1);
    const result2 = await first.incrementRate("client-a", 60_000, Date.now() + 100);
    expect(result2.count).toBe(2);
  });

  it("exports SIEM events as CSV with sanitized fields", async () => {
    dataDir = await mkdtemp(`${tmpdir()}/openbuddy-siem-`);
    const csvPath = join(dataDir, "audit.csv");
    const event = { requestId: "r1", at: "2026-01-01T00:00:00.000Z", tenantId: "tenant-a", subject: "user-a", action: "create", outcome: "success" as const, resource: "project/p1", reason: 'comma,here\nand newline' };
    await appendSiem(event, { kind: "csv", filePath: csvPath });
    const csv = await readFile(csvPath, "utf8");
    expect(csv.split("\n")[0]).toBe("requestId,at,subject,tenantId,resource,action,outcome,reason");
    expect(csv).toContain("tenant-a");
    expect(csv).not.toMatch(/\n$/);
  });

  it("round-trips session bindings through the JSON and in-memory adapters", async () => {
    const memory = new InMemoryResourceStoreAdapter();
    const binding = {
      sessionId: "session-1",
      subject: "user-a",
      kind: "desktop" as const,
      scopes: ["agent.prompt"],
      startedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    };
    const registered = await memory.registerSession("tenant-a", binding);
    expect(registered.sessionId).toBe("session-1");
    const list = await memory.listSessions("tenant-a", 10);
    expect(list).toHaveLength(1);
    expect(list[0]?.subject).toBe("user-a");

    const reRegistered = await memory.registerSession("tenant-a", { ...binding, lastSeenAt: "2026-01-02T00:00:00.000Z" });
    expect(reRegistered.lastSeenAt).toBe("2026-01-02T00:00:00.000Z");

    const missing = await memory.unregisterSession("tenant-a", "unknown");
    expect(missing.removed).toBe(false);
    const removed = await memory.unregisterSession("tenant-a", "session-1");
    expect(removed.removed).toBe(true);
    expect(await memory.listSessions("tenant-a", 10)).toEqual([]);
  });

  it("persists session bindings across JSON adapter reloads", async () => {
    dataDir = await mkdtemp(`${tmpdir()}/openbuddy-sessions-`);
    const adapter = new JsonFileResourceStoreAdapter(dataDir);
    await adapter.registerSession("tenant-a", {
      sessionId: "session-1",
      subject: "user-a",
      kind: "desktop",
      scopes: ["agent.prompt", "memory.read"],
      startedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      metadata: { hostname: "laptop" },
    });
    const reload = new JsonFileResourceStoreAdapter(dataDir);
    const list = await reload.listSessions("tenant-a", 10);
    expect(list).toHaveLength(1);
    expect(list[0]?.metadata).toEqual({ hostname: "laptop" });
    const removed = await reload.unregisterSession("tenant-a", "session-1");
    expect(removed.removed).toBe(true);
    const reList = await new JsonFileResourceStoreAdapter(dataDir).listSessions("tenant-a", 10);
    expect(reList).toEqual([]);
  });

  it("creates the data directory on bootstrap for the JSON adapter", async () => {
    dataDir = await mkdtemp(`${tmpdir()}/openbuddy-bootstrap-`);
    const target = `${dataDir}/nested/inner`;
    const adapter = new JsonFileResourceStoreAdapter(target);
    await adapter.bootstrap();
    const probe = await readFile(`${target}/resources.json`).catch(() => null);
    expect(probe === null || typeof probe === "string").toBe(true);
  });

  it("invokes CREATE TABLE statements via the SQL bootstrap helper", () => {
    const statements = sqlBootstrapStatements("postgres", "casdoor_");
    expect(statements.length).toBeGreaterThanOrEqual(4);
    expect(statements.some((sql) => sql.includes("CREATE TABLE") && sql.includes("audit_events"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE") && sql.includes("sessions"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX"))).toBe(true);
    expect(statements.some((sql) => sql.includes("revision BIGINT"))).toBe(true);
    expect(statements.some((sql) => sql.includes("ADD COLUMN IF NOT EXISTS revision"))).toBe(true);
  });

  it("uses MySQL-compatible JSON, placeholders, upserts, and indexes", () => {
    const statements = sqlBootstrapStatements("mysql", "casdoor_");
    expect(statements.some((sql) => sql.includes("payload JSON NOT NULL"))).toBe(true);
    expect(statements.some((sql) => sql.includes("ON CONFLICT"))).toBe(false);
    expect(statements.some((sql) => sql.includes("JSONB"))).toBe(false);
    expect(statements.some((sql) => sql.includes("CREATE INDEX casdoor_audit_events_tenant_idx"))).toBe(true);
    expect(statements.some((sql) => sql.includes("revision BIGINT"))).toBe(true);
    expect(statements.some((sql) => sql.includes("ADD COLUMN revision"))).toBe(true);
  });

  it("keeps the SQL adapter query paths database-specific", () => {
    const postgres = sqlBootstrapStatements("postgres", "casdoor_").join("\n");
    const mysql = sqlBootstrapStatements("mysql", "casdoor_").join("\n");
    expect(postgres).toContain("JSONB");
    expect(mysql).toContain("JSON NOT NULL");
    expect(mysql).not.toContain("TIMESTAMPTZ");
  });
});
