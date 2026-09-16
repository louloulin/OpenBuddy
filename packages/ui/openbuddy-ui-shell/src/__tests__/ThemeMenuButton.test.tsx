import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@openbuddy/ui-theme/client";
import { ThemeMenuButton } from "../ThemeMenuButton";

function renderWithProvider(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("ThemeMenuButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme-name");
  });

  it("图标按钮点击后打开主题弹层", () => {
    renderWithProvider(<ThemeMenuButton />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "切换主题" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // 17 套主题里的浅色/深色分组都渲染出来。
    expect(screen.getByText("Aurora")).toBeInTheDocument();
    expect(screen.getByText("Sakura")).toBeInTheDocument();
  });

  it("Esc 关闭弹层(ThemePicker 自带行为)", () => {
    renderWithProvider(<ThemeMenuButton />);
    fireEvent.click(screen.getByRole("button", { name: "切换主题" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("外部点击关闭弹层", () => {
    renderWithProvider(<ThemeMenuButton />);
    fireEvent.click(screen.getByRole("button", { name: "切换主题" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("选中主题会落盘并写 data-theme-name", () => {
    renderWithProvider(<ThemeMenuButton />);
    fireEvent.click(screen.getByRole("button", { name: "切换主题" }));
    fireEvent.click(screen.getByText("Sakura"));
    expect(window.localStorage.getItem("openbuddy.theme.name")).toBe("sakura");
    expect(document.documentElement.getAttribute("data-theme-name")).toBe("sakura");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("onOpenChange 透出开合状态", () => {
    const onOpenChange = vi.fn();
    renderWithProvider(<ThemeMenuButton onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "切换主题" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("宿主没有 ThemeProvider 时降级成禁用按钮而不是崩溃", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<ThemeMenuButton />);
      expect(screen.getByTestId("theme-menu-fallback")).toBeDisabled();
    } finally {
      spy.mockRestore();
    }
  });

  it("自定义 label 传递到触发器", () => {
    renderWithProvider(<ThemeMenuButton label="外观" />);
    expect(screen.getByRole("button", { name: "外观" })).toBeInTheDocument();
  });
});
