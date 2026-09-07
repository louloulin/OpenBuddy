/**
 * pi-runtime-refresh.test.ts — smoke tests for refreshPiExtensions().
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installPiRuntimeRefresh,
  refreshPiExtensions,
  __resetPiRuntimeRefreshForTest,
} from "./pi-runtime-refresh";
import { createDefaultAgentHostState } from "./_default-state";

afterEach(() => {
  __resetPiRuntimeRefreshForTest();
});

describe("pi-runtime-refresh", () => {
  it("throws when not installed", () => {
    expect(() => refreshPiExtensions()).toThrow(/not installed/);
  });

  it("no-op when no active session", () => {
    const state = createDefaultAgentHostState();
    const reloadUntilStable = vi.fn(async () => undefined);
    installPiRuntimeRefresh({
      state,
      piRuntimeCoordinator: { reloadUntilStable },
    });
    refreshPiExtensions();
    expect(reloadUntilStable).not.toHaveBeenCalled();
    // piRefreshPromise is initialized as Promise.resolve() in default state; we
    // verify it wasn't *replaced* by a new reloadUntilStable call.
    expect(reloadUntilStable).not.toHaveBeenCalled();
  });

  it("invokes reloadUntilStable with tool-registry revision + reason", () => {
    const state = createDefaultAgentHostState();
    state.session = { sessionId: "x" } as any;
    state.toolRegistryRevision = 5;
    const reloadUntilStable = vi.fn(async () => undefined);
    installPiRuntimeRefresh({
      state,
      piRuntimeCoordinator: { reloadUntilStable },
    });
    refreshPiExtensions();
    expect(reloadUntilStable).toHaveBeenCalledTimes(1);
    const [check, reason] = reloadUntilStable.mock.calls[0]!;
    expect(check()).toBe(5);
    expect(reason).toBe("tool-registry");
    expect(state.piRefreshPromise).toBeDefined();
  });

  it("catches errors and logs warning", async () => {
    const state = createDefaultAgentHostState();
    state.session = { sessionId: "x" } as any;
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installPiRuntimeRefresh({
      state,
      piRuntimeCoordinator: { reloadUntilStable: vi.fn(async () => { throw new Error("boom"); }) },
    });
    refreshPiExtensions();
    await state.piRefreshPromise;
    expect(consoleWarn).toHaveBeenCalledWith("[openbuddy] failed to refresh Pi extensions", expect.any(Error));
  });
});
