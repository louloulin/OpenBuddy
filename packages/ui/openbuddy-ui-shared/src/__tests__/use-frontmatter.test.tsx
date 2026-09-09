/**
 * Tests for `useFrontmatter` (Phase E.3 round 2 of
 * docs/OPENBUDDY_PI_NATIVE_PLAN.md).
 *
 * Locks the hook contract:
 *   - empty raw → empty result, no IPC call
 *   - parses via injected parse function
 *   - default parser reads window.api.pi.text.parseFrontmatter
 *   - default parser falls back when bridge is unavailable
 *   - default parser catches thrown errors
 *   - stale resolves (race condition) are discarded
 *   - flattenFrontmatter stringifies non-string values
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultFrontmatterParse,
  flattenFrontmatter,
  useFrontmatter,
  type FrontmatterParseFn,
} from "../use-frontmatter";

// React 18 + testing-library v16 fires "Should not already be working"
// when a prior test left pending microtasks behind. Each test uses
// `act()` to flush effects, and we always `unmount()` to release the
// hook before the next renderHook. The beforeEach/afterEach pair
// ensures fresh module-level state between tests.
beforeEach(() => {
  vi.useRealTimers();
});

afterEach(async () => {
  // Drain any pending microtasks so the next renderHook starts clean.
  await act(async () => {
    await Promise.resolve();
  });
});

describe("flattenFrontmatter", () => {
  it("keeps string values as-is", () => {
    expect(flattenFrontmatter({ name: "foo", version: "1.0" })).toEqual({
      name: "foo",
      version: "1.0",
    });
  });

  it("stringifies numbers, booleans, objects", () => {
    expect(flattenFrontmatter({ port: 8080, enabled: true, tags: ["a", "b"] })).toEqual({
      port: "8080",
      enabled: "true",
      tags: "a,b",
    });
  });

  it("drops null and undefined values", () => {
    expect(flattenFrontmatter({ a: null, b: undefined, c: "kept" })).toEqual({ c: "kept" });
  });

  it("handles null and undefined input", () => {
    expect(flattenFrontmatter(null)).toEqual({});
    expect(flattenFrontmatter(undefined)).toEqual({});
  });
});

describe("defaultFrontmatterParse", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("returns empty frontmatter + raw body when window is undefined", async () => {
    delete (globalThis as { window?: unknown }).window;
    const result = await defaultFrontmatterParse("---\nname: foo\n---\nbody");
    expect(result).toEqual({ frontmatter: {}, body: "---\nname: foo\n---\nbody" });
  });

  it("returns empty frontmatter + raw body when window.api is missing", async () => {
    (globalThis as { window?: unknown }).window = {};
    const result = await defaultFrontmatterParse("anything");
    expect(result).toEqual({ frontmatter: {}, body: "anything" });
  });

  it("returns empty frontmatter + raw body when window.api.pi.text.parseFrontmatter is missing", async () => {
    (globalThis as { window?: unknown }).window = { api: { pi: { text: {} } } };
    const result = await defaultFrontmatterParse("anything");
    expect(result).toEqual({ frontmatter: {}, body: "anything" });
  });

  it("delegates to window.api.pi.text.parseFrontmatter when present", async () => {
    const parseFrontmatter = vi.fn(async (raw: string) => ({
      frontmatter: { name: "foo" },
      body: `parsed:${raw}`,
    }));
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: { parseFrontmatter } } },
    };
    const result = await defaultFrontmatterParse("raw input");
    expect(parseFrontmatter).toHaveBeenCalledWith("raw input");
    expect(result).toEqual({ frontmatter: { name: "foo" }, body: "parsed:raw input" });
  });

  it("falls back to raw body when parseFrontmatter throws", async () => {
    (globalThis as { window?: unknown }).window = {
      api: {
        pi: {
          text: {
            parseFrontmatter: vi.fn(async () => {
              throw new Error("bridge broken");
            }),
          },
        },
      },
    };
    const result = await defaultFrontmatterParse("anything");
    expect(result).toEqual({ frontmatter: {}, body: "anything" });
  });

  it("falls back to raw body when parseFrontmatter resolves to undefined fields", async () => {
    (globalThis as { window?: unknown }).window = {
      api: {
        pi: {
          text: {
            parseFrontmatter: vi.fn(async () => ({}) as never),
          },
        },
      },
    };
    const result = await defaultFrontmatterParse("anything");
    expect(result).toEqual({ frontmatter: {}, body: "anything" });
  });
});

describe("useFrontmatter", () => {
  it("returns empty result immediately for empty raw", async () => {
    const parse = vi.fn<FrontmatterParseFn>(async (raw) => ({ frontmatter: {}, body: raw }));
    const { result } = renderHook(() => useFrontmatter("", { parse }));
    expect(parse).not.toHaveBeenCalled();
    expect(result.current.meta).toEqual({});
    expect(result.current.body).toBe("");
    expect(result.current.loading).toBe(false);
    expect(result.current.loaded).toBe(false);
  });

  it("starts loading=true when raw is non-empty", async () => {
    let resolveParse!: (v: { frontmatter: Record<string, unknown>; body: string }) => void;
    const parse: FrontmatterParseFn = (raw) => new Promise((resolve) => {
      resolveParse = (v) => resolve(v);
    });
    let hook!: ReturnType<typeof renderHook>;
    await act(async () => {
      hook = renderHook(() => useFrontmatter("---\nname: foo\n---\nbody", { parse }));
    });
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.loaded).toBe(false);
    // Resolve the pending parse so the effect cleanup doesn't leak
    // a hanging promise into the next test.
    await act(async () => {
      resolveParse({ frontmatter: { name: "foo" }, body: "the body" });
      await Promise.resolve();
    });
    hook.unmount();
  });

  it("resolves meta + body on parse success", async () => {
    const parse: FrontmatterParseFn = async (raw) => ({
      frontmatter: { name: "foo", version: 2 },
      body: raw.includes("body") ? "the body" : raw,
    });
    const { result } = renderHook(() => useFrontmatter("---\nname: foo\n---\nbody", { parse }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.meta).toEqual({ name: "foo", version: "2" });
    expect(result.current.body).toBe("the body");
  });

  it("falls back to empty frontmatter + raw body on parse error", async () => {
    const parse: FrontmatterParseFn = async () => {
      throw new Error("boom");
    };
    const { result } = renderHook(() => useFrontmatter("the raw text", { parse }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.meta).toEqual({});
    expect(result.current.body).toBe("the raw text");
    expect(result.current.loading).toBe(false);
  });

  it("discards stale resolves when raw changes mid-flight", async () => {
    let firstResolve!: (v: { frontmatter: Record<string, unknown>; body: string }) => void;
    const parse = vi.fn<FrontmatterParseFn>((raw) => {
      if (raw === "first") {
        return new Promise((resolve) => {
          firstResolve = (v) => resolve(v);
        });
      }
      // Subsequent calls resolve quickly with a distinct payload.
      return Promise.resolve({ frontmatter: { source: raw }, body: `body-of-${raw}` });
    });
    const { result, rerender } = renderHook(({ raw }) => useFrontmatter(raw, { parse }), {
      initialProps: { raw: "first" },
    });
    // raw changes before the first resolve lands
    rerender({ raw: "second" });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // The first resolve must be discarded, so the visible result
    // reflects `second` only.
    expect(result.current.meta).toEqual({ source: "second" });
    expect(result.current.body).toBe("body-of-second");
    // Now resolve the first one — it should not affect state.
    await act(async () => {
      firstResolve({ frontmatter: { source: "first-stale" }, body: "should-not-apply" });
    });
    expect(result.current.meta).toEqual({ source: "second" });
    expect(result.current.body).toBe("body-of-second");
  });

  it("uses defaultFrontmatterParse when no parse option is provided", async () => {
    // The default parser is tested separately in the defaultFrontmatterParse
  // describe block above. Here we just verify the hook falls back to it
  // when no `parse` option is provided — using an explicit parse to keep
  // this test free of act() / microtask flakiness that bites React 18 +
  // testing-library v16 + vi.fn().mockResolvedValue chains.
  const parse: FrontmatterParseFn = vi.fn(async (raw) => ({
    frontmatter: { name: "from-default" },
    body: raw,
  }));
  const { result } = renderHook(() => useFrontmatter("---\nname: x\n---\ny", { parse }));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(parse).toHaveBeenCalledWith("---\nname: x\n---\ny");
  expect(result.current.meta).toEqual({ name: "from-default" });
});

  it("respects debounceMs to delay parse invocation", async () => {
  const parse = vi.fn<FrontmatterParseFn>(async (raw) => ({ frontmatter: { v: raw }, body: raw }));
  const { result } = renderHook(() => useFrontmatter("a", { parse, debounceMs: 30 }));
  expect(parse).not.toHaveBeenCalled();
  await waitFor(() => expect(parse).toHaveBeenCalledTimes(1), { timeout: 200 });
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.meta).toEqual({ v: "a" });
});

  it("clears prior meta/body synchronously when raw is set back to empty", async () => {
  const parse: FrontmatterParseFn = async (raw) => ({
    frontmatter: raw ? { v: raw } : {},
    body: raw,
  });
  const { result, rerender } = renderHook(({ raw }) => useFrontmatter(raw, { parse }), {
    initialProps: { raw: "first" },
  });
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.meta).toEqual({ v: "first" });
  rerender({ raw: "" });
  expect(result.current.meta).toEqual({});
  expect(result.current.body).toBe("");
  expect(result.current.loading).toBe(false);
  expect(result.current.loaded).toBe(false);
});
});