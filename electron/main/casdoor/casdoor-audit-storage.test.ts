import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test file invocation gets one shared userData; per-test isolation comes
// from each test recreating it via a per-test temp subdir, so the storage module
// is re-evaluated fresh per test.
let userData: string;
let casdoorAudit: typeof import("./casdoor-audit")["casdoorAudit"];

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), "casdoor-audit-storage-"));
  // The storage module caches the storage promise keyed by storagePath() inside
  // app.getPath("userData"); reset the module cache so the freshly mocked
  // app.getPath resolves to the new userData.
  vi.resetModules();
  vi.doMock("electron", () => ({ app: { getPath: () => userData } }));
  const mod = await import("./casdoor-audit");
  casdoorAudit = mod.casdoorAudit;
});

afterEach(async () => {
  if (casdoorAudit) await casdoorAudit.close().catch(() => undefined);
  vi.doUnmock("electron");
  vi.resetModules();
  rmSync(userData, { recursive: true, force: true });
});

describe("casdoor-audit EventStore-backed service", () => {
  it("round-trips events through EventStore and reads them via list()", async () => {
    await casdoorAudit.record({ event: "login", outcome: "success", subject: "user-1", tenantId: "tenant-a" });
    await casdoorAudit.record({ event: "logout", outcome: "success", subject: "user-1", tenantId: "tenant-a" });
    await casdoorAudit.record({ event: "authorization.local", outcome: "deny", subject: "user-1", tenantId: "tenant-a", resource: "doc:1", action: "read", reason: "no permission" });
    await casdoorAudit.record({ event: "tenant.switch", outcome: "success", subject: "user-1", tenantId: "tenant-b" });

    const tenantA = await casdoorAudit.list("tenant-a");
    const tenantB = await casdoorAudit.list("tenant-b");
    expect(tenantA.map((e) => e.event)).toEqual(expect.arrayContaining(["login", "logout", "authorization.local"]));
    expect(tenantB.map((e) => e.event)).toEqual(["tenant.switch"]);
    expect(tenantA.find((e) => e.tenantId === "tenant-b")).toBeUndefined();
    expect(tenantB.find((e) => e.tenantId === "tenant-a")).toBeUndefined();
  });

  it("redacts sensitive credentials in the reason before storage", async () => {
    await casdoorAudit.record({
      event: "authorization.local",
      outcome: "deny",
      subject: "user-2",
      tenantId: "tenant-c",
      reason: "password=hunter2 access_token=eyJabc",
    });
    const events = await casdoorAudit.list("tenant-c");
    expect(events).toHaveLength(1);
    expect(events[0].reason).toContain("password=[redacted]");
    expect(events[0].reason).toContain("access_token=[redacted]");
    expect(events[0].reason).not.toContain("hunter2");
  });

  it("imports the legacy JSONL once and then deletes it", async () => {
    const legacy = join(userData, "casdoor-audit.jsonl");
    mkdirSync(userData, { recursive: true });
    const legacyEntry = { id: "legacy-uuid", at: "2025-01-01T00:00:00.000Z", event: "login", outcome: "success", subject: "legacy", tenantId: "tenant-legacy" };
    writeFileSync(legacy, JSON.stringify(legacyEntry) + "\n", { encoding: "utf8", mode: 0o600 });

    const events = await casdoorAudit.list("tenant-legacy");
    expect(events.some((e) => e.id === "legacy-uuid")).toBe(true);
    expect(() => readFileSync(legacy)).toThrow();
  });

  it("honours OPENBUDDY_CASDOOR_AUDIT_MAX_EVENTS retention cap", async () => {
    // retentionLimit accepts env values in [50, 10_000]; we set the floor so
    // the test stays in range while exercising the cap behaviour.
    process.env.OPENBUDDY_CASDOOR_AUDIT_MAX_EVENTS = "60";
    vi.resetModules();
    vi.doMock("electron", () => ({ app: { getPath: () => userData } }));
    const mod = await import("./casdoor-audit");
    const freshService = mod.casdoorAudit;
    try {
      for (let i = 0; i < 80; i += 1) {
        await freshService.record({ event: "ev", outcome: "allow", subject: `s${i}` });
      }
      const all = await freshService.list();
      expect(all.length).toBeLessThanOrEqual(60);
      expect(all.length).toBeGreaterThan(0);
    } finally {
      await freshService.close();
      delete process.env.OPENBUDDY_CASDOOR_AUDIT_MAX_EVENTS;
    }
  });
});
