/**
 * Bounded frame-coalescer for high-frequency stream updates.
 *
 * Pi can emit dozens of `pi://update` events per second while a tool turn
 * streams. Applying each one as a separate React render burns frames on
 * every chunk. This util buffers updates and drains them once per animation
 * frame, so the worst case is ~60 render batches/sec regardless of the
 * model cadence.
 *
 * Guarantees:
 * - FIFO ordering is preserved across flushes.
 * - The buffer is bounded (`maxBuffered`), so a pathological burst between
 *   frames cannot grow memory without limit: it forces an immediate drain.
 * - Terminal/error events are NOT routed through this util on purpose —
 *   `pi://complete` and `pi://turn-error` arrive on their own channels and
 *   are dispatched synchronously, so coalescing can never swallow them.
 * - `dispose()` cancels the pending frame and drops the buffer, so HMR or
 *   unmount cannot leak timers or flush into a dead tree.
 */

export type CoalescerFlushHandler<T> = (batch: readonly T[]) => void;
export type FrameRequest = (callback: FrameRequestCallback) => number;
export type FrameCancel = (handle: number) => void;

export interface UpdateCoalescerOptions {
  /** Hard cap on buffered updates between flushes. Default 4096. */
  maxBuffered?: number;
  /** Fallback coalescing window when no rAF is available. Default 16ms. */
  fallbackWindowMs?: number;
  /** Injectable scheduler (tests). Defaults to rAF, falling back to setTimeout. */
  requestFrame?: FrameRequest;
  /** Injectable cancel (tests). Defaults to cancelAnimationFrame/clearTimeout. */
  cancelFrame?: FrameCancel;
  hasAnimationFrame?: () => boolean;
  setTimeoutFallback?: (cb: FrameRequestCallback, ms: number) => number;
  clearTimeoutFallback?: (handle: number) => void;
}

export interface UpdateCoalescer<T> {
  /** Enqueue one update. May synchronously drain when the buffer is full. */
  push(update: T): void;
  /** Drain the current buffer synchronously (used by tests and manual flush). */
  flush(): void;
  /** Number of updates currently buffered. */
  readonly queued: number;
  /** Cancel the pending frame and drop the buffer. */
  dispose(): void;
}

export function createUpdateCoalescer<T>(
  flush: CoalescerFlushHandler<T>,
  options: UpdateCoalescerOptions = {},
): UpdateCoalescer<T> {
  const maxBuffered = Math.max(1, Math.floor(options.maxBuffered ?? 4096));
  const fallbackWindowMs = Math.max(0, options.fallbackWindowMs ?? 16);
  const hasAnimationFrame = options.hasAnimationFrame ?? ((): boolean => typeof requestAnimationFrame === "function");
  const requestFrame: FrameRequest =
    options.requestFrame ??
    ((callback) => {
      if (hasAnimationFrame() && typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
      const fallback = options.setTimeoutFallback ?? ((cb, ms) => setTimeout(cb, ms));
      return fallback(callback, fallbackWindowMs) as unknown as number;
    });
  const cancelFrame: FrameCancel =
    options.cancelFrame ??
    ((handle) => {
      if (hasAnimationFrame() && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(handle);
        return;
      }
      const clear = options.clearTimeoutFallback ?? ((h: number) => clearTimeout(h));
      clear(handle);
    });

  let buffer: T[] = [];
  let pendingFrame: number | null = null;
  let disposed = false;

  const drain = (): void => {
    pendingFrame = null;
    const batch = buffer;
    buffer = [];
    if (batch.length > 0) flush(batch);
  };

  const schedule = (): void => {
    if (pendingFrame !== null || disposed) return;
    pendingFrame = requestFrame(() => drain());
  };

  return {
    push(update: T): void {
      if (disposed) return;
      if (buffer.length >= maxBuffered) {
        // Bound the queue: a burst bigger than the cap flushes immediately
        // instead of growing a frame's worth of work without limit.
        if (pendingFrame !== null) {
          cancelFrame(pendingFrame);
          pendingFrame = null;
        }
        drain();
      }
      buffer.push(update);
      schedule();
    },
    flush(): void {
      if (disposed) return;
      if (pendingFrame !== null) {
        cancelFrame(pendingFrame);
        pendingFrame = null;
      }
      drain();
    },
    get queued(): number {
      return buffer.length;
    },
    dispose(): void {
      disposed = true;
      if (pendingFrame !== null) {
        cancelFrame(pendingFrame);
        pendingFrame = null;
      }
      buffer = [];
    },
  };
}
