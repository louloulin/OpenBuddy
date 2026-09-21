import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAiLoop } from "../hooks/useAiLoop";
import type { AiAction, AiActionReceipt } from "../types";

function makeAction(partial: Partial<AiAction> = {}): AiAction {
  return {
    id: partial.id ?? "a1",
    kind: partial.kind ?? "archive",
    threadId: partial.threadId ?? "t1",
    confidence: partial.confidence ?? 0.9,
    reason: partial.reason ?? "因为…",
    ...partial,
  };
}

describe("useAiLoop", () => {
  it("proposes actions and seeds decisions from confidence", async () => {
    const planner = vi.fn().mockResolvedValue([
      makeAction({ id: "high", confidence: 0.9 }),
      makeAction({ id: "low", confidence: 0.4 }),
    ]);
    const executor = vi.fn<(accepted: AiAction[]) => Promise<AiActionReceipt[]>>().mockResolvedValue([]);
    const { result } = renderHook(() => useAiLoop({ planner, executor }));

    await act(async () => {
      await result.current.propose("归档噪声", ["t1", "t2"]);
    });

    await waitFor(() => {
      expect(result.current.planning.status).toBe("ready");
    });
    expect(result.current.decisions.high).toBe("accepted");
    expect(result.current.decisions.low).toBe("pending");
    expect(result.current.plan?.prompt).toBe("归档噪声");
  });

  it("acceptPlan only invokes executor for non-rejected actions", async () => {
    const planner = vi.fn().mockResolvedValue([
      makeAction({ id: "keep", confidence: 0.9 }),
      makeAction({ id: "drop", confidence: 0.9 }),
    ]);
    const executor = vi.fn<(accepted: AiAction[]) => Promise<AiActionReceipt[]>>().mockResolvedValue([
      { actionId: "keep", threadId: "t1", kind: "archive", status: "executed" },
    ]);
    const undoer = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAiLoop({ planner, executor, undoer }));

    await act(async () => {
      await result.current.propose("x", ["t1"]);
    });
    act(() => {
      result.current.setDecision("drop", "rejected");
    });
    await act(async () => {
      await result.current.acceptPlan();
    });

    expect(executor).toHaveBeenCalledTimes(1);
    const acceptedArg = executor.mock.calls[0][0];
    expect(acceptedArg).toHaveLength(1);
    expect(acceptedArg[0].id).toBe("keep");
    expect(result.current.undoEntry).not.toBeNull();
  });

  it("triggerUndo respects undo window", async () => {
    vi.useFakeTimers();
    const undoer = vi.fn().mockResolvedValue(undefined);
    const planner = vi.fn().mockResolvedValue([makeAction({ id: "a", confidence: 0.9 })]);
    const executor = vi.fn<(accepted: AiAction[]) => Promise<AiActionReceipt[]>>().mockResolvedValue([
      { actionId: "a", threadId: "t1", kind: "archive", status: "executed" },
    ]);
    const { result } = renderHook(() =>
      useAiLoop({ planner, executor, undoer, undoWindowMs: 1000 }),
    );

    await act(async () => {
      await result.current.propose("x", ["t1"]);
    });
    await act(async () => {
      await result.current.acceptPlan();
    });
    expect(result.current.undoEntry).not.toBeNull();

    vi.advanceTimersByTime(2000);
    await act(async () => {
      await result.current.triggerUndo();
    });
    expect(undoer).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("captures planner errors in planning phase", async () => {
    const planner = vi.fn().mockRejectedValue(new Error("AI 离线"));
    const executor = vi.fn();
    const { result } = renderHook(() => useAiLoop({ planner, executor }));

    await act(async () => {
      await result.current.propose("x", ["t1"]);
    });
    expect(result.current.planning.status).toBe("error");
    if (result.current.planning.status === "error") {
      expect(result.current.planning.error).toContain("AI 离线");
    }
  });

  it("bulkDecide flips all decisions", async () => {
    const planner = vi.fn().mockResolvedValue([
      makeAction({ id: "a", confidence: 0.9 }),
      makeAction({ id: "b", confidence: 0.9 }),
    ]);
    const executor = vi.fn();
    const { result } = renderHook(() => useAiLoop({ planner, executor }));
    await act(async () => {
      await result.current.propose("x", ["t1"]);
    });
    act(() => {
      result.current.bulkDecide("rejected");
    });
    expect(result.current.decisions.a).toBe("rejected");
    expect(result.current.decisions.b).toBe("rejected");
  });
});
