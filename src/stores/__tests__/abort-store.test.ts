/**
 * R5.3 — abort-store unit tests.
 *
 * Validates the registry's three guarantees:
 *   1. register returns a fresh AbortController per session id.
 *   2. Calling abort() on a registered session flips the signal and removes
 *      it from the registry.
 *   3. Registering twice for the same session aborts the prior controller
 *      (no orphan in-flight sends).
 *   4. clear() removes without aborting (used on natural completion).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useAbortStore } from "../abort-store";

describe("useAbortStore", () => {
  beforeEach(() => {
    useAbortStore.setState({ controllers: {} });
  });

  it("register returns a working AbortController", () => {
    const c = useAbortStore.getState().register("s1");
    expect(c).toBeInstanceOf(AbortController);
    expect(c.signal.aborted).toBe(false);
    expect(useAbortStore.getState().controllers["s1"]).toBe(c);
  });

  it("abort() flips the signal and removes the controller", () => {
    const c = useAbortStore.getState().register("s1");
    useAbortStore.getState().abort("s1");
    expect(c.signal.aborted).toBe(true);
    expect(useAbortStore.getState().controllers["s1"]).toBeUndefined();
  });

  it("re-registering for the same session aborts the prior controller", () => {
    const first = useAbortStore.getState().register("s1");
    const second = useAbortStore.getState().register("s1");
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(useAbortStore.getState().controllers["s1"]).toBe(second);
  });

  it("clear() removes without aborting (natural completion path)", () => {
    const c = useAbortStore.getState().register("s1");
    useAbortStore.getState().clear("s1");
    expect(c.signal.aborted).toBe(false);
    expect(useAbortStore.getState().controllers["s1"]).toBeUndefined();
  });

  it("abort() on an unknown session is a no-op", () => {
    expect(() => useAbortStore.getState().abort("nope")).not.toThrow();
    expect(useAbortStore.getState().controllers).toEqual({});
  });
});