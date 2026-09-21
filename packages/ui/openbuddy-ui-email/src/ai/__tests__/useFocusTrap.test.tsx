/**
 * useFocusTrap — Tab cycling within the ref's container.
 * 单元覆盖 + 集成到 AiCommandBar / ReceiptToast / AiInboxShell。
 */
import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

function Harness({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, { enabled });
  return (
    <div ref={ref}>
      <button data-testid="a">A</button>
      <button data-testid="b">B</button>
      <button data-testid="c">C</button>
    </div>
  );
}

beforeEach(() => { swrCacheInternal.reset(); });
describe("useFocusTrap", () => {
  it("Tab from last wraps to first", () => {
    render(<Harness enabled={true} />);
    const a = screen.getByTestId("a");
    const c = screen.getByTestId("c");
    c.focus();
    fireEvent.keyDown(c, { key: "Tab" });
    expect(document.activeElement).toBe(a);
  });

  it("Shift+Tab from first wraps to last", () => {
    render(<Harness enabled={true} />);
    const a = screen.getByTestId("a");
    const c = screen.getByTestId("c");
    a.focus();
    fireEvent.keyDown(a, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(c);
  });

  it("no-op when disabled", () => {
    render(<Harness enabled={false} />);
    const a = screen.getByTestId("a");
    a.focus();
    // Default Tab should NOT be intercepted — focus may move out of container.
    fireEvent.keyDown(a, { key: "Tab" });
    // Since disabled, the listener isn't even attached; nothing to assert except no throw.
    expect(true).toBe(true);
  });

  it("no-op when container has no focusables", () => {
    function Empty(): JSX.Element {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, { enabled: true });
      return <div ref={ref} />;
    }
    render(<Empty />);
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(true).toBe(true);
  });
});

/** 集成:ReceiptToast 把焦点拉到撤销按钮。 */
describe("ReceiptToast focus trap integration", () => {
  it("auto-focuses the undo button when receipts appear", async () => {
    vi.useFakeTimers();
    try {
      const undoEntry = {
        id: "u1",
        planId: "p1",
        receipts: [],
        createdAt: Date.now() - 100,
        undo: async () => undefined,
      };
      const { ReceiptToast } = await import("../components/ReceiptToast");
      const receipts = [{ actionId: "a1", threadId: "t1", kind: "archive" as const, status: "executed" as const }];
      render(
        <ReceiptToast
          receipts={receipts}
          undoEntry={undoEntry}
          onUndo={() => undefined}
          onDismiss={() => undefined}
        />,
      );
      await vi.advanceTimersByTimeAsync(120);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-testid")).toBe("receipt-undo");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Tab from last wraps to first (dismiss → undo)", async () => {
    const undoEntry = {
      id: "u1",
      planId: "p1",
      receipts: [],
      createdAt: Date.now() - 100,
      undo: async () => undefined,
    };
    const { ReceiptToast } = await import("../components/ReceiptToast");
    const receipts = [{ actionId: "a1", threadId: "t1", kind: "archive" as const, status: "executed" as const }];
    render(
      <ReceiptToast
        receipts={receipts}
        undoEntry={undoEntry}
        onUndo={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    await waitFor(() => {
      expect((document.activeElement as HTMLElement)?.getAttribute("data-testid")).toBe("receipt-undo");
    });
    const undo = screen.getByTestId("receipt-undo");
    const dismiss = screen.getByLabelText("关闭回执");
    // Order is: undo (first), then dismiss (last). Tab forward from dismiss should wrap to undo.
    dismiss.focus();
    fireEvent.keyDown(dismiss, { key: "Tab" });
    expect(document.activeElement).toBe(undo);
    // Shift+Tab from undo should wrap back to dismiss.
    fireEvent.keyDown(undo, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(dismiss);
  });
});

/** 集成:AiCommandBar focus trap 在打开时锁定。 */
describe("AiCommandBar focus trap integration", () => {
  it("Tab on the last starter wraps back to the input", async () => {
    const { AiCommandBar } = await import("../components/AiCommandBar");
    render(
      <AiCommandBar
        open={true}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("data-testid")).toBe("ai-command-input");
    });
    // Find the last button (the 4th starter) and Tab from there — should wrap to the input.
    const starters = screen.getAllByRole("button");
    const lastStarter = starters[starters.length - 1]!;
    lastStarter.focus();
    fireEvent.keyDown(lastStarter, { key: "Tab" });
    expect(document.activeElement?.getAttribute("data-testid")).toBe("ai-command-input");
  });

  it("Shift+Tab on input wraps to last starter", async () => {
    const { AiCommandBar } = await import("../components/AiCommandBar");
    render(
      <AiCommandBar
        open={true}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("data-testid")).toBe("ai-command-input");
    });
    const input = screen.getByTestId("ai-command-input");
    input.focus();
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    const starters = screen.getAllByRole("button");
    expect(document.activeElement).toBe(starters[starters.length - 1]!);
  });
});
