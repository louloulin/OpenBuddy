/**
 * ArtifactBreadcrumb —— 中间省略折叠 / 点击展开 / 受控数据源 单测。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ArtifactBreadcrumb,
  buildBreadcrumbItems,
  type ArtifactBreadcrumbSegment,
} from "../ArtifactBreadcrumb";

afterEach(() => cleanup());

function segs(...labels: string[]): ArtifactBreadcrumbSegment[] {
  return labels.map((label) => ({ label }));
}

describe("buildBreadcrumbItems（纯函数）", () => {
  it("层级不超过上限时全部展示", () => {
    const items = buildBreadcrumbItems(segs("a", "b", "c"), 4);
    expect(items.map((i) => i.segment?.label)).toEqual(["a", "b", "c"]);
    expect(items.every((i) => i.kind === "segment")).toBe(true);
  });

  it("超出上限时折叠中间层：首段 + gap + 尾部", () => {
    const items = buildBreadcrumbItems(segs("a", "b", "c", "d", "e", "f"), 4);
    expect(items.map((i) => i.kind)).toEqual([
      "segment",
      "gap",
      "segment",
      "segment",
      "segment",
    ]);
    expect(items[0].segment?.label).toBe("a");
    expect(items[1].hiddenLabels).toEqual(["b", "c"]);
    expect(items.slice(2).map((i) => i.segment?.label)).toEqual(["d", "e", "f"]);
  });

  it("展开后 gap 保留在原位，中间层就地插入", () => {
    const items = buildBreadcrumbItems(segs("a", "b", "c", "d", "e", "f"), 4, true);
    expect(items.map((i) => i.kind)).toEqual([
      "segment",
      "gap",
      "segment",
      "segment",
      "segment",
      "segment",
      "segment",
    ]);
    expect(items[1].expanded).toBe(true);
    expect(items.map((i) => i.segment?.label).filter(Boolean)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });

  it("maxVisible < 2 时不做折叠（折叠本身无意义）", () => {
    const items = buildBreadcrumbItems(segs("a", "b", "c"), 1);
    expect(items.every((i) => i.kind === "segment")).toBe(true);
  });

  it("每段都标记 isLast 以驱动 aria-current", () => {
    const items = buildBreadcrumbItems(segs("a", "b"), 4);
    expect(items[0].isLast).toBe(false);
    expect(items[1].isLast).toBe(true);
  });
});

describe("ArtifactBreadcrumb", () => {
  it("空 segments 渲染 null", () => {
    const { container } = render(<ArtifactBreadcrumb segments={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("短路径全部可见，末段带 aria-current=page", () => {
    render(<ArtifactBreadcrumb segments={segs("项目", "docs", "plan.md")} />);
    expect(screen.getByText("项目")).toBeTruthy();
    expect(screen.getByText("docs")).toBeTruthy();
    // aria-current 在外层包裹元素上（内层 span 只承载文本,便于省略号截断）
    expect(screen.getByText("plan.md").closest('[aria-current="page"]')).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "面包屑" })).toBeTruthy();
  });

  it("长路径折叠中间层，被隐藏层级不出现在 DOM 里", () => {
    render(<ArtifactBreadcrumb segments={segs("a", "b", "c", "d", "e", "f")} />);
    expect(screen.queryByText("b")).toBeNull();
    expect(screen.queryByText("c")).toBeNull();
    expect(screen.getByText("d")).toBeTruthy();
    const gap = screen.getByRole("button", { name: /展开被折叠的 2 层路径/ });
    expect(gap.getAttribute("title")).toBe("b / c");
    expect(gap.getAttribute("data-tip")).toBe("b / c");
  });

  it("点击省略号就地展开，再点收回", () => {
    render(<ArtifactBreadcrumb segments={segs("a", "b", "c", "d", "e", "f")} />);
    const gap = screen.getByRole("button", { name: /展开被折叠的 2 层路径/ });
    fireEvent.click(gap);
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.getByText("c")).toBeTruthy();
    const collapse = screen.getByRole("button", { name: "收起路径" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);
    expect(screen.queryByText("b")).toBeNull();
  });

  it("maxVisible 可调：5 时只折叠 1 层", () => {
    render(<ArtifactBreadcrumb segments={segs("a", "b", "c", "d", "e", "f")} maxVisible={5} />);
    const gap = screen.getByRole("button", { name: /展开被折叠的 1 层路径/ });
    expect(gap).toBeTruthy();
    expect(screen.getByText("c")).toBeTruthy();
    expect(screen.queryByText("b")).toBeNull();
  });

  it("带 onClick 的层级渲染为按钮并触发回调；不带的是纯文本", () => {
    const onOpenDocs = vi.fn();
    render(
      <ArtifactBreadcrumb
        segments={[
          { label: "项目", onClick: onOpenDocs },
          { label: "docs" },
          { label: "plan.md" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "项目" }));
    expect(onOpenDocs).toHaveBeenCalledTimes(1);
    // 无 handler 的中间层不是按钮，避免假交互
    expect(screen.queryByRole("button", { name: "docs" })).toBeNull();
    // title 同样挂在包裹元素上
    expect(screen.getByText("docs").closest('[title="docs"]')).toBeTruthy();
  });

  it("segments 变化后回到折叠态", () => {
    const { rerender } = render(
      <ArtifactBreadcrumb segments={segs("a", "b", "c", "d", "e", "f")} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /展开被折叠/ }));
    expect(screen.getByText("b")).toBeTruthy();
    rerender(<ArtifactBreadcrumb segments={segs("x", "y", "z", "p", "q", "r")} />);
    expect(screen.queryByText("y")).toBeNull();
    expect(screen.getByText("x")).toBeTruthy();
  });

  it("支持自定义 aria-label 与图标", () => {
    render(
      <ArtifactBreadcrumb
        ariaLabel="文件路径"
        segments={[{ label: "项目", icon: <span data-testid="crumb-icon" /> }, { label: "plan.md" }]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "文件路径" })).toBeTruthy();
    expect(screen.getByTestId("crumb-icon")).toBeTruthy();
  });
});
