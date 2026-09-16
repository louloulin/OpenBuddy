/**
 * XlsxPreview —— 加载态 / 成功态 / 失败降级 / 工作表上限四段式单测。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { XlsxPreview } from "../XlsxPreview";

const hoisted = vi.hoisted(() => {
  const sheetToHtml = vi.fn((_ws: unknown, _opts?: Record<string, unknown>) =>
    "<table><tbody><tr><td>1</td></tr></tbody></table>",
  );
  const read = vi.fn(
    (
      _data: unknown,
      _opts?: Record<string, unknown>,
    ): { SheetNames: string[]; Sheets: Record<string, unknown> } => ({
      SheetNames: ["Sheet1"],
      Sheets: { Sheet1: {} },
    }),
  );
  const loadXlsx = vi.fn(async () => ({
    read,
    utils: { sheet_to_html: sheetToHtml },
  }));
  return { loadXlsx, read, sheetToHtml };
});

vi.mock("../office-preview-loader", () => ({
  loadXlsx: hoisted.loadXlsx,
}));

const CONTENT = "data:application/octet-stream;base64,SGVsbG8=";

function setWorkbook(names: string[]) {
  const sheets: Record<string, unknown> = {};
  names.forEach((name) => {
    sheets[name] = {};
  });
  hoisted.read.mockImplementation(() => ({ SheetNames: [...names], Sheets: sheets }));
}

beforeEach(() => {
  hoisted.read.mockClear();
  hoisted.sheetToHtml.mockClear();
  hoisted.loadXlsx.mockClear();
  setWorkbook(["Sheet1"]);
});

afterEach(() => cleanup());

describe("XlsxPreview", () => {
  it("首帧渲染加载态", async () => {
    render(<XlsxPreview filename="book.xlsx" content={CONTENT} fallback={<p>降级</p>} />);
    expect(screen.getByRole("status").textContent).toContain("工作簿加载中");
    expect(screen.getByText("XLSX")).toBeTruthy();
    // 等异步解析落定,避免测试结束后仍有未包裹的 state 更新
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("成功路径：渲染工作表标题、数量徽标与表格 HTML", async () => {
    setWorkbook(["Sheet1", "Sheet2"]);
    render(<XlsxPreview filename="book.xlsx" content={CONTENT} fallback={<p>降级</p>} />);
    await waitFor(() => expect(screen.getByText("Sheet1")).toBeTruthy());
    expect(screen.getByText("Sheet2")).toBeTruthy();
    expect(screen.getByText("共 2 个工作表")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("office-preview-body").querySelectorAll("table")).toHaveLength(2);
    // header/footer 置空，拿到的必须是纯片段
    expect(hoisted.sheetToHtml.mock.calls[0][1]).toEqual({ header: "", footer: "" });
  });

  it("超过上限的工作表折叠为「显示更多工作表」按钮", async () => {
    setWorkbook(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
    render(<XlsxPreview filename="book.xlsx" content={CONTENT} fallback={<p>降级</p>} />);
    await waitFor(() => expect(screen.getByText("S1")).toBeTruthy());
    expect(screen.queryByText("S6")).toBeNull();
    const more = screen.getByRole("button", { name: /显示更多工作表/ });
    expect(more.textContent).toContain("2");
    fireEvent.click(more);
    expect(screen.getByText("S6")).toBeTruthy();
    expect(screen.getByText("S7")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /显示更多工作表/ })).toBeNull();
  });

  it("空工作簿渲染显式空态而不是空白", async () => {
    setWorkbook([]);
    render(<XlsxPreview filename="book.xlsx" content={CONTENT} fallback={<p>降级</p>} />);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("没有工作表"),
    );
  });

  it("loader 拒绝时渲染 fallback", async () => {
    hoisted.loadXlsx.mockRejectedValueOnce(new Error("missing"));
    render(<XlsxPreview filename="book.xlsx" content={CONTENT} fallback={<p>降级</p>} />);
    await waitFor(() => expect(screen.getByText("降级")).toBeTruthy());
    expect(screen.queryByTestId("office-preview-body")).toBeNull();
  });

  it("解析抛错时渲染 fallback", async () => {
    hoisted.read.mockImplementationOnce(() => {
      throw new Error("corrupt xlsx");
    });
    render(<XlsxPreview filename="book.xlsx" content={CONTENT} fallback={<p>降级</p>} />);
    await waitFor(() => expect(screen.getByText("降级")).toBeTruthy());
  });

  it("容器带 data-office-kind=xlsx", async () => {
    const { container } = render(
      <XlsxPreview filename="book.xlsx" content={CONTENT} fallback={<p>降级</p>} />,
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container.querySelector('[data-office-kind="xlsx"]')).toBeTruthy();
  });
});
