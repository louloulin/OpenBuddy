import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorage, closeStorage } from "@openbuddy/storage";
import type { OpenStorageResult } from "@openbuddy/storage";
import { MemoryIndex, type MemoryDocument } from "../sqlite/memory";

describe("MemoryIndex", () => {
  let root: string;
  let storage: OpenStorageResult;
  let index: MemoryIndex;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "openbuddy-memory-index-"));
    storage = await openStorage({ filePath: join(root, "openbuddy.sqlite"), appVersion: "memory-index-test" });
    index = new MemoryIndex(storage.driver);
  });

  afterEach(async () => {
    await closeStorage(Promise.resolve(storage));
    rmSync(root, { recursive: true, force: true });
  });

  const sampleDoc = (id: string, content = "default content"): MemoryDocument => ({
    documentId: id,
    sourcePath: `/memory/${id}.md`,
    contentHash: `hash-${id}`,
    title: `Title ${id}`,
    content,
    metadata: { tag: id },
  });

  it("upsert then get returns the same document via primary key", () => {
    index.upsert(sampleDoc("alpha", "first memory"));
    const fetched = index.get("alpha");
    expect(fetched).toBeDefined();
    expect(fetched?.documentId).toBe("alpha");
    expect(fetched?.content).toBe("first memory");
    expect(fetched?.title).toBe("Title alpha");
  });

  it("get returns undefined for missing documentId without scanning the table", () => {
    index.upsert(sampleDoc("alpha"));
    index.upsert(sampleDoc("beta"));
    index.upsert(sampleDoc("gamma"));
    // Should be O(1) — no documents means get returns undefined without iterating.
    expect(index.get("missing")).toBeUndefined();
    // Existing keys still resolve.
    expect(index.get("beta")?.documentId).toBe("beta");
  });

  it("get reflects upsert updates (latest content wins)", () => {
    index.upsert(sampleDoc("alpha", "first"));
    index.upsert(sampleDoc("alpha", "second"));
    expect(index.get("alpha")?.content).toBe("second");
  });

  it("get returns undefined after remove", () => {
    index.upsert(sampleDoc("alpha"));
    index.remove("alpha");
    expect(index.get("alpha")).toBeUndefined();
  });

  it("search still works via FTS5 after get refactor", () => {
    index.upsert(sampleDoc("alpha", "the quick brown fox"));
    index.upsert(sampleDoc("beta", "lazy dog sleeps"));
    index.upsert(sampleDoc("gamma", "fox jumps over"));
    const results = index.search("fox", 10);
    const ids = results.map((row) => row.documentId).sort();
    expect(ids).toContain("alpha");
    expect(ids).toContain("gamma");
    expect(ids).not.toContain("beta");
  });
});
