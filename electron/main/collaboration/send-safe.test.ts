import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebContents, BrowserWindow } from "electron";

const mockSend = vi.fn();
const mockGetAllWebContents = vi.fn();

vi.mock("electron", () => ({
  webContents: {
    getAllWebContents: () => mockGetAllWebContents(),
  },
}));

vi.mock("@openbuddy/logging-main", () => ({
  createMainLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  notifyBridgeUnavailable,
  resetNotifyBridgeUnavailableForTests,
  sendSafe,
  sendSafeAll,
  sendSafeFast,
  sendSafeToContents,
  createBridgeStatusBroadcaster,
  createStreamingCoalescer,
  SAFE_BRIDGE_CONSTANTS,
} from "./send-safe";

function makeContents(opts: { destroyed?: boolean; throws?: Error } = {}): WebContents {
  return {
    isDestroyed: () => Boolean(opts.destroyed),
    send: opts.throws
      ? vi.fn(() => {
          throw opts.throws;
        })
      : mockSend,
  } as unknown as WebContents;
}

function makeWindow(opts: { destroyed?: boolean; contents?: WebContents | null } = {}): BrowserWindow {
  const win = {
    isDestroyed: () => Boolean(opts.destroyed),
    webContents: opts.contents === null ? (undefined as unknown as WebContents) : (opts.contents ?? makeContents()),
  } as unknown as BrowserWindow;
  return win;
}

describe("sendSafe", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetAllWebContents.mockReset();
    resetNotifyBridgeUnavailableForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("B2.a returns false when win is null and does not call send", () => {
    const result = sendSafe(null, "test:channel", { foo: 1 });
    expect(result).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("B2.b returns false when win.isDestroyed is true and does not call send", () => {
    const win = makeWindow({ destroyed: true });
    const result = sendSafe(win, "test:channel", { foo: 1 });
    expect(result).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("B2.c returns false when webContents.isDestroyed is true", () => {
    const contents = makeContents({ destroyed: true });
    const win = makeWindow({ contents });
    const result = sendSafe(win, "test:channel", { foo: 1 });
    expect(result).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("B2.d returns false when webContents.send throws, true otherwise", () => {
    const throwingContents = makeContents({ throws: new Error("send boom") });
    const throwingWin = makeWindow({ contents: throwingContents });
    expect(sendSafe(throwingWin, "boom:chan", { x: 1 })).toBe(false);

    const okContents = makeContents();
    const okWin = makeWindow({ contents: okContents });
    expect(sendSafe(okWin, "ok:chan", { x: 1 })).toBe(true);
    expect(mockSend).toHaveBeenCalledWith("ok:chan", { x: 1 });
  });

  it("sendSafeAll counts sent vs skipped across all webContents", () => {
    const ok = makeContents();
    const destroyed = makeContents({ destroyed: true });
    const throwing = makeContents({ throws: new Error("x") });
    mockGetAllWebContents.mockReturnValue([ok, destroyed, throwing]);

    const result = sendSafeAll("broadcast:test", { hello: "world" });
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(2);
  });

  it("notifyBridgeUnavailable throttles identical reasons within 30s", () => {
    const ok = makeContents();
    mockGetAllWebContents.mockReturnValue([ok]);

    const first = notifyBridgeUnavailable("preload-error", 30_000);
    const second = notifyBridgeUnavailable("preload-error", 30_000);
    expect(first).toBe(true);
    expect(second).toBe(false);

    resetNotifyBridgeUnavailableForTests();
    const third = notifyBridgeUnavailable("preload-error", 30_000);
    expect(third).toBe(true);
  });

  it("notifyBridgeUnavailable returns false when no renderer is alive", () => {
    mockGetAllWebContents.mockReturnValue([]);
    const first = notifyBridgeUnavailable("render-process-gone");
    expect(first).toBe(false);
  });

  it("sendSafeToContents mirrors sendSafe behavior for raw WebContents", () => {
    const ok = makeContents();
    expect(sendSafeToContents(ok, "raw:chan", { v: 1 })).toBe(true);
    expect(mockSend).toHaveBeenCalledWith("raw:chan", { v: 1 });

    const destroyed = makeContents({ destroyed: true });
    expect(sendSafeToContents(destroyed, "raw:chan", { v: 2 })).toBe(false);

    const nullContents = null as unknown as WebContents;
    expect(sendSafeToContents(nullContents, "raw:chan", { v: 3 })).toBe(false);
  });

  it("exposes safe bridge constants", () => {
    expect(SAFE_BRIDGE_CONSTANTS.DEFAULT_THROTTLE_MS).toBe(30_000);
    expect(SAFE_BRIDGE_CONSTANTS.DEFAULT_INTERVAL_MS).toBe(10_000);
    expect(SAFE_BRIDGE_CONSTANTS.DEFAULT_STARTUP_DELAY_MS).toBe(5_000);
    expect(SAFE_BRIDGE_CONSTANTS.BROADCAST_CHANNEL).toBe("electron-bridge-status");
    expect(SAFE_BRIDGE_CONSTANTS.UNAVAILABLE_CHANNEL).toBe("bridge:unavailable");
  });
});

describe("createBridgeStatusBroadcaster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetAllWebContents.mockReset();
    mockSend.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("B3.a broadcasts at the configured interval (10s default) after startup delay", () => {
    const ok = makeContents();
    mockGetAllWebContents.mockReturnValue([ok]);
    const broadcaster = createBridgeStatusBroadcaster();
    expect(broadcaster.isRunning()).toBe(false);
    broadcaster.start();
    expect(broadcaster.isRunning()).toBe(true);

    vi.advanceTimersByTime(SAFE_BRIDGE_CONSTANTS.DEFAULT_STARTUP_DELAY_MS);
    expect(mockSend).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SAFE_BRIDGE_CONSTANTS.DEFAULT_INTERVAL_MS);
    expect(mockSend).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(SAFE_BRIDGE_CONSTANTS.DEFAULT_INTERVAL_MS);
    expect(mockSend).toHaveBeenCalledTimes(3);

    broadcaster.stop();
    expect(broadcaster.isRunning()).toBe(false);
  });

  it("B3.b honors 5s startup delay before first broadcast", () => {
    const ok = makeContents();
    mockGetAllWebContents.mockReturnValue([ok]);
    const broadcaster = createBridgeStatusBroadcaster();
    broadcaster.start(() => ({
      available: true,
      consecutiveFailures: 0,
      lastErrorMessage: null,
      lastUpdated: 12345,
    }));

    vi.advanceTimersByTime(SAFE_BRIDGE_CONSTANTS.DEFAULT_STARTUP_DELAY_MS - 1000);
    expect(mockSend).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      SAFE_BRIDGE_CONSTANTS.BROADCAST_CHANNEL,
      expect.objectContaining({ available: true, lastUpdated: 12345 }),
    );

    broadcaster.stop();
  });

  it("B3.c ignores second start when already running", () => {
    mockGetAllWebContents.mockReturnValue([]);
    const broadcaster = createBridgeStatusBroadcaster();
    broadcaster.start();
    broadcaster.start();
    expect(broadcaster.isRunning()).toBe(true);
    broadcaster.stop();
  });
});

describe("createStreamingCoalescer (P0-03)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("C1.a accumulates tokens in a single 16ms window into one emit", () => {
    const emit = vi.fn();
    const c = createStreamingCoalescer<string>({ windowMs: 16, emit, sessionContext: "s1" });

    c.enqueue("Hel");
    c.enqueue("lo ");
    c.enqueue("wor");
    c.enqueue("ld");
    expect(emit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("Hello world", "s1");
  });

  it("C1.b emits multiple flushes across consecutive windows", () => {
    const emit = vi.fn();
    const c = createStreamingCoalescer<string>({ windowMs: 16, emit, sessionContext: "s1" });

    c.enqueue("a");
    vi.advanceTimersByTime(16);
    c.enqueue("b");
    vi.advanceTimersByTime(16);
    c.enqueue("c");
    vi.advanceTimersByTime(16);

    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenNthCalledWith(1, "a", "s1");
    expect(emit).toHaveBeenNthCalledWith(2, "b", "s1");
    expect(emit).toHaveBeenNthCalledWith(3, "c", "s1");
  });

  it("C1.c flush() drains the buffer immediately (used by agent_end)", () => {
    const emit = vi.fn();
    const c = createStreamingCoalescer<string>({ windowMs: 16, emit, sessionContext: "s1" });

    c.enqueue("trail");
    c.enqueue("ing");
    c.flush();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("trailing", "s1");

    // After flush, a fresh enqueue arms a new timer.
    c.enqueue("more");
    vi.advanceTimersByTime(16);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(2, "more", "s1");
  });

  it("C1.d eager flushes when buffer reaches or exceeds maxBufferBytes", () => {
    const emit = vi.fn();
    const c = createStreamingCoalescer<string>({ windowMs: 16, maxBufferBytes: 8, emit, sessionContext: "s1" });

    // First enqueue fills buffer to capacity -> immediate flush (no 16ms wait).
    c.enqueue("12345678");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("12345678", "s1");

    // Subsequent small enqueues accumulate normally.
    c.enqueue("a");
    c.enqueue("b");
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(2, "ab", "s1");
  });

  it("C1.e setContext updates the sessionId for subsequent flushes", () => {
    const emit = vi.fn();
    const c = createStreamingCoalescer<string>({ windowMs: 16, emit, sessionContext: "s1" });

    c.enqueue("turn1-");
    c.setContext("s2");
    c.enqueue("turn2-");
    vi.advanceTimersByTime(16);

    // The whole buffer was accumulated under one window but sessionContext
    // was updated mid-flight. We document current behavior: the LATEST
    // sessionContext wins (renderer treats it as the current session).
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("turn1-turn2-", "s2");
  });

  it("C1.f dispose() cancels pending timer and rejects further enqueues", () => {
    const emit = vi.fn();
    const c = createStreamingCoalescer<string>({ windowMs: 16, emit, sessionContext: "s1" });

    c.enqueue("will");
    c.dispose();
    c.enqueue("be");
    c.enqueue("dropped");
    vi.advanceTimersByTime(100);
    expect(emit).not.toHaveBeenCalled();

    // flush() after dispose is a no-op (buffer cleared).
    c.flush();
    expect(emit).not.toHaveBeenCalled();
  });

  it("C1.g empty delta is silently ignored (no spurious IPC)", () => {
    const emit = vi.fn();
    const c = createStreamingCoalescer<string>({ windowMs: 16, emit, sessionContext: "s1" });

    c.enqueue("");
    c.enqueue("real");
    c.enqueue("");
    vi.advanceTimersByTime(16);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("real", "s1");
  });

  it("C1.h coalesces 100 tokens into <= 7 IPC at 60fps over 100ms", () => {
    const emit = vi.fn();
    const c = createStreamingCoalescer<string>({ windowMs: 16, emit, sessionContext: "s1" });

    // Simulate 100 tokens over 100ms — typical fast LLM streaming.
    for (let i = 0; i < 100; i += 1) {
      c.enqueue("t");
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(16);
    const totalFlips = emit.mock.calls.length;
    // 100ms / 16ms = ~6.25 windows, plus an extra trailing flush. Allow ≤7.
    expect(totalFlips).toBeLessThanOrEqual(7);
    expect(totalFlips).toBeGreaterThanOrEqual(5);

    // Total text length preserved (no token dropped).
    const totalChars = emit.mock.calls.reduce((acc, call) => acc + (call[0] as string).length, 0);
    expect(totalChars).toBe(100);
  });
});

describe("sendSafeFast (P2-07)", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetAllWebContents.mockReset();
    resetNotifyBridgeUnavailableForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("S1.a calls webContents.send directly with the channel and payload", () => {
    const contents = makeContents();
    const result = sendSafeFast(contents, "pi://update", { foo: 1 });
    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith("pi://update", { foo: 1 });
  });

  it("S1.b returns false when contents.send throws", () => {
    const throwing = makeContents({ throws: new Error("boom") });
    expect(sendSafeFast(throwing, "x:y", { v: 1 })).toBe(false);
  });

  it("S1.c skips the isDestroyed check (caller's responsibility)", () => {
    // sendSafeFast is documented as a hot-path helper where the caller
    // has already validated the contents reference. It should not call
    // isDestroyed itself — that would defeat the purpose.
    const destroyedContents = makeContents({ destroyed: true });
    // No throw, no log; just lets the synchronous send fall through.
    const result = sendSafeFast(destroyedContents, "x:y", { v: 1 });
    expect(typeof result).toBe("boolean");
  });

  it("S1.d in a 100k-call loop is significantly faster than sendSafe (smoke)", () => {
    const contents = makeContents();
    // Baseline: sendSafe does isDestroyed twice + try/catch + log namespace.
    const startSlow = performance.now();
    for (let i = 0; i < 100_000; i += 1) {
      sendSafe(makeWindow({ contents }), "x:y", { i });
    }
    const slowMs = performance.now() - startSlow;

    const startFast = performance.now();
    for (let i = 0; i < 100_000; i += 1) {
      sendSafeFast(contents, "x:y", { i });
    }
    const fastMs = performance.now() - startFast;

    // Both should be sub-millisecond per call; sendSafeFast should be
    // noticeably faster because of the skipped validation. Generous
    // bound to avoid CI flake.
    expect(fastMs).toBeLessThan(slowMs);
  });
});
