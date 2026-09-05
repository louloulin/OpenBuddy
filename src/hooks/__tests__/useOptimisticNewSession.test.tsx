/**
 * useOptimisticNewSession — fan-out resolver + alias-map semantics.
 *
 * The hook is the cohesion center for the "pending-id → real-id" plumbing.
 * Its tests must pin:
 *  - the synchronous `setCurrent(pendingId) + setSession(pendingId)` flip
 *    (App.tsx mounts ChatView on this signal);
 *  - the fan-out resolver list (two concurrent callers share one Promise);
 *  - the supersede recovery (`awaitPendingNewSession` returns the *current*
 *    in-flight Promise, not the stale one the caller originally awaited);
 *  - the draftKeyAliasesRef recording (Phase 2's `newSessionFlow` asks
 *    `resolveAlias(key)` to map provisional → real id).
 *
 * The hook does NOT own rollback on error — `popOptimistic` /
 * `setSession(null)` / `remove(pendingId)` are caller responsibilities.
 * Those live in `App.tsx`'s catch block today.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOptimisticNewSession } from "../useOptimisticNewSession";
import { useSessionStore } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";

function resetStores() {
  useSessionStore.setState({
    sessionId: null,
    streaming: false,
    planMode: false,
    optimisticBubble: null,
    error: null,
    messages: [],
    streamingMessageId: null,
    plan: null,
  });
  useSessionsStore.setState({
    independent: [],
    workspaces: [],
    workspaceSessions: {},
    tasksOpen: true,
    spacesOpen: true,
    expanded: {},
    homeCwd: "",
    currentSessionId: null,
    loading: false,
    error: null,
    query: "",
    drafts: {},
  });
}

beforeEach(() => {
  resetStores();
});

describe("useOptimisticNewSession", () => {
  it("synchronously flips both stores to a fresh `__pending_` id", () => {
    let resolveBackend!: (id: string) => void;
    const factory = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveBackend = resolve; }),
    );
    const { result } = renderHook(() => useOptimisticNewSession(factory));

    let pending: ReturnType<typeof result.current.ensureNewSession> | undefined;
    act(() => {
      pending = result.current.ensureNewSession("/home/user/proj");
    });

    // Sync — no `await`.
    expect(pending).toBeDefined();
    expect(pending!.pendingId.startsWith("__pending_")).toBe(true);
    expect(useSessionsStore.getState().currentSessionId).toBe(pending!.pendingId);
    expect(useSessionStore.getState().sessionId).toBe(pending!.pendingId);
    expect(factory).toHaveBeenCalledTimes(1);

    // Cleanup: resolve the dangling Promise so vitest doesn't complain.
    resolveBackend("real-1");
  });

  it("fan-out: two concurrent callers share the same in-flight Promise", async () => {
    let resolveBackend!: (id: string) => void;
    const factory = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveBackend = resolve; }),
    );
    const { result } = renderHook(() => useOptimisticNewSession(factory));

    let first: { pendingId: string; promise: Promise<string> };
    let second: { pendingId: string; promise: Promise<string> };
    act(() => {
      first = result.current.ensureNewSession("/home/user/proj");
      second = result.current.ensureNewSession("/home/user/proj");
    });

    // Both share the factory invocation.
    expect(factory).toHaveBeenCalledTimes(1);
    // The two pendingIds are different (the second supersedes the first).
    expect(first!.pendingId).not.toBe(second!.pendingId);
    // …but the second caller has piggy-backed onto the first's promise.
    resolveBackend("real-42");
    const [a, b] = await Promise.all([first!.promise, second!.promise]);
    expect(a).toBe("real-42");
    expect(b).toBe("real-42");
  });

  it("awaitPendingNewSession returns null when no session is in flight", async () => {
    const { result } = renderHook(() => useOptimisticNewSession());
    await expect(result.current.awaitPendingNewSession()).resolves.toBeNull();
  });

  it("recordAlias + resolveAlias round-trip", () => {
    const { result } = renderHook(() => useOptimisticNewSession());
    expect(result.current.resolveAlias("__pending_xxx")).toBe("__pending_xxx");
    act(() => {
      result.current.recordAlias("__pending_xxx", "real-99");
    });
    expect(result.current.resolveAlias("__pending_xxx")).toBe("real-99");
  });

  it("rejects all waiters when the backend fails", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useOptimisticNewSession(factory));

    let first: { pendingId: string; promise: Promise<string> };
    let second: { pendingId: string; promise: Promise<string> };
    act(() => {
      first = result.current.ensureNewSession("/home/user/proj");
      second = result.current.ensureNewSession("/home/user/proj");
    });

    // Both Promises reject with the same cause.
    await expect(first!.promise).rejects.toThrow("boom");
    await expect(second!.promise).rejects.toThrow("boom");

    // …and the in-flight record is cleared, so a fresh caller starts
    // a new IPC instead of piggy-backing on the failed one.
    const factory2 = vi.fn().mockResolvedValue("real-fresh");
    const { result: result2 } = renderHook(() => useOptimisticNewSession(factory2));
    let third: { pendingId: string; promise: Promise<string> };
    act(() => {
      third = result2.current.ensureNewSession("/home/user/proj");
    });
    expect(factory2).toHaveBeenCalledTimes(1);
    await expect(third!.promise).resolves.toBe("real-fresh");
  });

  it("hasPending reports the in-flight state", async () => {
    let resolveBackend!: (id: string) => void;
    const factory = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveBackend = resolve; }),
    );
    const { result } = renderHook(() => useOptimisticNewSession(factory));

    expect(result.current.hasPending()).toBe(false);
    act(() => {
      result.current.ensureNewSession("/home/user/proj");
    });
    expect(result.current.hasPending()).toBe(true);
    resolveBackend("real-1");
    // Let microtasks flush so the .finally clears the in-flight record.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(result.current.hasPending()).toBe(false);
  });
});