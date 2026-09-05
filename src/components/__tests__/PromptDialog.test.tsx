import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PromptDialog } from "@openbuddy/ui-dialogs";

describe("PromptDialog", () => {
  it("open=false 时不渲染", () => {
    const { container } = render(
      <PromptDialog open={false} title="?" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("渲染 title / 默认按钮", () => {
    render(
      <PromptDialog open title="输入标签" placeholder="例如：重要客户" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole("dialog", { name: "输入标签" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例如：重要客户")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("点击确定 / 取消分别触发回调，并传递 value", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PromptDialog
        open
        title="t"
        defaultValue="hello"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onConfirm).toHaveBeenCalledWith("hello");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("danger tone 把确认按钮渲染为 btn--danger", () => {
    render(<PromptDialog open title="t" tone="danger" confirmLabel="删除" onConfirm={() => {}} onCancel={() => {}} />);
    const btn = screen.getByRole("button", { name: "删除" });
    expect(btn.className).toContain("btn--danger");
  });

  it("multiline 时渲染 textarea 而非 input", () => {
    render(<PromptDialog open title="t" multiline onConfirm={() => {}} onCancel={() => {}} />);
    const textarea = document.querySelector("textarea");
    expect(textarea).toBeInTheDocument();
  });

  it("Escape 取消、Enter 确认", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<PromptDialog open title="t" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("multiline 模式下 Cmd/Ctrl+Enter 确认", () => {
    const onConfirm = vi.fn();
    render(<PromptDialog open title="t" multiline onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("multiline 模式下 Enter 不直接触发确认（应该换行）", () => {
    const onConfirm = vi.fn();
    render(<PromptDialog open title="t" multiline onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("validation 失败时显示 error 并阻止确认", () => {
    const onConfirm = vi.fn();
    render(
      <PromptDialog
        open
        title="t"
        defaultValue="bad"
        validate={(v) => (v.length < 5 ? "至少 5 个字符" : null)}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("至少 5 个字符")).toBeInTheDocument();
  });

  it("点击遮罩取消", () => {
    const onCancel = vi.fn();
    const { container } = render(<PromptDialog open title="t" onConfirm={() => {}} onCancel={onCancel} />);
    const overlay = container.querySelector(".request-modal-overlay") as HTMLElement;
    fireEvent.mouseDown(overlay, { target: overlay });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
