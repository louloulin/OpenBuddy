/**
 * PptxPreview —— 加载态 / 成功态 / 失败降级 / destroy 释放四段式单测。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { PptxPreview } from "../PptxPreview";

const hoisted = vi.hoisted(() => {
  const preview = vi.fn(async (_file: ArrayBuffer) => undefined);
  const destroy = vi.fn();
  const init = vi.fn((_dom: HTMLElement, _options: Record<string, unknown>) => ({
    preview,
    destroy,
  }));
  const loadPptxPreview = vi.fn(async () => ({ init }));
  return { destroy, init, loadPptxPreview, preview };
});

vi.mock("../office-preview-loader", () => ({
  loadPptxPreview: hoisted.loadPptxPreview,
}));

const CONTENT = "data:application/octet-stream;base64,SGVsbG8=";

beforeEach(() => {
  hoisted.preview.mockClear();
  hoisted.preview.mockResolvedValue(undefined);
  hoisted.init.mockClear();
  hoisted.destroy.mockClear();
  hoisted.loadPptxPreview.mockClear();
  hoisted.loadPptxPreview.mockImplementation(async () => ({ init: hoisted.init }));
});

afterEach(() => cleanup());

describe("PptxPreview", () => {
  it("首帧渲染加载态与 PPTX 徽标", async () => {
    render(<PptxPreview filename="deck.pptx" content={CONTENT} fallback={<p>降级</p>} />);
    expect(screen.getByRole("status").textContent).toContain("演示文稿加载中");
    expect(screen.getByText("PPTX")).toBeTruthy();
    // 等异步渲染落定,避免测试结束后仍有未包裹的 state 更新
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("成功路径：以 16:9 逻辑尺寸初始化并把 ArrayBuffer 交给 preview", async () => {
    render(<PptxPreview filename="deck.pptx" content={CONTENT} fallback={<p>降级</p>} />);
    const stage = screen.getByTestId("office-preview-body");
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    expect(hoisted.init).toHaveBeenCalledTimes(1);
    const [dom, options] = hoisted.init.mock.calls[0];
    expect(dom).toBe(stage);
    // jsdom 里 clientWidth 为 0，回落到 960 逻辑宽度 + 540 高度
    expect(options).toMatchObject({ width: 960, height: 540, mode: "list" });

    expect(hoisted.preview).toHaveBeenCalledTimes(1);
    expect(hoisted.preview.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer);
    expect(screen.queryByText("降级")).toBeNull();
  });

  it("卸载时调用 destroy 释放 previewer", async () => {
    const { unmount } = render(
      <PptxPreview filename="deck.pptx" content={CONTENT} fallback={<p>降级</p>} />,
    );
    await waitFor(() => expect(hoisted.init).toHaveBeenCalled());
    unmount();
    expect(hoisted.destroy).toHaveBeenCalledTimes(1);
  });

  it("loader 拒绝时渲染 fallback", async () => {
    hoisted.loadPptxPreview.mockRejectedValueOnce(new Error("missing"));
    render(<PptxPreview filename="deck.pptx" content={CONTENT} fallback={<p>降级</p>} />);
    await waitFor(() => expect(screen.getByText("降级")).toBeTruthy());
    expect(screen.queryByTestId("office-preview-body")).toBeNull();
  });

  it("preview 抛错时渲染 fallback（永不白屏）", async () => {
    hoisted.preview.mockRejectedValueOnce(new Error("corrupt pptx"));
    render(<PptxPreview filename="deck.pptx" content={CONTENT} fallback={<p>降级</p>} />);
    await waitFor(() => expect(screen.getByText("降级")).toBeTruthy());
  });

  it("容器带 data-office-kind=pptx", async () => {
    const { container } = render(
      <PptxPreview filename="deck.pptx" content={CONTENT} fallback={<p>降级</p>} />,
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container.querySelector('[data-office-kind="pptx"]')).toBeTruthy();
  });
});
