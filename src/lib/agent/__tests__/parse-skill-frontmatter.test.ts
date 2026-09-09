/**
 * Tests for `parseSkillFrontmatter` (Phase E.3 of
 * docs/OPENBUDDY_PI_NATIVE_PLAN.md).
 *
 * The renderer used to ship a hand-rolled YAML-ish parser inline in
 * SkillDetailModal.tsx. E.3 replaces that with a thin wrapper around
 * the pi-bridge IPC channel (`pi-bridge-text:parse-frontmatter`),
 * so SkillDetailModal never carries a parser implementation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseSkillFrontmatter } from "../pi-client";
import { getPiBridge } from "../pi-bridge-client";

describe("parseSkillFrontmatter (Phase E.3 — IPC bridge)", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    vi.restoreAllMocks();
  });

  it("falls back to empty frontmatter when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    const raw = "---\nname: foo\n---\nbody";
    const result = await parseSkillFrontmatter(raw);
    // Bridge missing → fallback returns the raw string as body, no frontmatter.
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(raw);
  });

  it("delegates to bridge.text.parseFrontmatter when available", async () => {
    const parseFrontmatter = vi.fn(async (raw: string) => ({
      frontmatter: { name: "foo", version: "1.2.3", tags: ["a", "b"] },
      body: raw.includes("body") ? "body" : raw,
    }));
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: { parseFrontmatter }, image: {}, skills: {} } },
    };
    const raw = "---\nname: foo\nversion: 1.2.3\ntags: [a, b]\n---\nbody";
    const result = await parseSkillFrontmatter(raw);
    expect(parseFrontmatter).toHaveBeenCalledWith(raw);
    expect(result.frontmatter).toEqual({
      name: "foo",
      version: "1.2.3",
      tags: ["a", "b"],
    });
    expect(result.body).toBe("body");
  });

  it("falls back gracefully when the bridge throws", async () => {
    const parseFrontmatter = vi.fn(async () => {
      throw new Error("bridge broken");
    });
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: { parseFrontmatter }, image: {}, skills: {} } },
    };
    const raw = "---\nname: foo\n---\nbody";
    const result = await parseSkillFrontmatter(raw);
    expect(result.frontmatter).toEqual({});
    // Body keeps the raw content so the modal can still render.
    expect(result.body).toBe(raw);
  });

  it("returns empty frontmatter when bridge is missing AND raw is empty", async () => {
    delete (globalThis as { window?: unknown }).window;
    const result = await parseSkillFrontmatter("");
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("");
  });

  it("treats absent frontmatter as empty map", async () => {
    const parseFrontmatter = vi.fn(async (raw: string) => ({ frontmatter: {}, body: raw }));
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: { parseFrontmatter }, image: {}, skills: {} } },
    };
    const result = await parseSkillFrontmatter("just markdown, no frontmatter block");
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("just markdown, no frontmatter block");
  });

  it("getPiBridge sees the injected fake client (sanity)", () => {
    const fake = { text: {}, image: {}, skills: {} };
    (globalThis as { window?: unknown }).window = { api: { pi: fake } };
    expect(getPiBridge()).toBe(fake);
  });
});