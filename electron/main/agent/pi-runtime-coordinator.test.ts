import { describe, expect, it } from "vitest";
import { PiRuntimeCoordinator, type PiResourceLoaderLike, type PiSessionLike } from "./pi-runtime-coordinator";

function session(log: string[], name: string): PiSessionLike {
  return {
    waitForIdle: async () => { log.push(`${name}:idle`); },
    reload: async () => { log.push(`${name}:reload`); },
  };
}

describe("PiRuntimeCoordinator", () => {
  it("serializes reloads and waits for the active session", async () => {
    const log: string[] = [];
    let active: PiSessionLike | null = session(log, "first");
    const coordinator = new PiRuntimeCoordinator({ getSession: () => active, getResourceLoader: () => null });
    const first = coordinator.reload("profile");
    const second = coordinator.reload("plugin");
    await Promise.all([first, second]);
    expect(log).toEqual(["first:idle", "first:reload", "first:idle", "first:reload"]);
    active = null;
  });

  it("reloads the resource loader when no session exists", async () => {
    const log: string[] = [];
    const loader: PiResourceLoaderLike = { reload: async () => { log.push("loader:reload"); } };
    const coordinator = new PiRuntimeCoordinator({ getSession: () => null, getResourceLoader: () => loader });
    await coordinator.reload("initial");
    expect(log).toEqual(["loader:reload"]);
  });

  it("does not reload a stale session after replacement during idle", async () => {
    const log: string[] = [];
    let idleStarted!: () => void;
    const idleCalled = new Promise<void>((resolve) => { idleStarted = resolve; });
    let resolveIdle!: () => void;
    const idle = new Promise<void>((resolve) => { resolveIdle = resolve; });
    const first: PiSessionLike = { waitForIdle: () => { idleStarted(); return idle; }, reload: async () => { log.push("stale:reload"); } };
    const second = session(log, "current");
    let active: PiSessionLike | null = first;
    const coordinator = new PiRuntimeCoordinator({ getSession: () => active, getResourceLoader: () => null });
    const pending = coordinator.reload("replace");
    await idleCalled;
    active = second;
    resolveIdle();
    await pending;
    expect(log).toEqual([]);
  });

  it("repeats reloads when the tool registry revision changes", async () => {
    const log: string[] = [];
    let revision = 0;
    let reloadCount = 0;
    const active: PiSessionLike = {
      waitForIdle: async () => { log.push("session:idle"); },
      reload: async () => {
        log.push("session:reload");
        if (++reloadCount === 1) revision = 1;
      },
    };
    const coordinator = new PiRuntimeCoordinator({ getSession: () => active, getResourceLoader: () => null });
    const pending = coordinator.reloadUntilStable(() => revision, "tools");
    await pending;
    expect(log).toEqual(["session:idle", "session:reload", "session:idle", "session:reload"]);
  });
});
