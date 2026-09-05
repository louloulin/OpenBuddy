import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEMORY_BRIDGE_ENV_FLAG,
  bridgeMemorySearch,
  isMemoryBridgeActive,
  mergeMemoryHits,
  type SemanticRecallAdapter,
} from "./memory-bridge";

const ORIGINAL_ENV = process.env[MEMORY_BRIDGE_ENV_FLAG];

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env[MEMORY_BRIDGE_ENV_FLAG];
  else process.env[MEMORY_BRIDGE_ENV_FLAG] = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe("isMemoryBridgeActive", () => {
  it("returns false when no pi-memory package is installed and no flag is set", async () => {
    vi.resetModules();
    vi.doMock("./pi-package-installed", () => ({
      isPiPackageInstalled: () => false,
      probePiPackage: () => ({ installed: false, version: null }),
    }));
    const mod = await import("./memory-bridge");
    delete process.env[MEMORY_BRIDGE_ENV_FLAG];
    expect(mod.isMemoryBridgeActive()).toBe(false);
  });

  it("returns true when enabled:true forces it on and pi package is installed", async () => {
    vi.resetModules();
    vi.doMock("./pi-package-installed", () => ({
      isPiPackageInstalled: () => true,
      probePiPackage: () => ({ installed: true, version: "1.0.0" }),
    }));
    const mod = await import("./memory-bridge");
    expect(mod.isMemoryBridgeActive({ enabled: true })).toBe(true);
  });
});

describe("mergeMemoryHits", () => {
  it("tags FTS-only hits and dedupes overlapping ids", () => {
    const merged = mergeMemoryHits(
      [
        { id: "a", title: "A", body: "fts-a", tags: [], score: 0.9 },
        { id: "b", title: "B", body: "fts-b", tags: [], score: 0.5 },
      ],
      [
        { id: "b", title: "B", body: "sem-b", tags: [], score: 0.7 },
        { id: "c", title: "C", body: "sem-c", tags: [], score: 0.6 },
      ],
      10,
    );
    expect(merged.map((hit) => hit.id)).toEqual(["a", "b", "c"]);
    expect(merged.find((hit) => hit.id === "b")?.source).toBe("both");
    expect(merged.find((hit) => hit.id === "a")?.source).toBe("fts");
    expect(merged.find((hit) => hit.id === "c")?.source).toBe("semantic");
  });

  it("respects the limit and sorts by score desc", () => {
    const merged = mergeMemoryHits(
      [
        { id: "low", title: "L", body: "l", tags: [], score: 0.1 },
        { id: "high", title: "H", body: "h", tags: [], score: 0.99 },
      ],
      [{ id: "mid", title: "M", body: "m", tags: [], score: 0.5 }],
      2,
    );
    expect(merged.map((hit) => hit.id)).toEqual(["high", "mid"]);
  });
});

describe("bridgeMemorySearch", () => {
  it("returns FTS hits only when no adapter is provided", async () => {
    const out = await bridgeMemorySearch(
      "query",
      [{ id: "a", title: "A", body: "a", tags: [], score: 0.8 }],
      undefined,
      { enabled: true },
    );
    expect(out).toEqual([
      { id: "a", title: "A", body: "a", tags: [], score: 0.8, source: "fts" },
    ]);
  });

  it("calls the adapter when bridge is active and merges hits", async () => {
    vi.resetModules();
    vi.doMock("./pi-package-installed", () => ({
      isPiPackageInstalled: () => true,
      probePiPackage: () => ({ installed: true, version: "1.0.0" }),
    }));
    const mod = await import("./memory-bridge");
    const adapter: SemanticRecallAdapter = {
      kind: "mem0",
      recall: async () => [{ id: "b", score: 0.7, title: "B", body: "sem-b" }],
    };
    const out = await mod.bridgeMemorySearch(
      "query",
      [{ id: "a", title: "A", body: "fts-a", tags: [], score: 0.6 }],
      adapter,
      { enabled: true },
    );
    expect(out.map((hit) => hit.id).sort()).toEqual(["a", "b"]);
  });

  it("falls back to FTS when the adapter throws", async () => {
    vi.resetModules();
    vi.doMock("./pi-package-installed", () => ({
      isPiPackageInstalled: () => true,
      probePiPackage: () => ({ installed: true, version: "1.0.0" }),
    }));
    const mod = await import("./memory-bridge");
    const adapter: SemanticRecallAdapter = {
      kind: "mem0",
      recall: async () => {
        throw new Error("adapter offline");
      },
    };
    const out = await mod.bridgeMemorySearch(
      "query",
      [{ id: "a", title: "A", body: "fts-a", tags: [], score: 0.6 }],
      adapter,
      { enabled: true },
    );
    expect(out).toEqual([
      { id: "a", title: "A", body: "fts-a", tags: [], score: 0.6, source: "fts" },
    ]);
  });
});
