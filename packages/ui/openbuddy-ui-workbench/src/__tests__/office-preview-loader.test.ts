/**
 * office-preview-loader 集成烟测 —— 真实 dynamic import 三个库。
 *
 * 这里刻意 **不 mock**：组件级单测已经覆盖了「加载失败 / 成功」的分支，
 * 本文件只回答一个问题 —— 三个第三方库在当前打包 / 解析链路上真的能
 * 被解析出预期的 API 面（尤其是 `xlsx` 的 CJS↔ESM 互操作,`default ?? mod`
 * 归一化是否生效）。没有这层校验,一个 `mod.read is not a function`
 * 只会在用户点开附件时才炸。
 *
 * 库体积较大（echarts / jszip），因此给这条用例单独放宽超时。
 */
import { describe, expect, it } from "vitest";
import { loadDocxPreview, loadPptxPreview, loadXlsx } from "../office-preview-loader";

describe("office-preview-loader", () => {
  it("loadDocxPreview 暴露 renderAsync", async () => {
    const mod = await loadDocxPreview();
    expect(typeof mod.renderAsync).toBe("function");
  });

  it("loadXlsx 暴露 read + utils.sheet_to_html", async () => {
    const mod = await loadXlsx();
    expect(typeof mod.read).toBe("function");
    expect(typeof mod.utils?.sheet_to_html).toBe("function");
  });

  it("loadPptxPreview 暴露 init", async () => {
    const mod = await loadPptxPreview();
    expect(typeof mod.init).toBe("function");
  });

  it("同一 loader 重复调用返回同一个 Promise（单次缓存）", () => {
    const first = loadXlsx();
    const second = loadXlsx();
    expect(first).toBe(second);
  });

  it("xlsx 能真正读出一个工作簿并转 HTML", async () => {
    const mod = await loadXlsx();
    // 用 SheetJS 自己写一个最小工作簿（aoa_to_sheet / book_new 属于 utils）。
    const utils = mod.utils as unknown as {
      aoa_to_sheet(rows: unknown[][]): unknown;
      book_new(): { SheetNames: string[]; Sheets: Record<string, unknown> };
      sheet_to_html(ws: unknown, opts?: Record<string, unknown>): string;
    };
    const book = utils.book_new();
    book.SheetNames.push("Sheet1");
    book.Sheets.Sheet1 = utils.aoa_to_sheet([["名称", "数量"], ["螺丝", 12]]);

    const html = utils.sheet_to_html(book.Sheets.Sheet1, { header: "", footer: "" });
    expect(html).toContain("<table");
    expect(html).toContain("螺丝");
    expect(html.startsWith("<html")).toBe(false);
  }, 30_000);
});
