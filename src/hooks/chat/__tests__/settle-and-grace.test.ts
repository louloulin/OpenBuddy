/**
 * promptSettle + eventStreamGrace tests — Phase R3.0 (pi-web-alignment).
 *
 * Pins the timing constants and the lifecycle semantics:
 *   - promptSettle exits early on agent-streaming or timeout
 *   - eventStreamGrace debounces activity + invalidates stale generations
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  PROMPT_SETTLE_INITIAL_DELAY_MS,
  PROMPT_SETTLE_MAX_MS,
  PROMPT_SETTLE_POLL_MS,
  usePromptSettle,
} from "../promptSettle";
import {
  EVENT_STREAM_IDLE_GRACE_MS,
  useEventStreamGrace,
} from "../eventStreamGrace";

describe("promptSettle constants", () => {
  it("matches pi-web parity", () => {
    expect(PROMPT_SETTLE_INITIAL_DELAY_MS).toBe(800);
    expect(PROMPT_SETTLE_POLL_MS).toBe(600);
    expect(PROMPT_SETTLE_MAX_MS).toBe(20_000);
  });
});

describe("usePromptSettle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does nothing when active=false", () => {
    const onComplete = vi.fn();
    const read = vi.fn().mockReturnValue({});
    renderHook(() =>
      usePromptSettle({ active: false, readAgentState: read, onComplete }),
    );
    vi.advanceTimersByTime(PROMPT_SETTLE_MAX_MS + 1_000);
    expect(read).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("exits early when agent reports streaming", () => {
    const onComplete = vi.fn();
    const read = vi.fn().mockReturnValue({ isStreaming: true });
    renderHook(() =>
      usePromptSettle({ active: true, readAgentState: read, onComplete }),
    );
    // First tick fires at INITIAL_DELAY_MS — agent reports streaming,
    // onComplete fires with reason 'agent-streaming'.
    act(() => {
      vi.advanceTimersByTime(PROMPT_SETTLE_INITIAL_DELAY_MS);
    });
    expect(onComplete).toHaveBeenCalledWith({ reason: "agent-streaming" });
  });

  it("fires onComplete with reason=timeout when max is hit without activity", () => {
    const onComplete = vi.fn();
    const read = vi.fn().mockReturnValue({});
    renderHook(() =>
      usePromptSettle({ active: true, readAgentState: read, onComplete }),
    );
    act(() => {
      vi.advanceTimersByTime(PROMPT_SETTLE_MAX_MS + 1);
    });
    expect(onComplete).toHaveBeenCalledWith({ reason: "timeout" });
  });
});

describe("useEventStreamGrace constants + behavior", () => {
  it("EVENT_STREAM_IDLE_GRACE_MS matches pi-web parity", () => {
    expect(EVENT_STREAM_IDLE_GRACE_MS).toBe(30_000);
  });

  it("fires onExpire when grace expires while active", () => {
    vi.useFakeTimers();
    try {
      const onExpire = vi.fn();
      const { result } = renderHook(() =>
        useEventStreamGrace({ active: true, onExpire }),
      );
      act(() => {
        result.current.startGrace();
        vi.advanceTimersByTime(EVENT_STREAM_IDLE_GRACE_MS + 1);
      });
      expect(onExpire).toHaveBeenCalledWith("grace-expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire onExpire when active flips false before expiry", () => {
    vi.useFakeTimers();
    try {
      const onExpire = vi.fn();
      const { result, rerender } = renderHook(
        ({ active }: { active: boolean }) =>
          useEventStreamGrace({ active, onExpire }),
        { initialProps: { active: true } },
      );
      // Start the grace timer while active=true.
      act(() => {
        result.current.startGrace();
      });
      // Flip active=false — the hook's effect should clear the timer.
      act(() => {
        rerender({ active: false });
      });
      // Advance well past the grace window — the timer must NOT fire
      // because the effect already cleared it.
      act(() => {
        vi.advanceTimersByTime(EVENT_STREAM_IDLE_GRACE_MS + 1);
      });
      expect(onExpire).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidation: recordActivity restarts the timer; stale generation is dropped", () => {
    vi.useFakeTimers();
    try {
      const onExpire = vi.fn();
      const { result } = renderHook(() =>
        useEventStreamGrace({ active: true, onExpire }),
      );
      act(() => {
        result.current.startGrace();
        vi.advanceTimersByTime(EVENT_STREAM_IDLE_GRACE_MS - 1_000);
        result.current.recordActivity();
        vi.advanceTimersByTime(500);
      });
      // Half a second after recordActivity — still under the new threshold.
      expect(onExpire).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(EVENT_STREAM_IDLE_GRACE_MS - 500);
      });
      expect(onExpire).toHaveBeenCalledWith("grace-expired");
    } finally {
      vi.useRealTimers();
    }
  });
});