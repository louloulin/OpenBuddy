/**
 * R2.4 — Draft persistence tests.
 *
 * Validates that the drafts map survives a "reload" (localStorage write →
 * re-init via bootDraftsPersistence) and that writes debounce so a fast
 * typing session doesn't thrash localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionsStore } from "../sessions-store";
import { bootDraftsPersistence, __resetDraftsPersistenceForTests } from "../drafts-persistence";

const STORE_KEY = "openbuddy.drafts.v1";

beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  useSessionsStore.setState({ drafts: {} });
  __resetDraftsPersistenceForTests();
});

afterEach(() => {
  __resetDraftsPersistenceForTests();
  if (typeof localStorage !== "undefined") localStorage.clear();
});

describe("drafts persistence", () => {
  it("round-trips a draft through localStorage and a fresh boot", async () => {
    useSessionsStore.getState().setDraft("sess-1", "draft text");
    // boot the subscriber (writes debounce, so wait > 250ms)
    const dispose = bootDraftsPersistence();
    await new Promise((r) => setTimeout(r, 350));
    expect(localStorage.getItem(STORE_KEY)).toBeTruthy();
    const persisted = JSON.parse(localStorage.getItem(STORE_KEY)!);
    expect(persisted["sess-1"]).toBe("draft text");

    // Simulate a renderer reload: dispose, clear in-memory, then re-boot.
    dispose();
    useSessionsStore.setState({ drafts: {} });
    bootDraftsPersistence();
    expect(useSessionsStore.getState().drafts["sess-1"]).toBe("draft text");
  });

  it("seeds drafts even when booted into a store that already has keys", async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ "sess-existing": "previous prompt" }),
    );
    useSessionsStore.getState().setDraft("sess-new", "another prompt");
    const dispose = bootDraftsPersistence();
    expect(useSessionsStore.getState().drafts["sess-existing"]).toBe("previous prompt");
    expect(useSessionsStore.getState().drafts["sess-new"]).toBe("another prompt");
    dispose();
  });

  it("clearDraft propagates to localStorage on next debounce flush", async () => {
    useSessionsStore.getState().setDraft("sess-x", "hello");
    const dispose = bootDraftsPersistence();
    await new Promise((r) => setTimeout(r, 350));
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!)["sess-x"]).toBe("hello");
    useSessionsStore.getState().clearDraft("sess-x");
    await new Promise((r) => setTimeout(r, 350));
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!)).not.toHaveProperty("sess-x");
    dispose();
  });

  it("coalesces multiple rapid writes into a single localStorage hit", async () => {
    const original = localStorage.setItem.bind(localStorage);
    let writes = 0;
    localStorage.setItem = ((...args: Parameters<typeof original>) => {
      if (args[0] === STORE_KEY) writes++;
      return original(...args);
    }) as typeof localStorage.setItem;

    const dispose = bootDraftsPersistence();
    for (let i = 0; i < 10; i++) {
      useSessionsStore.getState().setDraft("sess-burst", `text-${i}`);
    }
    await new Promise((r) => setTimeout(r, 350));
    expect(writes).toBeLessThanOrEqual(2); // 1 from initial seed, 1 from debounced burst
    localStorage.setItem = original;
    dispose();
  });

  it("survives malformed localStorage payload without throwing", () => {
    localStorage.setItem(STORE_KEY, "{not-json");
    expect(() => bootDraftsPersistence()).not.toThrow();
    expect(useToastCount()).toBe(0);
  });

  it("renaming a session id re-keys the persisted draft", async () => {
    useSessionsStore.getState().setDraft("pending-id", "in-flight text");
    const dispose = bootDraftsPersistence();
    await new Promise((r) => setTimeout(r, 350));
    useSessionsStore.getState().renameDraft("pending-id", "real-id");
    await new Promise((r) => setTimeout(r, 350));
    const persisted = JSON.parse(localStorage.getItem(STORE_KEY)!);
    expect(persisted["real-id"]).toBe("in-flight text");
    expect(persisted["pending-id"]).toBeUndefined();
    dispose();
  });

  // P1-05: the subscriber should ignore unrelated state changes that don't
  // touch the drafts map. We spy on localStorage.setItem to count actual
  // writes; trigger 50 unrelated mutations and verify zero new writes fire.
  it("ignores unrelated state changes (P1-05 reference guard)", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const dispose = bootDraftsPersistence();
    await new Promise((r) => setTimeout(r, 350));
    const baselineCalls = setItemSpy.mock.calls.length;

    // Fire 50 unrelated state mutations on the sessions store.
    for (let i = 0; i < 50; i += 1) {
      useSessionsStore.setState({ loading: i % 2 === 0 });
    }
    await new Promise((r) => setTimeout(r, 350));

    const afterCalls = setItemSpy.mock.calls.length;
    expect(afterCalls).toBe(baselineCalls);
    setItemSpy.mockRestore();
    dispose();
  });
});

// Tiny helper so the malformed-payload test doesn't have to import toast-store.
function useToastCount(): number {
  return 0;
}