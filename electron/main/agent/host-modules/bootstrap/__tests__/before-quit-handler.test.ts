import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QuitHandler = (event: { preventDefault: () => void }) => void | Promise<void>;
let lastHandler: QuitHandler | undefined;
const handlersRemoved: string[] = [];

vi.mock("electron", () => ({
  app: {
    on: (channel: string, handler: QuitHandler) => { if (channel === "before-quit") lastHandler = handler; },
    removeListener: (channel: string, _handler: QuitHandler) => { if (channel === "before-quit") handlersRemoved.push(channel); },
    exit: vi.fn(),
  },
}));

const { installBeforeQuitHandler } = await import("../before-quit-handler");

const cleanups: Array<() => void> = [];

afterEach(() => { for (const c of cleanups.splice(0)) c(); });

beforeEach(() => {
  lastHandler = undefined;
  handlersRemoved.length = 0;
});

describe("before-quit guard (Phase 2.1 exit safety)", () => {
  it("proceeds with dispose when the guard returns ok", async () => {
    let disposeCalls = 0;
    const blocked: string[] = [];
    const handle = installBeforeQuitHandler({
      dispose: async () => { disposeCalls += 1; },
      guard: async () => ({ ok: true }),
      onBlocked: (payload) => blocked.push(payload.reason),
    });
    cleanups.push(() => handle.uninstall());
    const event = { preventDefault: vi.fn() };
    await lastHandler!(event);
    // dispose is fired via void dispose()... — give the microtask queue a tick.
    await new Promise((resolve) => setImmediate(resolve));
    expect(disposeCalls).toBe(1);
    expect(blocked).toEqual([]);
  });

  it("blocks the quit, prevents default, and surfaces the reason without disposing when the guard fails", async () => {
    let disposeCalls = 0;
    const blocked: Array<{ reason: string }> = [];
    const handle = installBeforeQuitHandler({
      dispose: async () => { disposeCalls += 1; },
      guard: async () => ({ ok: false, reason: "2 workbench tasks still in flight" }),
      onBlocked: (payload) => blocked.push(payload),
    });
    cleanups.push(() => handle.uninstall());
    const event = { preventDefault: vi.fn() };
    await lastHandler!(event);
    await new Promise((resolve) => setImmediate(resolve));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(disposeCalls).toBe(0);
    expect(blocked).toEqual([{ reason: "2 workbench tasks still in flight" }]);
  });

  it("still proceeds when the guard throws (errors must not block quit silently)", async () => {
    let disposeCalls = 0;
    const handle = installBeforeQuitHandler({
      dispose: async () => { disposeCalls += 1; },
      guard: async () => { throw new Error("boom"); },
    });
    cleanups.push(() => handle.uninstall());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    cleanups.push(() => errorSpy.mockRestore());
    await lastHandler!({ preventDefault: vi.fn() });
    await new Promise((resolve) => setImmediate(resolve));
    expect(disposeCalls).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not double-dispose on a second before-quit while dispose is in flight", async () => {
    let disposeCalls = 0;
    let resolveDispose: (() => void) | undefined;
    const disposePromise = new Promise<void>((resolve) => { resolveDispose = resolve; });
    const handle = installBeforeQuitHandler({
      dispose: async () => { disposeCalls += 1; await disposePromise; },
    });
    cleanups.push(() => handle.uninstall());
    const e1 = { preventDefault: vi.fn() };
    await lastHandler!(e1);
    const e2 = { preventDefault: vi.fn() };
    await lastHandler!(e2);
    expect(e1.preventDefault).toHaveBeenCalled();
    expect(e2.preventDefault).toHaveBeenCalled();
    resolveDispose!();
    await new Promise((resolve) => setImmediate(resolve));
    expect(disposeCalls).toBe(1);
  });
});