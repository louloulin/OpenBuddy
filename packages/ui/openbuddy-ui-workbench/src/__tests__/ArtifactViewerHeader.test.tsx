/**
 * ArtifactViewerHeader —— 面包屑 + 状态徽标 + 工具栏组合 单测。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ArtifactViewerHeader } from "../ArtifactViewerHeader";

afterEach(() => cleanup());

const segments = [{ label: "项目" }, { label: "docs" }, { label: "plan.md" }];

describe("ArtifactViewerHeader", () => {
  it("最简用法：只渲染面包屑", () => {
    render(<ArtifactViewerHeader segments={segments} />);
    expect(screen.getByRole("navigation", { name: "面包屑" })).toBeTruthy();
    expect(screen.getByText("plan.md")).toBeTruthy();
    // 没有 toolbar 时不渲染 toolbar 角色
    expect(screen.queryByRole("toolbar")).toBeNull();
    // 未传 status 时不渲染徽标
    expect(screen.queryByText("已同步")).toBeNull();
  });

  it("渲染状态徽标（含默认 neutral 色调）", () => {
    const { container } = render(
      <ArtifactViewerHeader segments={segments} status={{ label: "已同步" }} />,
    );
    const chip = screen.getByText("已同步");
    expect(chip.getAttribute("data-tip")).toBe("已同步");
    expect(container.querySelector('[data-status-tone="neutral"]')).toBeTruthy();
  });

  it("状态徽标可指定 tone 与 title", () => {
    const { container } = render(
      <ArtifactViewerHeader
        segments={segments}
        status={{ label: "解析中", tone: "warning", title: "正在解析文档" }}
      />,
    );
    const chip = screen.getByText("解析中");
    expect(chip.getAttribute("title")).toBe("正在解析文档");
    expect(chip.getAttribute("data-tip")).toBe("正在解析文档");
    expect(container.querySelector('[data-status-tone="warning"]')).toBeTruthy();
  });

  it("渲染次级文案 meta", () => {
    render(<ArtifactViewerHeader segments={segments} meta="12 KB · 3 分钟前" />);
    expect(screen.getByText("12 KB · 3 分钟前")).toBeTruthy();
  });

  it("透传 toolbar props 到 ViewerToolbar", () => {
    const onDownload = vi.fn();
    render(
      <ArtifactViewerHeader
        segments={segments}
        toolbar={{ onDownload, zoom: 1.5, onResetZoom: () => {} }}
      />,
    );
    expect(screen.getByRole("toolbar", { name: "查看器工具" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "缩放级别 150%" })).toBeTruthy();
  });

  it("未提供 toolbar 时不会出现任何查看器按钮", () => {
    render(<ArtifactViewerHeader segments={segments} />);
    expect(screen.queryByRole("button", { name: "下载" })).toBeNull();
  });

  it("segments 为空时不崩溃（左侧留白）", () => {
    const { container } = render(<ArtifactViewerHeader segments={[]} meta="空" />);
    expect(container.querySelector("nav")).toBeNull();
    expect(screen.getByText("空")).toBeTruthy();
  });

  it("长路径沿用面包屑的折叠策略", () => {
    render(
      <ArtifactViewerHeader
        segments={["a", "b", "c", "d", "e", "f"].map((label) => ({ label }))}
      />,
    );
    expect(screen.getByRole("button", { name: /展开被折叠的 2 层路径/ })).toBeTruthy();
  });
});
