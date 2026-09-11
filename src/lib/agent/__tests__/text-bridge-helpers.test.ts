/**
 * Tests for the 5 bridge.text helpers added in Round 23 — G4 PR 2
 * (plan4.1.md §9.13): truncateHeadText / truncateTailText /
 * truncateLineText / generateBridgeDiff / generateBridgePatch.
 *
 * Mirrors `strip-skill-frontmatter.test.ts` (Round 22): each helper
 * has the same 4-layer fallback contract — bridge missing / text
 * namespace empty / method missing / bridge throws → return the
 * safe default. Exercises the channels
 *   pi-bridge-text:truncate-head / -tail / -line
 *   pi-bridge-text:generate-diff / -generate-patch
 * which were previously dead (Round 22: 2/14 live = 14%). After this
 * round lands 7/14 = 50%.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateBridgeDiff,
  generateBridgePatch,
  truncateHeadText,
  truncateLineText,
  truncateTailText,
} from "../pi-client";

type BridgeBuilder = (overrides?: {
  truncateHead?: (c: string, o?: { maxLines?: number; maxBytes?: number }) => Promise<string>;
  truncateTail?: (c: string, o?: { maxLines?: number; maxBytes?: number }) => Promise<string>;
  truncateLine?: (c: string, o?: { maxChars?: number }) => Promise<string>;
  generateDiff?: (a: string, b: string, o?: { filePath?: string; context?: number }) => Promise<string>;
  generatePatch?: (a: string, b: string, o?: { filePath?: string; context?: number }) => Promise<string>;
}) => { text: Record<string, unknown>; image: Record<string, unknown>; skills: Record<string, unknown> };

const buildBridge: BridgeBuilder = (overrides = {}) => {
  const noop = async () => "";
  return {
    text: {
      parseFrontmatter: noop,
      stripFrontmatter: noop,
      truncateHead: overrides.truncateHead ?? noop,
      truncateTail: overrides.truncateTail ?? noop,
      truncateLine: overrides.truncateLine ?? noop,
      generateDiff: overrides.generateDiff ?? noop,
      generatePatch: overrides.generatePatch ?? noop,
    },
    image: {},
    skills: {},
  };
};

describe("Round 23 — G4 PR 2 bridge.text helpers", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    vi.restoreAllMocks();
  });

  // ---------- truncateHeadText ----------

  it("truncateHeadText: returns raw when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    const content = "a\nb\nc\nd\ne";
    expect(await truncateHeadText(content, { maxLines: 2 })).toBe(content);
  });

  it("truncateHeadText: delegates to bridge.text.truncateHead", async () => {
    const truncateHead = vi.fn(async () => "a\nb");
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ truncateHead }) } };
    const content = "a\nb\nc\nd\ne";
    const result = await truncateHeadText(content, { maxLines: 2 });
    expect(truncateHead).toHaveBeenCalledWith(content, { maxLines: 2 });
    expect(result).toBe("a\nb");
  });

  it("truncateHeadText: returns raw when bridge throws", async () => {
    const truncateHead = vi.fn(async () => {
      throw new Error("ipc down");
    });
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ truncateHead }) } };
    const content = "hello world";
    expect(await truncateHeadText(content, { maxBytes: 5 })).toBe(content);
  });

  // ---------- truncateTailText ----------

  it("truncateTailText: returns raw when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    const content = "a\nb\nc";
    expect(await truncateTailText(content, { maxLines: 1 })).toBe(content);
  });

  it("truncateTailText: delegates to bridge.text.truncateTail", async () => {
    const truncateTail = vi.fn(async () => "c");
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ truncateTail }) } };
    const content = "a\nb\nc";
    const result = await truncateTailText(content, { maxLines: 1 });
    expect(truncateTail).toHaveBeenCalledWith(content, { maxLines: 1 });
    expect(result).toBe("c");
  });

  it("truncateTailText: returns raw when method missing", async () => {
    // text namespace exists but truncateTail is absent (older bridge).
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: { parseFrontmatter: vi.fn(), stripFrontmatter: vi.fn() }, image: {}, skills: {} } },
    };
    const content = "log tail content";
    expect(await truncateTailText(content, { maxBytes: 10 })).toBe(content);
  });

  // ---------- truncateLineText ----------

  it("truncateLineText: returns raw when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    const content = "long single line content here";
    expect(await truncateLineText(content, { maxChars: 5 })).toBe(content);
  });

  it("truncateLineText: delegates to bridge.text.truncateLine", async () => {
    const truncateLine = vi.fn(async () => "long ");
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ truncateLine }) } };
    const result = await truncateLineText("long single line", { maxChars: 5 });
    expect(truncateLine).toHaveBeenCalledWith("long single line", { maxChars: 5 });
    expect(result).toBe("long ");
  });

  it("truncateLineText: returns raw when bridge throws", async () => {
    const truncateLine = vi.fn(async () => {
      throw new Error("oops");
    });
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ truncateLine }) } };
    const content = "abcdef";
    expect(await truncateLineText(content, { maxChars: 3 })).toBe(content);
  });

  // ---------- generateBridgeDiff ----------

  it("generateBridgeDiff: returns newStr when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    expect(await generateBridgeDiff("old", "new")).toBe("new");
  });

  it("generateBridgeDiff: delegates to bridge.text.generateDiff", async () => {
    const generateDiff = vi.fn(async () => "--- a\n+++ b\n-old\n+new");
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ generateDiff }) } };
    const result = await generateBridgeDiff("old", "new", { filePath: "x.ts", context: 3 });
    expect(generateDiff).toHaveBeenCalledWith("old", "new", { filePath: "x.ts", context: 3 });
    expect(result).toBe("--- a\n+++ b\n-old\n+new");
  });

  it("generateBridgeDiff: returns newStr when bridge throws", async () => {
    const generateDiff = vi.fn(async () => {
      throw new Error("diff failed");
    });
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ generateDiff }) } };
    expect(await generateBridgeDiff("a", "b")).toBe("b");
  });

  // ---------- generateBridgePatch ----------

  it("generateBridgePatch: returns newStr when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    expect(await generateBridgePatch("old", "new")).toBe("new");
  });

  it("generateBridgePatch: delegates to bridge.text.generatePatch", async () => {
    const generatePatch = vi.fn(async () => "Index: x.ts\n--- a\n+++ b\n-old\n+new");
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ generatePatch }) } };
    const result = await generateBridgePatch("old", "new", { filePath: "x.ts" });
    expect(generatePatch).toHaveBeenCalledWith("old", "new", { filePath: "x.ts" });
    expect(result).toContain("Index: x.ts");
  });

  it("generateBridgePatch: returns newStr when text namespace is empty", async () => {
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: {}, image: {}, skills: {} } },
    };
    expect(await generateBridgePatch("a", "b")).toBe("b");
  });
});