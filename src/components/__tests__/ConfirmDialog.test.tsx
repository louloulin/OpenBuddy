import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmDialog } from "@openbuddy/ui-dialogs";

describe("ConfirmDialog", () => {
  it("open=false 时不渲染", () => {
    const { container } = render(
      <ConfirmDialog open={false} title="?" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("渲染 title / description / 默认按钮", () => {
    render(
      <ConfirmDialog
        open
        title="确认发送邮件?"
        description="将发送给 you@example.com"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: "确认发送邮件?" })).toBeInTheDocument();
    expect(screen.getByText("将发送给 you@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("点击确定 / 取消分别触发回调", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="t" onConfirm={onConfirm} onCancel={onCancel} confirmLabel="走你" cancelLabel="算了" />);
    fireEvent.click(screen.getByRole("button", { name: "走你" }));
    fireEvent.click(screen.getByRole("button", { name: "算了" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("danger tone 把确认按钮渲染为 btn--danger", () => {
    render(<ConfirmDialog open title="t" tone="danger" confirmLabel="删除" onConfirm={() => {}} onCancel={() => {}} />);
    const btn = screen.getByRole("button", { name: "删除" });
    expect(btn.className).toContain("btn--danger");
  });

  it("Escape / Enter 快捷键", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="t" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
