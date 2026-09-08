/**
 * init-orchestration.test.ts — smoke tests for `init` lifecycle + telemetry facade.
 */
import { afterEach, it, expect, describe, vi } from "vitest";

import {
  installInitOrchestration,
  init,
  getInitialisationPromise,
  __resetInitOrchestrationForTest,
  __resetInitialisationPromiseForTest,
} from "./init-orchestration";

afterEach(() => {
  __resetInitOrchestrationForTest();
  __resetInitialisationPromiseForTest();
});

describe("init-orchestration", () => {
  it("calls install.initialize() through the lifecycle queue", async () => {
    const initialize = vi.fn(async () => undefined);
    const enqueueLifecycle = vi.fn(async (op: () => Promise<unknown>) => op()) as unknown as <T>(operation: () => Promise<T>) => Promise<T>;
    installInitOrchestration({ initialize, enqueueLifecycle });

    await init({ cwd: "/tmp" });
    expect(enqueueLifecycle).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith({ cwd: "/tmp" });
  });

  it("tracks in-flight promise until initialize resolves", async () => {
    let resolveInit: () => void = () => undefined;
    const initialize = vi.fn(() => new Promise<void>((res) => { resolveInit = res; }));
    installInitOrchestration({
      initialize,
      enqueueLifecycle: async <T>(op: () => Promise<T>) => op(),
    });

    const p = init({ cwd: "/x" });
    expect(getInitialisationPromise()).toBe(p);
    resolveInit();
    await p;
    expect(getInitialisationPromise()).toBe(null);
  });

  it("clears in-flight promise on failure too", async () => {
    installInitOrchestration({
      initialize: vi.fn(async () => { throw new Error("boom"); }),
      enqueueLifecycle: async <T>(op: () => Promise<T>) => op(),
    });

    await expect(init({})).rejects.toThrow(/boom/);
    expect(getInitialisationPromise()).toBe(null);
  });

  it("uses getCurrentSessionId fallback when opts.sessionId is absent", async () => {
    const initialize = vi.fn(async () => undefined);
    installInitOrchestration({
      initialize,
      enqueueLifecycle: async <T>(op: () => Promise<T>) => op(),
      getCurrentSessionId: () => "fallback-session",
    });
    await init({ cwd: "/tmp" });
    // Just check initialize was called with cwd and no sessionId (fallback
    // is used for logging only).
    expect(initialize).toHaveBeenCalledWith({ cwd: "/tmp" });
  });
});
