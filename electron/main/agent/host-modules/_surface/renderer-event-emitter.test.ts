/**
 * host-modules/_surface/renderer-event-emitter.test.ts
 *
 * v5-A — Verify the renderer event bridge singleton semantics:
 *   - emit is a no-op when no emitter is bound
 *   - bind then emit dispatches exactly once
 *   - returned disposer un-binds and silences subsequent emit
 *   - second bind silently replaces the first (last-wins)
 *   - disposer only releases if it owns the current binding
 */
import { describe, expect, it, vi } from "vitest";

import {
  bindRendererEventEmitter,
  emitRendererEvent,
} from "./renderer-event-emitter";

describe("renderer-event-emitter", () => {
  it("emits nothing when no emitter is bound", () => {
    // The module is module-singleton; we can't unbind from another test,
    // so we just assert that emit() never throws on a cold boot.
    expect(() => emitRendererEvent("openbuddy://test", { ok: true })).not.toThrow();
  });

  it("dispatches to the most-recently-bound emitter", () => {
    const sink = vi.fn();
    const dispose = bindRendererEventEmitter(sink);

    emitRendererEvent("openbuddy://first", { n: 1 });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenLastCalledWith("openbuddy://first", { n: 1 });

    emitRendererEvent("openbuddy://second", { n: 2 });
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink).toHaveBeenLastCalledWith("openbuddy://second", { n: 2 });

    dispose();
  });

  it("silently replaces a previous emitter on re-bind", () => {
    const first = vi.fn();
    const second = vi.fn();

    const disposeFirst = bindRendererEventEmitter(first);
    const disposeSecond = bindRendererEventEmitter(second);

    emitRendererEvent("openbuddy://event", { x: 1 });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith("openbuddy://event", { x: 1 });

    disposeFirst();
    disposeSecond();
  });

  it("returns a disposer that only releases its own binding", () => {
    const outer = vi.fn();
    const inner = vi.fn();

    const disposeOuter = bindRendererEventEmitter(outer);
    const disposeInner = bindRendererEventEmitter(inner);

    // disposeOuter was created for a stale binding; it must not null the
    // current emitter (inner), otherwise emit would silently drop.
    disposeOuter();
    emitRendererEvent("openbuddy://survive", { ok: true });
    expect(inner).toHaveBeenCalledTimes(1);

    disposeInner();
    emitRendererEvent("openbuddy://after-dispose", { ok: true });
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
