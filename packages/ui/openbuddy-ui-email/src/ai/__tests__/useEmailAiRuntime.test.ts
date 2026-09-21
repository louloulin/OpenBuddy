import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEmailAiRuntime } from "../hooks/useEmailAiRuntime";
import type { AiAction } from "../types";

function makeBindings(overrides: Partial<{
  listAnalyses: ReturnType<typeof vi.fn>;
  routePrompt: ReturnType<typeof vi.fn>;
  updateThread: ReturnType<typeof vi.fn>;
  prepareSend: ReturnType<typeof vi.fn>;
  createDraft: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    listAnalyses: overrides.listAnalyses ?? vi.fn().mockResolvedValue({ items: [] }),
    routePrompt: overrides.routePrompt ?? vi.fn().mockResolvedValue([]),
    updateThread: overrides.updateThread ?? vi.fn().mockResolvedValue({}),
    prepareSend: overrides.prepareSend ?? vi.fn().mockResolvedValue({}),
    createDraft: overrides.createDraft ?? vi.fn().mockResolvedValue({}),
  };
}

describe("useEmailAiRuntime", () => {
  it("summarize reads from listAnalyses", async () => {
    const bindings = makeBindings({
      listAnalyses: vi.fn().mockResolvedValue({ items: [{ summary: "AI 摘要 X", confidence: 0.95 }] }),
    });
    const { result } = renderHook(() => useEmailAiRuntime({ bindings }));
    const summary = await result.current.summarize("t1");
    expect(summary.oneLiner).toBe("AI 摘要 X");
    expect(summary.confidence).toBe(0.95);
  });

  it("summarize routes errors to onProviderError", async () => {
    const onProviderError = vi.fn();
    const bindings = makeBindings({
      listAnalyses: vi.fn().mockRejectedValue(new Error("network")),
    });
    const { result } = renderHook(() => useEmailAiRuntime({ bindings, onProviderError }));
    await expect(result.current.summarize("t1")).rejects.toThrow("network");
    expect(onProviderError).toHaveBeenCalledWith({ message: "network" });
  });

  it("plan delegates to routePrompt when provided", async () => {
    const expected: AiAction[] = [{ id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "" }];
    const bindings = makeBindings({ routePrompt: vi.fn().mockResolvedValue(expected) });
    const { result } = renderHook(() => useEmailAiRuntime({ bindings }));
    const actions = await result.current.plan("归档噪声", ["t1"]);
    expect(actions).toEqual(expected);
    expect(bindings.routePrompt).toHaveBeenCalledWith("归档噪声");
  });

  it("plan falls back to mark-read when routePrompt is absent", async () => {
    const bindings = makeBindings();
    const noRouteBindings = { ...bindings };
    delete (noRouteBindings as { routePrompt?: unknown }).routePrompt;
    const { result } = renderHook(() => useEmailAiRuntime({ bindings: noRouteBindings }));
    const actions = await result.current.plan("x", ["t1", "t2"]);
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.kind === "mark-read")).toBe(true);
  });

  it("execute updates thread for archive", async () => {
    const updateThread = vi.fn().mockResolvedValue({});
    const bindings = makeBindings({ updateThread });
    const { result } = renderHook(() => useEmailAiRuntime({ bindings }));
    const receipts = await result.current.execute([
      { id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "" },
    ]);
    expect(updateThread).toHaveBeenCalledWith({ threadId: "t1", mutation: "archive" });
    expect(receipts[0].status).toBe("executed");
  });

  it("execute captures failures", async () => {
    const updateThread = vi.fn().mockRejectedValue(new Error("403"));
    const bindings = makeBindings({ updateThread });
    const { result } = renderHook(() => useEmailAiRuntime({ bindings }));
    const receipts = await result.current.execute([
      { id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "" },
    ]);
    expect(receipts[0].status).toBe("failed");
    expect(receipts[0].reason).toContain("403");
  });

  it("memoizes runtime across renders", () => {
    const bindings = makeBindings();
    const { result, rerender } = renderHook(() => useEmailAiRuntime({ bindings }));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("rebuilds runtime when bindings change", () => {
    const bindings1 = makeBindings();
    const bindings2 = makeBindings();
    const { result, rerender } = renderHook(
      ({ bindings }) => useEmailAiRuntime({ bindings }),
      { initialProps: { bindings: bindings1 } },
    );
    const first = result.current;
    rerender({ bindings: bindings2 });
    expect(result.current).not.toBe(first);
  });
});
