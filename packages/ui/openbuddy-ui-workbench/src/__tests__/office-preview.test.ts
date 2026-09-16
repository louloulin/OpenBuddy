/**
 * office-preview 纯助手单测 —— 只测字符串 / 字节层面的判定,不触碰 DOM。
 */
import { describe, expect, it } from "vitest";
import {
  decodeDataUrl,
  officePreviewKindLabel,
  pickOfficePreviewKind,
  toArrayBuffer,
} from "../office-preview";

describe("pickOfficePreviewKind", () => {
  it("识别 Word OOXML 家族", () => {
    for (const ext of ["docx", "DOCX", "docm", "dotx", "dotm"]) {
      expect(pickOfficePreviewKind(`report.${ext}`)).toBe("docx");
    }
  });

  it("识别 Excel OOXML 家族", () => {
    for (const ext of ["xlsx", "XLSX", "xlsm", "xltx", "xltm"]) {
      expect(pickOfficePreviewKind(`book.${ext}`)).toBe("xlsx");
    }
  });

  it("识别 PowerPoint OOXML 家族", () => {
    for (const ext of ["pptx", "PPTX", "pptm", "ppsx", "ppsm", "potx", "potm"]) {
      expect(pickOfficePreviewKind(`deck.${ext}`)).toBe("pptx");
    }
  });

  it("接受带目录的 POSIX / Windows 路径", () => {
    expect(pickOfficePreviewKind("/Users/me/Docs/plan.docx")).toBe("docx");
    expect(pickOfficePreviewKind("C:\\Users\\me\\Docs\\plan.xlsx")).toBe("xlsx");
    expect(pickOfficePreviewKind("a/b/c/deck.pptx")).toBe("pptx");
  });

  it("忽略查询串与 hash", () => {
    expect(pickOfficePreviewKind("plan.docx?token=1")).toBe("docx");
    expect(pickOfficePreviewKind("plan.xlsx#sheet2")).toBe("xlsx");
  });

  it("取最后一个扩展名（多重后缀）", () => {
    expect(pickOfficePreviewKind("archive.tar.docx")).toBe("docx");
    expect(pickOfficePreviewKind("report.final.v2.pptx")).toBe("pptx");
  });

  it("老式二进制格式刻意不识别（docx-preview / SheetJS 读不了）", () => {
    for (const name of ["legacy.doc", "legacy.xls", "legacy.ppt"]) {
      expect(pickOfficePreviewKind(name)).toBeNull();
    }
  });

  it("非 Office / 无扩展名 / dotfile / 末尾点 一律为 null", () => {
    expect(pickOfficePreviewKind("notes.md")).toBeNull();
    expect(pickOfficePreviewKind("README")).toBeNull();
    expect(pickOfficePreviewKind(".gitignore")).toBeNull();
    expect(pickOfficePreviewKind("report.")).toBeNull();
    expect(pickOfficePreviewKind("")).toBeNull();
  });

  it("非字符串输入不抛异常", () => {
    expect(pickOfficePreviewKind(undefined as unknown as string)).toBeNull();
    expect(pickOfficePreviewKind(null as unknown as string)).toBeNull();
  });
});

describe("officePreviewKindLabel", () => {
  it("返回人类可读标签", () => {
    expect(officePreviewKindLabel("docx")).toBe("Word");
    expect(officePreviewKindLabel("xlsx")).toBe("Excel");
    expect(officePreviewKindLabel("pptx")).toBe("PowerPoint");
  });
});

describe("decodeDataUrl", () => {
  it("解码 base64 data URL", () => {
    const bytes = decodeDataUrl("data:application/octet-stream;base64,SGVsbG8=");
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]); // "Hello"
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it("解码裸 base64", () => {
    const bytes = decodeDataUrl("V29ybGQ=");
    expect(Array.from(bytes)).toEqual([87, 111, 114, 108, 100]); // "World"
  });

  it("剔除 base64 中的换行 / 空白（PEM 风格粘贴）", () => {
    const bytes = decodeDataUrl("data:x;base64,SGVs\n  bG8=\n");
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });

  it("非 base64 的 data URL 走 URI 解码", () => {
    const bytes = decodeDataUrl("data:text/plain,hello%20world");
    expect(Array.from(bytes)).toEqual([...new TextEncoder().encode("hello world")]);
  });

  it("空串返回零长字节数组", () => {
    expect(decodeDataUrl("").byteLength).toBe(0);
  });

  it("非法 base64 抛错（由调用方降级为 fallback）", () => {
    expect(() => decodeDataUrl("!!!!not-base64!!!!")).toThrow();
  });
});

describe("toArrayBuffer", () => {
  it("复制出 byteLength 精确的 ArrayBuffer", () => {
    const source = new Uint8Array([1, 2, 3, 4]);
    const buffer = toArrayBuffer(source);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBe(4);
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4]);
  });

  it("与原视图解耦（后续修改源不影响副本）", () => {
    const source = new Uint8Array([9, 9]);
    const buffer = toArrayBuffer(source);
    source[0] = 0;
    expect(Array.from(new Uint8Array(buffer))).toEqual([9, 9]);
  });

  it("从大 buffer 的切片视图生成精确副本", () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const view = backing.subarray(2, 5);
    const buffer = toArrayBuffer(view);
    expect(buffer.byteLength).toBe(3);
    expect(Array.from(new Uint8Array(buffer))).toEqual([2, 3, 4]);
  });
});
