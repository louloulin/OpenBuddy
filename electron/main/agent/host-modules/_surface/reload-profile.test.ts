/**
 * host-modules/_surface/reload-profile.test.ts
 *
 * v7-A — Verify reloadProfile runs the 3-stage pipeline in order:
 *   1. scheduleProfileReload signal
 *   2. ~160ms grace delay (file-watcher debounce)
 *   3. await state.profileReloadPromise
 */
import { describe, expect, it, vi } from "vitest";

import { reloadProfile } from "./reload-profile";

describe("reloadProfile", () => {
  it("calls scheduleProfileReload before awaiting the reload promise", async () => {
    const callOrder: string[] = [];
    const schedule = vi.fn(() => callOrder.push("schedule"));
    // Block the reload promise on a deferred so we can observe ordering.
    const deferred: { promise: Promise<void>; resolve: () => void } = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = () => {
          callOrder.push("profileReloadPromise-resolved");
          r();
        };
      });
      return { promise, resolve };
    })();
    const state: { profileReloadPromise: Promise<void> } = { profileReloadPromise: deferred.promise };
    const p = reloadProfile(state, schedule);
    // schedule fires synchronously, then the grace timer kicks off.
    expect(callOrder).toEqual(["schedule"]);
    deferred.resolve();
    await p;
    expect(callOrder).toContain("profileReloadPromise-resolved");
  });

  it("honors the 160ms grace window", async () => {
    const schedule = vi.fn();
    const state = { profileReloadPromise: Promise.resolve() };
    const t0 = Date.now();
    await reloadProfile(state, schedule);
    const elapsed = Date.now() - t0;
    // Allow ±50ms scheduling jitter.
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(300);
  });

  it("propagates rejection from state.profileReloadPromise", async () => {
    const schedule = vi.fn();
    const failure = new Error("reload crashed");
    const state = { profileReloadPromise: Promise.reject(failure) };
    // Catch the unhandled rejection so vitest doesn't complain.
    state.profileReloadPromise.catch(() => undefined);
    await expect(reloadProfile(state, schedule)).rejects.toBe(failure);
  });
});
