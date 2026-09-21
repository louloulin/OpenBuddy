import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReceiptToast } from "../components/ReceiptToast";
import type { AiActionReceipt, UndoEntry } from "../types";

const receipts: AiActionReceipt[] = [
  { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" },
  { actionId: "a2", threadId: "t2", kind: "snooze", status: "executed" },
];

const undoEntry: UndoEntry = {
  id: "u1",
  planId: "p1",
  receipts,
  createdAt: Date.now(),
  undo: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => { swrCacheInternal.reset(); });
describe("ReceiptToast", () => {
  it("renders success title when all executed", () => {
    render(
      <ReceiptToast
        receipts={receipts}
        undoEntry={null}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("已执行 2 项")).toBeTruthy();
  });

  it("renders warning when partial failures", () => {
    render(
      <ReceiptToast
        receipts={[
          ...receipts,
          { actionId: "a3", threadId: "t3", kind: "label", status: "failed", reason: "权限不足" },
        ]}
        undoEntry={null}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("已执行 2 项 · 失败 1")).toBeTruthy();
  });

  it("renders error when all failed", () => {
    render(
      <ReceiptToast
        receipts={[
          { actionId: "a1", threadId: "t1", kind: "archive", status: "failed", reason: "x" },
        ]}
        undoEntry={null}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("失败 1 项")).toBeTruthy();
  });

  it("renders undo button with countdown", () => {
    render(
      <ReceiptToast
        receipts={receipts}
        undoEntry={undoEntry}
        undoWindowMs={30_000}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /撤销/ })).toBeTruthy();
  });

  it("calls onUndo when undo clicked", () => {
    const onUndo = vi.fn();
    render(
      <ReceiptToast
        receipts={receipts}
        undoEntry={undoEntry}
        onUndo={onUndo}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /撤销/ }));
    expect(onUndo).toHaveBeenCalled();
  });

  it("calls onDismiss when X clicked", () => {
    const onDismiss = vi.fn();
    render(
      <ReceiptToast
        receipts={receipts}
        undoEntry={null}
        onUndo={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭回执" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("renders nothing when receipts empty", () => {
    const { container } = render(
      <ReceiptToast
        receipts={[]}
        undoEntry={null}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("auto hides after window", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ReceiptToast
        receipts={receipts}
        undoEntry={null}
        onUndo={vi.fn()}
        onDismiss={onDismiss}
        autoHideMs={1000}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(onDismiss).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
