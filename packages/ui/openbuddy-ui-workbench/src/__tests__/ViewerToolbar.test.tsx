/**
 * ViewerToolbar —— 「未传 handler 即 disabled」契约、缩放档位、更多菜单 单测。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewerToolbar } from "../ViewerToolbar";

afterEach(() => cleanup());

const DOC_ACTIONS = ["重新加载", "用默认应用打开", "复制内容", "下载"] as const;
const VIEW_ACTIONS = ["自动换行", "缩小", "放大", "适合宽度"] as const;
const LAYOUT_ACTIONS = ["分屏查看", "更多操作"] as const;

describe("ViewerToolbar", () => {
  it("未传任何 handler 时全部动作渲染为 disabled 按钮", () => {
    render(<ViewerToolbar />);
    for (const label of [...DOC_ACTIONS, ...VIEW_ACTIONS, ...LAYOUT_ACTIONS]) {
      expect(screen.getByRole("button", { name: label }).hasAttribute("disabled")).toBe(true);
    }
    expect(
      screen.getByRole("button", { name: "缩放级别 100%" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("每个按钮都有 aria-label / title / data-tip 三件套", () => {
    render(<ViewerToolbar onRefresh={() => {}} />);
    const refresh = screen.getByRole("button", { name: "重新加载" });
    expect(refresh.getAttribute("title")).toBe("重新加载");
    expect(refresh.getAttribute("data-tip")).toBe("重新加载");
  });

  it("传入 handler 后按钮可点并触发回调", () => {
    const onRefresh = vi.fn();
    const onOpenExternal = vi.fn();
    const onCopy = vi.fn();
    const onDownload = vi.fn();
    render(
      <ViewerToolbar
        onRefresh={onRefresh}
        onOpenExternal={onOpenExternal}
        onCopy={onCopy}
        onDownload={onDownload}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    fireEvent.click(screen.getByRole("button", { name: "用默认应用打开" }));
    fireEvent.click(screen.getByRole("button", { name: "复制内容" }));
    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onOpenExternal).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("role=toolbar 且带 aria-label", () => {
    render(<ViewerToolbar />);
    expect(screen.getByRole("toolbar", { name: "查看器工具" })).toBeTruthy();
  });

  it("缩放档位显示百分比，点击回调 onResetZoom", () => {
    const onResetZoom = vi.fn();
    render(<ViewerToolbar zoom={1.25} onResetZoom={onResetZoom} />);
    const level = screen.getByRole("button", { name: "缩放级别 125%" });
    expect(level.textContent).toBe("125%");
    fireEvent.click(level);
    expect(onResetZoom).toHaveBeenCalledTimes(1);
  });

  it("缩放达到 min/max 时对应按钮禁用", () => {
    const { rerender } = render(<ViewerToolbar zoom={0.25} onZoomIn={() => {}} onZoomOut={() => {}} />);
    expect(screen.getByRole("button", { name: "缩小" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "放大" }).hasAttribute("disabled")).toBe(false);
    rerender(<ViewerToolbar zoom={4} onZoomIn={() => {}} onZoomOut={() => {}} />);
    expect(screen.getByRole("button", { name: "放大" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "缩小" }).hasAttribute("disabled")).toBe(false);
  });

  it("自定义 min/max 生效", () => {
    render(<ViewerToolbar zoom={2} minZoom={2} maxZoom={2} onZoomIn={() => {}} onZoomOut={() => {}} />);
    expect(screen.getByRole("button", { name: "放大" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "缩小" }).hasAttribute("disabled")).toBe(true);
  });

  it("wordWrap / splitActive 反映到 aria-pressed", () => {
    const { rerender } = render(
      <ViewerToolbar wordWrap onToggleWordWrap={() => {}} onSplit={() => {}} splitActive />,
    );
    expect(screen.getByRole("button", { name: "自动换行" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "分屏查看" }).getAttribute("aria-pressed")).toBe("true");
    rerender(
      <ViewerToolbar wordWrap={false} onToggleWordWrap={() => {}} splitActive={false} onSplit={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "自动换行" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "分屏查看" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("refreshBusy 标记 aria-busy", () => {
    render(<ViewerToolbar refreshBusy onRefresh={() => {}} />);
    expect(screen.getByRole("button", { name: "重新加载" }).getAttribute("aria-busy")).toBe("true");
  });

  it("没有 moreItems 时「更多操作」直接调用 onMore", () => {
    const onMore = vi.fn();
    render(<ViewerToolbar onMore={onMore} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("有 moreItems 时展开菜单，点选后回调并关闭", () => {
    const onRename = vi.fn();
    render(
      <ViewerToolbar
        moreItems={[
          { id: "rename", label: "重命名", onSelect: onRename, shortcut: "F2" },
          { id: "delete", label: "删除", danger: true, separatorBefore: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    const menu = screen.getByRole("menu", { name: "更多操作" });
    expect(menu).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /删除/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: /重命名/ }));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc 关闭菜单", () => {
    render(<ViewerToolbar moreItems={[{ id: "a", label: "甲", onSelect: () => {} }]} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("点击外部关闭菜单", () => {
    render(
      <div>
        <ViewerToolbar moreItems={[{ id: "a", label: "甲", onSelect: () => {} }]} />
        <button type="button">外部</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("button", { name: "外部" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leading 内容渲染在工具栏最左侧", () => {
    render(<ViewerToolbar leading={<span data-testid="lead">返回</span>} />);
    expect(screen.getByTestId("lead")).toBeTruthy();
  });
});
