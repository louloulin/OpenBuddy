import { describe, expect, it, vi } from "vitest";
import { createUpdateCoalescer, type FrameCancel, type FrameRequest } from "../stream/update-coalescer";

interface FakeFrame {
  request: FrameRequest;
  cancel: FrameCancel;
  pending: Array<() => void>;
}

function fakeFrame(): FakeFrame {
  const pending: Array<() => void> = [];
  return {
    pending,
    request: (callback) => {
      pending.push(() => callback(0));
      return pending.length;
    },
    cancel: (handle) => {
      if (handle !== undefined) pending.splice(handle - 1, 1);
    },
  };
}

describe("createUpdateCoalescer", () => {
  it("batches multiple pushes into a single frame flush, preserving FIFO order", () => {
    const frame = fakeFrame();
    const batches: string[][] = [];
    const coalescer = createUpdateCoalescer<string>((batch) => batches.push([...batch]), {
      requestFrame: frame.request,
      cancelFrame: frame.cancel,
    });
    coalescer.push("a");
    coalescer.push("b");
    expect(coalescer.queued).toBe(2);
    expect(batches).toHaveLength(0);
    frame.pending.shift()?.();
    expect(batches).toEqual([["a", "b"]]);
    expect(coalescer.queued).toBe(0);
  });

  it("never buffers more than maxBuffered updates", () => {
    const frame = fakeFrame();
    const pushed: string[][] = [];
    const coalescer = createUpdateCoalescer<string>((batch) => pushed.push([...batch]), {
      maxBuffered: 3,
      requestFrame: frame.request,
      cancelFrame: frame.cancel,
    });
    coalescer.push("1");
    coalescer.push("2");
    coalescer.push("3");
    // The fourth push overflows the cap and drains synchronously.
    coalescer.push("4");
    expect(coalescer.queued).toBe(1);
    expect(pushed[0]).toEqual(["1", "2", "3"]);
    // The overflowing update starts a fresh frame batch.
    coalescer.push("5");
    expect(coalescer.queued).toBe(2);
    frame.pending.shift()?.();
    expect(pushed[1]).toEqual(["4", "5"]);
  });

  it("manual flush drains immediately and cancels the pending frame", () => {
    const frame = fakeFrame();
    const batches: string[][] = [];
    const coalescer = createUpdateCoalescer<string>((batch) => batches.push([...batch]), {
      requestFrame: frame.request,
      cancelFrame: frame.cancel,
    });
    coalescer.push("x");
    expect(frame.pending).toHaveLength(1);
    coalescer.flush();
    expect(batches).toEqual([["x"]]);
    expect(frame.pending).toHaveLength(0);
    // A leftover frame callback must be a no-op flush (empty batch).
    frame.pending.shift?.();
    expect(batches).toHaveLength(1);
  });

  it("dispose cancels the pending frame and drops the buffer", () => {
    const frame = fakeFrame();
    const flush = vi.fn();
    const coalescer = createUpdateCoalescer<string>(flush, {
      requestFrame: frame.request,
      cancelFrame: frame.cancel,
    });
    coalescer.push("a");
    coalescer.dispose();
    expect(frame.pending).toHaveLength(0);
    expect(flush).not.toHaveBeenCalled();
    coalescer.push("b");
    expect(flush).not.toHaveBeenCalled();
  });

  it("uses the setTimeout fallback when rAF is unavailable", () => {
    vi.useFakeTimers();
    try {
      const batches: string[][] = [];
      const coalescer = createUpdateCoalescer<string>((batch) => batches.push([...batch]), {
        hasAnimationFrame: () => false,
        fallbackWindowMs: 16,
      });
      coalescer.push("a");
      coalescer.push("b");
      vi.advanceTimersByTime(16);
      expect(batches).toEqual([["a", "b"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throughput smoke: 50k pushes coalesce into one drain without degrading", () => {
    const frame = fakeFrame();
    let drained = 0;
    const coalescer = createUpdateCoalescer<number>((batch) => { drained += batch.length; }, {
      requestFrame: frame.request,
      cancelFrame: frame.cancel,
    });
    const start = performance.now();
    for (let index = 0; index < 50_000; index += 1) coalescer.push(index);
    while (coalescer.queued > 0) frame.pending.shift()?.();
    const elapsed = performance.now() - start;
    expect(drained).toBe(50_000);
    expect(coalescer.queued).toBe(0);
    // Generous on a dev machine; an O(N²) regression in push/flush lands in seconds.
    expect(elapsed).toBeLessThan(2000);
  });
});
