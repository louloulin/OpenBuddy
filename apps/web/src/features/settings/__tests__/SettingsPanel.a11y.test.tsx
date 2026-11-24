import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlidersHorizontal } from "lucide-react";
import { SettingsPanel } from "../SettingsPanel";

/**
 * 设置弹层的键盘可达性 (B4 follow-up): 焦点必须留在弹层内，关闭后归还给触发元素。
 */
describe("SettingsPanel · 分组与搜索", () => {
  it("按组渲染，并按关键词过滤", () => {
    const sections = [
      { id: "general", label: "通用", icon: SlidersHorizontal, render: () => null },
      { id: "model", label: "模型", icon: SlidersHorizontal, render: () => null },
      { id: "security", label: "安全中心", icon: SlidersHorizontal, render: () => null },
    ];
    render(<SettingsPanel open onClose={vi.fn()} sections={sections} />);
    expect(screen.getByText("数据与安全")).toBeInTheDocument();
    expect(screen.getByText("功能")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索设置" }), { target: { value: "安全" } });
    expect(screen.getByText("安全中心")).toBeInTheDocument();
    expect(screen.queryByText("通用")).toBeNull();
    expect(screen.queryByText("模型")).toBeNull();
  });

  it("没有匹配时显示空态", () => {
    render(<SettingsPanel open onClose={vi.fn()} sections={[{ id: "general", label: "通用", icon: SlidersHorizontal, render: () => null }]} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的设置")).toBeInTheDocument();
  });
});

describe("SettingsPanel · 焦点陷阱", () => {
  it("打开后焦点进入弹层，Tab 在弹层内循环，关闭后焦点还原", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <SettingsPanel
        open
        onClose={vi.fn()}
        sections={[{ id: "general", label: "通用", icon: SlidersHorizontal, render: () => <button type="button">面板按钮</button> }]}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "设置" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    const focusables = dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input, a[href]");
    expect(focusables.length).toBeGreaterThan(1);
    const tail = focusables[focusables.length - 1];
    tail.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("Esc 关闭并交还焦点", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();

    const { unmount } = render(
      <SettingsPanel
        open
        onClose={onClose}
        sections={[{ id: "general", label: "通用", icon: SlidersHorizontal, render: () => null }]}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
