/**
 * DraftEditor —— R70 「📝 新草稿」入口的最小可用性测试。
 *
 * 验证:
 *   1) open=false 时不渲染任何东西(Modal 不挂);
 *   2) open=true 时挂 TiptapEditor(ProseMirror DOM);
 *   3) 「应用到会话」按钮点击触发 onApply(markdown 字符串);
 *   4) 「复制 markdown」按钮点击触发 onCopy(markdown 字符串)。
 *
 * 不依赖 SlotProvider —— 本组件的可独立挂载性是它的卖点;slot 集成在
 * `editor-slot-wiring.test.tsx` 与 builtin-applies-registration.test.ts
 * 已经覆盖。
 */
import "@testing-library/jest-dom/vitest";
import "../test-shims/prosemirror-jsdom";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DraftEditor } from "../components/DraftEditor";

describe("DraftEditor", () => {
  it("open=false 时不挂任何东西", () => {
    const { container } = render(
      <DraftEditor open={false} onApply={vi.fn()} />
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(screen.queryByTestId("draft-editor-body")).toBeNull();
  });

  it("open=true 时挂出 Modal + TiptapEditor", () => {
    render(<DraftEditor open onApply={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("draft-editor-body")).toBeInTheDocument();
    // ProseMirror 自己的 contenteditable
    expect(document.querySelector(".ProseMirror")).toBeTruthy();
  });

  it("「应用到会话」点击触发 onApply(markdown)", () => {
    const onApply = vi.fn();
    render(<DraftEditor open onApply={onApply} />);
    // Modal 默认就显示 footer 按钮
    fireEvent.click(screen.getByTestId("draft-editor-apply"));
    // 空内容 → 仍触发一次,内容是空 markdown 字符串
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(typeof onApply.mock.calls[0]?.[0]).toBe("string");
  });

  it("未传 onCopy 时不渲染「复制 markdown」按钮(契约对齐)", () => {
    render(<DraftEditor open onApply={vi.fn()} />);
    expect(screen.queryByTestId("draft-editor-copy")).toBeNull();
  });

  it("传了 onCopy 时,点击触发 onCopy(markdown)", () => {
    const onCopy = vi.fn();
    render(<DraftEditor open onApply={vi.fn()} onCopy={onCopy} />);
    fireEvent.click(screen.getByTestId("draft-editor-copy"));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(typeof onCopy.mock.calls[0]?.[0]).toBe("string");
  });

  it("点「取消」调 onClose", () => {
    const onClose = vi.fn();
    render(<DraftEditor open onClose={onClose} onApply={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByTestId("draft-editor-cancel"));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
