// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { minimize, toggleMaximize, close, resizedCleanup, editCommand } = vi.hoisted(() => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), resizedCleanup: vi.fn(), editCommand: vi.fn(() => Promise.resolve()) }));
vi.mock("@openbuddy/client/ipc", () => ({
  win: { minimize, toggleMaximize, close, isMaximized: () => Promise.resolve(false), onResized: () => resizedCleanup },
}));
vi.mock("@openbuddy/platform/clipboard", () => ({ editCommand }));

import { TitleBar } from "../TitleBar";

describe("TitleBar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("卸载时解绑窗口尺寸监听", () => {
    const { unmount } = render(<TitleBar onPlaceholder={() => {}} />);
    unmount();
    expect(resizedCleanup).toHaveBeenCalledOnce();
  });

  it("渲染品牌与三个菜单", () => {
    render(<TitleBar onPlaceholder={() => {}} />);
    expect(screen.getByText("OpenBuddy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "窗口" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "帮助" })).toBeInTheDocument();
  });

  it("编辑菜单展开后点击复制走主进程原生编辑命令并收起", () => {
    // Renderer clipboard permission is denied; edit items run webContents commands in main.
    const onPlaceholder = vi.fn();
    render(<TitleBar onPlaceholder={onPlaceholder} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByText("复制"));
    expect(editCommand).toHaveBeenCalledWith("copy");
    expect(onPlaceholder).not.toHaveBeenCalled();
    expect(screen.queryByText("粘贴")).not.toBeInTheDocument();
  });

  it("帮助菜单的'关于 OpenBuddy'调用 onShowAbout", () => {
    const onShowAbout = vi.fn();
    render(<TitleBar onPlaceholder={() => {}} onShowAbout={onShowAbout} />);
    fireEvent.click(screen.getByRole("button", { name: "帮助" }));
    fireEvent.click(screen.getByText("关于 OpenBuddy"));
    expect(onShowAbout).toHaveBeenCalled();
  });

  it("窗口菜单的最小化调用窗口 API", () => {
    render(<TitleBar onPlaceholder={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "窗口" }));
    fireEvent.click(screen.getByText("最小化"));
    expect(minimize).toHaveBeenCalled();
  });

  it("窗口菜单的关闭调用窗口 close", () => {
    render(<TitleBar onPlaceholder={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "窗口" }));
    fireEvent.click(screen.getByText("关闭"));
    expect(close).toHaveBeenCalled();
  });

  it("点击 backdrop 收起菜单", () => {
    render(<TitleBar onPlaceholder={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(document.querySelector(".titlebar__backdrop") as Element);
    expect(screen.queryByText("复制")).not.toBeInTheDocument();
  });
});
