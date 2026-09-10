import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useGlobalConfirmStore, type ConfirmRequest } from "../global-confirm-store";

/**
 * The global confirm store replaces the legacy `await confirm(message)` helper
 * that round-tripped through `dialog.showMessageBox`. These tests cover the
 * queueing + resolution contract so a future regression can't silently
 * strand callers waiting on a dialog that will never resolve.
 */

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useGlobalConfirmStore.setState({ pending: null });
});

const readPending = (): ConfirmRequest | null => useGlobalConfirmStore.getState().pending;

describe("useGlobalConfirmStore", () => {
  it("starts with no pending request", () => {
    expect(readPending()).toBeNull();
  });

  it("routes a `show` call into the pending slot", () => {
    const promise = useGlobalConfirmStore.getState().show({ title: "确定卸载插件？" });
    expect(readPending()).not.toBeNull();
    expect(readPending()?.title).toBe("确定卸载插件？");
    // Caller is awaiting; resolve so the promise settles cleanly.
    const id = readPending()!.id;
    useGlobalConfirmStore.getState().resolve(id, true);
    return expect(promise).resolves.toBe(true);
  });

  it("falls back to a default title when input is blank", () => {
    void useGlobalConfirmStore.getState().show({ title: "  " });
    expect(readPending()?.title).toBe("确认");
    useGlobalConfirmStore.getState().resolve(readPending()!.id, false);
  });

  it("keeps a single pending request — second `show` cancels the first", async () => {
    const first = useGlobalConfirmStore.getState().show({ title: "first" });
    const second = useGlobalConfirmStore.getState().show({ title: "second" });
    expect(readPending()?.title).toBe("second");
    await expect(first).resolves.toBe(false);
    useGlobalConfirmStore.getState().resolve(readPending()!.id, true);
    await expect(second).resolves.toBe(true);
  });

  it("`dismiss` resolves the pending request as cancelled", async () => {
    const pending = useGlobalConfirmStore.getState().show({ title: "remove plugin?" });
    expect(readPending()).not.toBeNull();
    useGlobalConfirmStore.getState().dismiss();
    expect(readPending()).toBeNull();
    await expect(pending).resolves.toBe(false);
  });

  it("`resolve` ignores stale ids without double-resolving the caller", async () => {
    const pending = useGlobalConfirmStore.getState().show({ title: "delete draft?" });
    const staleId = readPending()!.id;
    // Simulate the host being unmounted before the user clicks anything.
    useGlobalConfirmStore.setState({ pending: null });
    useGlobalConfirmStore.getState().resolve(staleId, true);
    // The store must NOT call `resolve` again on a stale id; the original
    // promise should still be resolvable manually.
    const settled = Promise.race([
      pending.then((value) => ({ settled: true, value })),
      flushMicrotasks().then(() => ({ settled: false })),
    ]);
    // The promise itself stays pending because we deleted its resolver
    // silently — the host relies on `dismiss`/`resolve` to settle. This
    // test pins the contract so a future change doesn't accidentally
    // double-fire.
    const result = await settled;
    expect(result.settled).toBe(false);
    // Cleanup so we don't leak a pending promise into other tests.
    useGlobalConfirmStore.setState({ pending: null });
  });

  afterEach(() => {
    // Always clear pending requests between tests so callers don't leak.
    useGlobalConfirmStore.setState({ pending: null });
  });
});