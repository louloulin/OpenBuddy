import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enqueueLifecycle,
  enqueueLifecycleByKind,
  flushLifecycleTails,
  LifecycleTimeout,
  LIFECYCLE_INIT_TIMEOUT_MS,
  LIFECYCLE_LEGACY_TIMEOUT_MS,
  LIFECYCLE_TIMEOUT_MS,
  resetLifecycleTailsForTests,
  type LifecycleKind,
} from "./lifecycle-tail";

afterEach(async () => {
  resetLifecycleTailsForTests();
  await flushLifecycleTails();
});

describe("enqueueLifecycleByKind", () => {
  it("serializes operations of the same kind", async () => {
    const order: string[] = [];
    const release: { current: (() => void) | null } = { current: null };
    const blocked = new Promise<void>((resolve) => { release.current = resolve; });

    const first = enqueueLifecycleByKind("profile", async () => {
      order.push("first:start");
      await blocked;
      order.push("first:end");
      return "first";
    });
    const second = enqueueLifecycleByKind("profile", async () => {
      order.push("second");
      return "second";
    });
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    release.current?.();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("runs operations of different kinds in parallel", async () => {
    const order: string[] = [];
    let releaseInit!: () => void;
    const initBlocked = new Promise<void>((resolve) => { releaseInit = resolve; });

    const init = enqueueLifecycleByKind("init", async () => {
      order.push("init:start");
      await initBlocked;
      order.push("init:end");
      return "init";
    });
    // Yield so the init op is registered and starts.
    await Promise.resolve();
    const profile = enqueueLifecycleByKind("profile", async () => {
      order.push("profile");
      return "profile";
    });
    await expect(profile).resolves.toBe("profile");
    expect(order).toEqual(["init:start", "profile"]);
    releaseInit();
    await expect(init).resolves.toBe("init");
  });

  it("rejects with LifecycleTimeout when an op exceeds the per-kind timeout", async () => {
    vi.useFakeTimers();
    try {
      const promise = enqueueLifecycleByKind("reload", () => new Promise(() => {}), 25);
      const expectation = expect(promise).rejects.toBeInstanceOf(LifecycleTimeout);
      await vi.advanceTimersByTimeAsync(30);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the queue usable after a timeout", async () => {
    vi.useFakeTimers();
    try {
      const stuck = enqueueLifecycleByKind("preset", () => new Promise(() => {}), 50);
      const expectation = expect(stuck).rejects.toBeInstanceOf(LifecycleTimeout);
      await vi.advanceTimersByTimeAsync(60);
      await expectation;

      const follow = enqueueLifecycleByKind("preset", async () => "ok", 1_000);
      await expect(follow).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses 30s timeout for non-init kinds and 5min for init", () => {
    expect(LIFECYCLE_TIMEOUT_MS).toBe(30_000);
    expect(LIFECYCLE_INIT_TIMEOUT_MS).toBe(5 * 60 * 1000);
    expect(LIFECYCLE_LEGACY_TIMEOUT_MS).toBe(5_000);
  });

  it("legacy enqueueLifecycle routes to the reload queue with 5s timeout", async () => {
    vi.useFakeTimers();
    try {
      const promise = enqueueLifecycle(() => new Promise(() => {}));
      const expectation = expect(promise).rejects.toBeInstanceOf(LifecycleTimeout);
      await vi.advanceTimersByTimeAsync(6_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("covers all five kinds", async () => {
    const kinds: LifecycleKind[] = ["init", "dispose", "preset", "profile", "reload"];
    for (const kind of kinds) {
      await expect(
        enqueueLifecycleByKind(kind, async () => kind, 1_000),
      ).resolves.toBe(kind);
    }
  });
});
