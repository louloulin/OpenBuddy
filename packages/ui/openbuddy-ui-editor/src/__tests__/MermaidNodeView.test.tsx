/**
 * MermaidNodeView 单测 —— 三种状态(渲染中 / 成功 / 失败)与错误降级。
 * mermaid 本体通过 mock loader 替换,避免测试里加载 1MB+ 的图表库。
 */
import "@testing-library/jest-dom/vitest";
import "../test-shims/prosemirror-jsdom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type React from "react";

const renderMock = vi.fn();
vi.mock("../lib/mermaid-loader", () => ({
  loadMermaid: () => Promise.resolve({ render: renderMock }),
  resetMermaidLoader: () => {},
}));

const { MermaidNodeView } = await import("../components/MermaidNodeView");

type MermaidNodeViewProps = React.ComponentProps<typeof MermaidNodeView>;

/**
 * NodeViewProps 字段多且互相关联,测试只需其中几项;这里集中做一次
 * 窄化转换,避免每个用例都写 `as never`。
 */
function props(overrides: Record<string, unknown> = {}): MermaidNodeViewProps {
  return {
    node: { attrs: { code: "graph TD\nA-->B" } },
    updateAttributes: vi.fn(),
    deleteNode: vi.fn(),
    selected: false,
    editor: {},
    getPos: () => 0,
    extension: {},
    decorations: [],
    innerDecorations: [],
    view: {},
    HTMLAttributes: {},
    ...overrides,
  } as unknown as MermaidNodeViewProps;
}

describe("MermaidNodeView", () => {
  beforeEach(() => {
    renderMock.mockReset();
  });

  it("渲染成功时插入 SVG", async () => {
    renderMock.mockResolvedValue({ svg: '<svg data-testid="chart"></svg>' });
    render(<MermaidNodeView {...props()} />);
    await waitFor(() => {
      expect(screen.getByTestId("chart")).toBeInTheDocument();
    });
    expect(renderMock).toHaveBeenCalledWith(expect.stringContaining("ob-mermaid-"), "graph TD\nA-->B");
  });

  it("渲染失败时降级为错误提示 + 源码,不白屏", async () => {
    renderMock.mockRejectedValue(new Error("Parse error"));
    render(<MermaidNodeView {...props()} />);
    await waitFor(() => {
      expect(screen.getByText("图表无法渲染")).toBeInTheDocument();
    });
    expect(screen.getByText("Parse error")).toBeInTheDocument();
    expect(screen.getByText(/graph TD/)).toBeInTheDocument();
  });

  it("源码为空时直接给错误态,不调 mermaid", async () => {
    render(<MermaidNodeView {...props({ node: { attrs: { code: "" } } })} />);
    await waitFor(() => {
      expect(screen.getByText("图表源码为空")).toBeInTheDocument();
    });
    expect(renderMock).not.toHaveBeenCalled();
  });

  it("编辑源码后写回属性", async () => {
    renderMock.mockResolvedValue({ svg: "<svg></svg>" });
    const updateAttributes = vi.fn();
    render(<MermaidNodeView {...props({ updateAttributes })} />);
    fireEvent.click(screen.getByText("编辑源码"));
    const textarea = screen.getByLabelText("Mermaid 源码");
    fireEvent.change(textarea, { target: { value: "graph LR\nX-->Y" } });
    fireEvent.blur(textarea);
    expect(updateAttributes).toHaveBeenCalledWith({ code: "graph LR\nX-->Y" });
  });

  it("Esc 取消编辑不写回", async () => {
    renderMock.mockResolvedValue({ svg: "<svg></svg>" });
    const updateAttributes = vi.fn();
    render(<MermaidNodeView {...props({ updateAttributes })} />);
    fireEvent.click(screen.getByText("编辑源码"));
    const textarea = screen.getByLabelText("Mermaid 源码");
    fireEvent.change(textarea, { target: { value: "changed" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it("删除按钮调用 deleteNode", async () => {
    renderMock.mockResolvedValue({ svg: "<svg></svg>" });
    const deleteNode = vi.fn();
    render(<MermaidNodeView {...props({ deleteNode })} />);
    fireEvent.click(screen.getByText("删除"));
    expect(deleteNode).toHaveBeenCalled();
  });
});
