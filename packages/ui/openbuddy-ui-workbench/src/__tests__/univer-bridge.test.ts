import { describe, expect, it } from "vitest";
import {
  docTextToDocumentData,
  sheetSourceToWorkbookData,
} from "../univer-bridge";

describe("sheetSourceToWorkbookData", () => {
  it("maps rows into Univer's sparse cellData matrix", () => {
    const wb = sheetSourceToWorkbookData("data.xlsx", {
      sheets: [{ name: "Q1", rows: [["名称", "金额"], ["咖啡", "18"]] }],
    });

    expect(wb.sheetOrder).toEqual(["sheet-1"]);
    const sheet = wb.sheets["sheet-1"];
    expect(sheet.name).toBe("Q1");
    expect(sheet.cellData[0][0]).toEqual({ v: "名称" });
    expect(sheet.cellData[1][1]).toEqual({ v: "18" });
  });

  it("skips empty cells so the matrix stays sparse", () => {
    const wb = sheetSourceToWorkbookData("data.xlsx", {
      sheets: [{ name: "S", rows: [["a", "", "c"]] }],
    });
    const row = wb.sheets["sheet-1"].cellData[0];
    expect(Object.keys(row)).toEqual(["0", "2"]);
  });

  it("pads the grid to a minimum editable size", () => {
    const wb = sheetSourceToWorkbookData("tiny.xlsx", {
      sheets: [{ name: "S", rows: [["only"]] }],
    });
    expect(wb.sheets["sheet-1"].rowCount).toBe(20);
    expect(wb.sheets["sheet-1"].columnCount).toBe(10);
  });

  it("keeps grid dimensions when the sheet is larger than the minimum", () => {
    const rows = Array.from({ length: 25 }, (_, r) =>
      Array.from({ length: 12 }, (_, c) => `r${r}c${c}`),
    );
    const wb = sheetSourceToWorkbookData("big.xlsx", {
      sheets: [{ name: "S", rows }],
    });
    expect(wb.sheets["sheet-1"].rowCount).toBe(25);
    expect(wb.sheets["sheet-1"].columnCount).toBe(12);
  });

  it("preserves multi-sheet order and names", () => {
    const wb = sheetSourceToWorkbookData("multi.xlsx", {
      sheets: [
        { name: "First", rows: [["1"]] },
        { name: "Second", rows: [["2"]] },
      ],
    });
    expect(wb.sheetOrder).toEqual(["sheet-1", "sheet-2"]);
    expect(wb.sheets["sheet-2"].name).toBe("Second");
  });

  it("falls back to a positional sheet name when the source has none", () => {
    const wb = sheetSourceToWorkbookData("x.xlsx", {
      sheets: [{ name: "", rows: [] }],
    });
    expect(wb.sheets["sheet-1"].name).toBe("Sheet1");
  });
});

describe("docTextToDocumentData", () => {
  it("encodes each line as a Univer paragraph terminated by \\r", () => {
    const doc = docTextToDocumentData("notes.docx", "第一段\n第二段");

    expect(doc.title).toBe("notes.docx");
    expect(doc.body.dataStream).toBe("第一段\r第二段\r\n");
    expect(doc.body.paragraphs).toEqual([{ startIndex: 3 }, { startIndex: 7 }]);
  });

  it("terminates the stream with a section break", () => {
    const doc = docTextToDocumentData("a.docx", "solo");
    expect(doc.body.dataStream.endsWith("\r\n")).toBe(true);
  });

  it("handles empty text without throwing", () => {
    const doc = docTextToDocumentData("empty.docx", "");
    expect(doc.body.dataStream).toBe("\r\n");
    expect(doc.body.paragraphs).toEqual([{ startIndex: 0 }]);
  });
});
