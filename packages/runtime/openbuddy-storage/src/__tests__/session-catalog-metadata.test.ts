/**
 * Phase 6 e2e — real SQLite SessionCatalog for session metadata.
 *
 * Replaces the deleted packages/runtime/openbuddy-storage/src/__tests__/
 * {session-event-log, session-catalog, migration-fixture}.test.ts by exercising
 * the same SQLite-backed SessionCatalog that openbuddy-session mounts at runtime.
 *
 * Note: the task brief mentioned a `SessionMetaStore` wrapper; the actual
 * public API for pinned / archived / expert metadata lives on `SessionCatalog`
 * (re-exported from `@openbuddy/storage`). We test that surface directly.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openStorage, SessionCatalog, closeStorage } from "@openbuddy/storage";

describe("SessionCatalog (SQLite metadata)", () => {
  let tempDir: string;
  let dbFile: string;
  let storage: Awaited<ReturnType<typeof openStorage>> | undefined;
  let catalog: SessionCatalog;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ob-session-catalog-"));
    dbFile = join(tempDir, "metadata.sqlite");
    storage = await openStorage({ filePath: dbFile, appVersion: "openbuddy-phase6-e2e" });
    catalog = new SessionCatalog(storage.driver);

    // Seed three session rows so list/get/set* operate on real records.
    catalog.upsert({
      sessionId: "s1",
      workspaceCwd: "/tmp/ws1",
      sourcePath: "/tmp/ws1/s1.jsonl",
      sourceHash: "hash-s1",
      title: "First session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      pinned: false,
      archived: false,
    });
    catalog.upsert({
      sessionId: "s2",
      workspaceCwd: "/tmp/ws2",
      sourcePath: "/tmp/ws2/s2.jsonl",
      sourceHash: "hash-s2",
      title: "Second session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      pinned: false,
      archived: false,
    });
    catalog.upsert({
      sessionId: "s3",
      workspaceCwd: "/tmp/ws3",
      sourcePath: "/tmp/ws3/s3.jsonl",
      sourceHash: "hash-s3",
      title: "Third session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      pinned: false,
      archived: false,
    });
  });

  afterEach(async () => {
    if (storage) {
      await closeStorage(storage);
      storage = undefined;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  test("setPinned + setArchived + setExpert round-trip via list()", () => {
    catalog.setPinned("s1", true);
    catalog.setArchived("s2", true);
    catalog.setExpert("s3", "expert-x", { expertName: "Expert X" });

    const all = catalog.list({ includeArchived: true });
    const map = new Map(all.map((row) => [row.sessionId, row]));

    expect(map.get("s1")?.pinned).toBe(true);
    expect(map.get("s2")?.archived).toBe(true);
    expect(map.get("s3")?.expertId).toBe("expert-x");
    expect(map.get("s3")?.expertMetadata).toMatchObject({ expertName: "Expert X" });
  });

  test("get returns the catalog row for a known session", () => {
    catalog.setPinned("s1", true);
    const row = catalog.get("s1");
    expect(row).toBeDefined();
    expect(row!.sessionId).toBe("s1");
    expect(row!.pinned).toBe(true);
    expect(catalog.get("does-not-exist")).toBeUndefined();
  });

  test("setPinned flips both directions", () => {
    catalog.setPinned("s1", true);
    expect(catalog.get("s1")?.pinned).toBe(true);
    catalog.setPinned("s1", false);
    expect(catalog.get("s1")?.pinned).toBe(false);
  });

  test("setArchived filters sessions when includeArchived=false", () => {
    catalog.setArchived("s2", true);
    const visible = catalog.list({ workspaceCwd: "/tmp/ws2", includeArchived: false });
    expect(visible.find((row) => row.sessionId === "s2")).toBeUndefined();
    const withArchived = catalog.list({ workspaceCwd: "/tmp/ws2", includeArchived: true });
    expect(withArchived.find((row) => row.sessionId === "s2")?.archived).toBe(true);
  });

  test("setExpert clears binding when expertId is undefined", () => {
    catalog.setExpert("s3", "expert-x", { expertName: "Expert X" });
    expect(catalog.get("s3")?.expertId).toBe("expert-x");
    catalog.setExpert("s3", undefined, {});
    expect(catalog.get("s3")?.expertId).toBeUndefined();
  });

  test("metadata persists across a re-opened SQLite handle", async () => {
    catalog.setPinned("s1", true);
    catalog.setExpert("s2", "expert-y", { expertName: "Expert Y" });

    // Close current handle, reopen from the same file, assert durability.
    if (storage) {
      await closeStorage(storage);
      storage = undefined;
    }
    const reopened = await openStorage({ filePath: dbFile, appVersion: "openbuddy-phase6-e2e" });
    try {
      const catalog2 = new SessionCatalog(reopened.driver);
      expect(catalog2.get("s1")?.pinned).toBe(true);
      expect(catalog2.get("s2")?.expertId).toBe("expert-y");
      expect(catalog2.get("s2")?.expertMetadata).toMatchObject({ expertName: "Expert Y" });
    } finally {
      await closeStorage(reopened);
    }
  });
});
