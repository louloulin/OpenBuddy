/**
 * DocxPreview —— 加载态 / 成功态 / 失败降级三段式单测。
 * 用 vi.mock 替掉 office-preview-loader，避免真的加载 docx-preview。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { DocxPreview } from "../DocxPreview";

const hoisted = vi.hoisted(() => {
  const renderAsync = vi.fn<(data: unknown, body: HTMLElement) => Promise<unknown>>(
    async () => undefined,
  );
  const loadDocxPreview = vi.fn(async () => ({ renderAsync }));
  return { renderAsync, loadDocxPreview };
});

vi.mock("../office-preview-loader", () => ({
  loadDocxPreview: hoisted.loadDocxPreview,
}));

/** 合法 base64（"Hello"），保证真实的 decodeDataUrl 不会抛错。 */
const CONTENT = "data:application/octet-stream;base64,SGVsbG8=";

beforeEach(() => {
  hoisted.renderAsync.mockClear();
  hoisted.renderAsync.mockResolvedValue(undefined);
  hoisted.loadDocxPreview.mockClear();
  hoisted.loadDocxPreview.mockImplementation(async () => ({
    renderAsync: hoisted.renderAsync,
  }));
});

afterEach(() => cleanup());

describe("DocxPreview", () => {
  it("首帧渲染文件名 + DOCX 徽标 + 加载态占位", async () => {
    render(<DocxPreview filename="plan.docx" content={CONTENT} fallback={<p>降级</p>} />);
    expect(screen.getByText("plan.docx")).toBeTruthy();
    expect(screen.getByText("DOCX")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("文档加载中");
    expect(screen.queryByText("降级")).toBeNull();
    // 等异步渲染落定,避免测试结束后仍有未包裹的 state 更新
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("成功路径：渲染容器、清空加载态、把精确 ArrayBuffer 交给 renderAsync", async () => {
    render(<DocxPreview filename="plan.docx" content={CONTENT} fallback={<p>降级</p>} />);
    const body = screen.getByTestId("office-preview-body");

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByText("降级")).toBeNull();
    expect(hoisted.renderAsync).toHaveBeenCalledTimes(1);

    const [data, container] = hoisted.renderAsync.mock.calls[0];
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect((data as ArrayBuffer).byteLength).toBe(5);
    expect(container).toBe(body);
  });

  it("loader 拒绝时渲染 fallback，且不留加载态", async () => {
    hoisted.loadDocxPreview.mockRejectedValueOnce(new Error("module missing"));
    render(<DocxPreview filename="plan.docx" content={CONTENT} fallback={<p>降级</p>} />);
    await waitFor(() => expect(screen.getByText("降级")).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("office-preview-body")).toBeNull();
  });

  it("解析阶段抛错同样渲染 fallback（永不白屏）", async () => {
    hoisted.renderAsync.mockRejectedValueOnce(new Error("corrupt docx"));
    render(<DocxPreview filename="plan.docx" content={CONTENT} fallback={<p>降级</p>} />);
    await waitFor(() => expect(screen.getByText("降级")).toBeTruthy());
  });

  it("内容非法 base64 时降级而不是抛到渲染层", async () => {
    render(<DocxPreview filename="plan.docx" content="!!!!bad!!!!" fallback={<p>降级</p>} />);
    await waitFor(() => expect(screen.getByText("降级")).toBeTruthy());
    expect(hoisted.renderAsync).not.toHaveBeenCalled();
  });

  it("容器带 data-office-kind 便于宿主做样式钩子", async () => {
    const { container } = render(
      <DocxPreview filename="plan.docx" content={CONTENT} fallback={<p>降级</p>} />,
    );
    // 等异步渲染落定,避免测试结束时仍有未包裹的 state 更新。
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container.querySelector('[data-office-kind="docx"]')).toBeTruthy();
  });
});
