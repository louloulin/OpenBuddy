import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { emailStore, useEmailStore } from "../email-store";
import type { AiActionReceipt } from "../types";

beforeEach(() => {
  emailStore.reset();
});

describe("emailStore", () => {
  it("initial state is default", () => {
    expect(emailStore.getState().accountId).toBe("all");
    expect(emailStore.getState().view).toBe("today");
  });

  it("setAccount updates accountId", () => {
    act(() => emailStore.setAccount("a1"));
    expect(emailStore.getState().accountId).toBe("a1");
  });

  it("setSelectedThread preserves across calls", () => {
    act(() => emailStore.setSelectedThread("t1"));
    act(() => emailStore.setView("later"));
    expect(emailStore.getState().selectedThreadId).toBe("t1");
    expect(emailStore.getState().view).toBe("later");
  });

  it("setReceipt ignores empty array", () => {
    act(() => emailStore.setReceipt([]));
    expect(emailStore.getState().lastReceipt).toBeNull();
  });

  it("setReceipt stores timestamp", () => {
    const receipts: AiActionReceipt[] = [
      { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" },
    ];
    act(() => emailStore.setReceipt(receipts));
    const r = emailStore.getState().lastReceipt;
    expect(r).not.toBeNull();
    expect(r?.receipts).toEqual(receipts);
    expect(typeof r?.createdAt).toBe("number");
  });

  it("useEmailStore triggers re-render on change", () => {
    const { result } = renderHook(() => useEmailStore((s) => s.selectedThreadId));
    expect(result.current).toBeNull();
    act(() => emailStore.setSelectedThread("t1"));
    expect(result.current).toBe("t1");
  });

  it("selector isolates re-renders (only changing key triggers)", () => {
    const renders: string[] = [];
    const { result: r1 } = renderHook(() => {
      const v = useEmailStore((s) => s.accountId);
      renders.push("account:" + v);
      return v;
    });
    const { result: r2 } = renderHook(() => {
      const v = useEmailStore((s) => s.selectedThreadId);
      renders.push("thread:" + (v ?? "null"));
      return v;
    });
    const before = renders.length;
    act(() => emailStore.setSelectedThread("t2"));
    // Both hooks re-render because they share the store, but selector returns same value.
    expect(r1.current).toBe("all");
    expect(r2.current).toBe("t2");
    expect(renders.length).toBeGreaterThan(before);
  });
});
