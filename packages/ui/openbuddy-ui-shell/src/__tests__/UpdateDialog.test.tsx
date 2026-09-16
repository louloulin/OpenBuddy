import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UpdateDialog, type UpdateDialogProps } from "../UpdateDialog";

const NOTES = [
  { version: "0.16.0", date: "2026-09-16", items: ["新增 TipTap 编辑器", "修复主题闪烁"] },
];

function makeProps(over: Partial<UpdateDialogProps> = {}): UpdateDialogProps {
  return {
    open: true,
    currentVersion: "0.15.0",
    nextVersion: "0.16.0",
    notes: NOTES,
    state: "idle",
    onLater: vi.fn(),
    onInstall: vi.fn(),
    onRestart: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

describe("UpdateDialog", () => {
  it("open=false 时不渲染任何东西", () => {
    render(<UpdateDialog {...makeProps({ open: false })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("渲染版本切换、release notes 与模态语义", () => {
    render(<UpdateDialog {...makeProps()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("v0.15.0")).toBeInTheDocument();
    // v0.16.0 同时出现在版本行与 notes 标题里。
    expect(screen.getAllByText("v0.16.0").length).toBeGreaterThan(0);
    expect(screen.getByText("新增 TipTap 编辑器")).toBeInTheDocument();
    expect(screen.getByText("2026-09-16")).toBeInTheDocument();
    // portal 到 body,不是原地渲染。
    expect(dialog.closest("[data-testid='update-dialog-overlay']")).not.toBeNull();
  });

  it("idle 状态主按钮触发 onInstall,次按钮触发 onLater", () => {
    const props = makeProps();
    render(<UpdateDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "下载更新" }));
    expect(props.onInstall).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "稍后提醒" }));
    expect(props.onLater).toHaveBeenCalledTimes(1);
  });

  it("downloading 状态显示进度且主按钮禁用", () => {
    render(<UpdateDialog {...makeProps({ state: "downloading", progress: 0.62 })} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("62");
    expect(screen.getByRole("button", { name: /下载中/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("progress 越界会被钳制", () => {
    render(<UpdateDialog {...makeProps({ state: "downloading", progress: 4 })} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("ready 状态主按钮触发 onRestart", () => {
    const props = makeProps({ state: "ready" });
    render(<UpdateDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "重启并安装" }));
    expect(props.onRestart).toHaveBeenCalledTimes(1);
  });

  it("error 状态暴露 role=alert 并可重试", () => {
    const props = makeProps({ state: "error", error: "校验失败" });
    render(<UpdateDialog {...props} />);
    expect(screen.getByRole("alert")).toHaveTextContent("校验失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(props.onInstall).toHaveBeenCalledTimes(1);
    // 标题栏 ✕ 是唯一的 "关闭" 按钮(次按钮是"稍后提醒")。
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc 关闭", () => {
    const props = makeProps();
    render(<UpdateDialog {...props} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("打开时把焦点移入面板,Tab 在首尾之间循环", () => {
    render(<UpdateDialog {...makeProps()} />);
    const close = screen.getByRole("button", { name: "关闭" });
    expect(document.activeElement).toBe(close);

    const last = screen.getByRole("button", { name: "下载更新" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("点击遮罩关闭,点击面板内部不关闭", () => {
    const props = makeProps();
    render(<UpdateDialog {...props} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("update-dialog-overlay"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("没有 notes 时给出空态文案", () => {
    render(<UpdateDialog {...makeProps({ notes: [] })} />);
    expect(screen.getByText("本次更新没有附带的更新说明。")).toBeInTheDocument();
  });
});
