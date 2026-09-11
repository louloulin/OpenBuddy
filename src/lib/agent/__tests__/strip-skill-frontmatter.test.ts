/**
 * Tests for `stripSkillFrontmatter` (Round 22 — G4 PR 1, plan4.1.md §9.12).
 *
 * Mirrors `parse-skill-frontmatter.test.ts` but for the body-only path.
 * Exercises the bridge channel `pi-bridge-text:strip-frontmatter` which
 * was previously dead (1/14 channels live, 7% utilization). After this
 * round lands 2/14 = 14%.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { stripSkillFrontmatter } from "../pi-client";
import { getPiBridge } from "../pi-bridge-client";

describe("stripSkillFrontmatter (G4 PR 1 — IPC bridge)", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    vi.restoreAllMocks();
  });

  it("returns raw string when bridge is missing (fallback)", async () => {
    delete (globalThis as { window?: unknown }).window;
    const raw = "---\nname: foo\n---\nbody";
    const result = await stripSkillFrontmatter(raw);
    // Bridge missing → fallback returns raw unchanged.
    expect(result).toBe(raw);
  });

  it("delegates to bridge.text.stripFrontmatter when available", async () => {
    const stripFrontmatter = vi.fn(async (raw: string) =>
      raw.includes("\n---\n") ? "body" : raw,
    );
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: { stripFrontmatter }, image: {}, skills: {} } },
    };
    const raw = "---\nname: foo\nversion: 1.2.3\n---\nbody";
    const result = await stripSkillFrontmatter(raw);
    expect(stripFrontmatter).toHaveBeenCalledWith(raw);
    expect(result).toBe("body");
  });

  it("returns raw when the bridge throws (defensive fallback)", async () => {
    const stripFrontmatter = vi.fn(async () => {
      throw new Error("bridge broken");
    });
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: { stripFrontmatter }, image: {}, skills: {} } },
    };
    const raw = "---\nname: foo\n---\nbody";
    const result = await stripSkillFrontmatter(raw);
    expect(result).toBe(raw);
  });

  it("handles empty input gracefully", async () => {
    const stripFrontmatter = vi.fn(async (raw: string) => raw);
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: { stripFrontmatter }, image: {}, skills: {} } },
    };
    const result = await stripSkillFrontmatter("");
    expect(result).toBe("");
    expect(stripFrontmatter).toHaveBeenCalledWith("");
  });

  it("falls back when text namespace is empty (no stripFrontmatter method)", async () => {
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: {}, image: {}, skills: {} } },
    };
    const raw = "---\nname: foo\n---\nbody";
    const result = await stripSkillFrontmatter(raw);
    expect(result).toBe(raw);
  });

  it("getPiBridge sees the injected fake client (sanity)", () => {
    const fake = { text: {}, image: {}, skills: {} };
    (globalThis as { window?: unknown }).window = { api: { pi: fake } };
    expect(getPiBridge()).toBe(fake);
  });
});