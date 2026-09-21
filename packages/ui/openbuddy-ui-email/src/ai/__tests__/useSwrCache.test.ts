/**
 * useSwrCache — SWR 缓存行为单测。
 *
 * 覆盖:
 *   - 首次 fetch → 写 cache → 命中
 *   - TTL 内第二次 fetch → 不再调用 fetcher
 *   - TTL 过期 → 后台 revalidate,但仍返回旧值
 *   - invalidate → 下次 ensure 重新 fetch
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useSwrCache, swrCacheInternal } from "../hooks/useSwrCache";
import { act, renderHook } from "@testing-library/react";

beforeEach(() => {
  swrCacheInternal.reset();
});

describe("useSwrCache", () => {
  it("first call fetches and caches", async () => {
    const fetcher = vi.fn().mockResolvedValue({ x: 1 });
    const { result } = renderHook(() => useSwrCache("k1", fetcher));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.value).toEqual({ x: 1 });
  });

  it("second call within TTL skips fetcher (cached)", async () => {
    const fetcher = vi.fn().mockResolvedValue({ x: 2 });
    const { result, rerender } = renderHook(() => useSwrCache("k2", fetcher, 30_000));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    rerender();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.value).toEqual({ x: 2 });
  });

  it("stale entry: revalidate triggers fetcher and updates cache", async () => {
    let n = 1;
    const fetcher = vi.fn().mockImplementation(async () => ({ x: n++ }));
    swrCacheInternal.set("k3", { x: 0 });
    swrCacheInternal.backdateForTests("k3", 11_000); // TTL 10s,backdate 到 stale。
    const { result, rerender } = renderHook(() => useSwrCache("k3", fetcher, 10_000));
    rerender();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    // fetcher 已被触发。
    expect(fetcher).toHaveBeenCalled();
    // 新值已写入 cache。
    expect(result.current.value).toEqual({ x: 1 });
  });

  it("invalidate forces re-fetch on next mount", async () => {
    const fetcher = vi.fn().mockResolvedValue({ x: 5 });
    const { unmount } = renderHook(() => useSwrCache("k4", fetcher));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const callsAfterFirst = fetcher.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);
    swrCacheInternal.invalidate("k4");
    unmount();
    const callsAfterUnmount = fetcher.mock.calls.length;
    // 卸载后不再调用 fetcher。
    expect(callsAfterUnmount).toBe(callsAfterFirst);
    renderHook(() => useSwrCache("k4", fetcher));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // 重新 mount 后至少 +1 次。
    expect(fetcher.mock.calls.length).toBeGreaterThan(callsAfterUnmount);
  });

  it("reset clears all cache and listeners", () => {
    swrCacheInternal.set("k5", { a: 1 });
    expect(swrCacheInternal.get("k5")).toEqual({ value: { a: 1 }, generatedAt: expect.any(Number) });
    swrCacheInternal.reset();
    expect(swrCacheInternal.get("k5")).toBeUndefined();
  });
});

describe("useAiInbox SWR integration", () => {
  it("does not re-call summarize when ensureSummary is called twice within TTL", async () => {
    const summarize = vi.fn().mockResolvedValue({ threadId: "t1", oneLiner: "hi" });
    const runtime = {
      summarize,
      suggestReplies: vi.fn(),
      plan: vi.fn(),
      execute: vi.fn(),
      undo: vi.fn(),
      routePrompt: vi.fn(),
    };
    const { useAiInbox } = await import("../hooks/useAiInbox");
    const { result } = renderHook(() => useAiInbox({ runtime }));
    await act(async () => {
      await result.current.ensureSummary("t1");
      await result.current.ensureSummary("t1");
    });
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("invalidate(threadId) clears SWR cache for both summary and replies", async () => {
    const runtime = {
      summarize: vi.fn().mockResolvedValue({ threadId: "t1", oneLiner: "hi" }),
      suggestReplies: vi.fn().mockResolvedValue([]),
      plan: vi.fn(),
      execute: vi.fn(),
      undo: vi.fn(),
      routePrompt: vi.fn(),
    };
    const { useAiInbox } = await import("../hooks/useAiInbox");
    const { result } = renderHook(() => useAiInbox({ runtime }));
    await act(async () => {
      await result.current.ensureSummary("t1");
      await result.current.ensureReplies("t1");
    });
    expect(swrCacheInternal.get("summary:t1")).toBeDefined();
    expect(swrCacheInternal.get("replies:t1")).toBeDefined();
    act(() => result.current.invalidate("t1"));
    expect(swrCacheInternal.get("summary:t1")).toBeUndefined();
    expect(swrCacheInternal.get("replies:t1")).toBeUndefined();
  });
});
