import { describe, it, expect } from "vitest";
import {
  collectDroppedPaths,
  mergeAttachments,
  isDragHovering,
  isDragDrop,
  extOf,
  basenameOf,
  CODE_DOC_EXTS,
} from "../files/drop-utils";
import type { DragDropEvent } from "../files/drop-utils";

describe("extOf", () => {
  it("取小写后缀含点", () => {
    expect(extOf("/a/b/c.TS")).toBe(".ts");
    expect(extOf("readme.MD")).toBe(".md");
  });
  it("无后缀返回空串", () => {
    expect(extOf("/a/b/Makefile")).toBe("");
    expect(extOf("noext")).toBe("");
  });
  it("只取最后一段的后缀(忽略目录里的点)", () => {
    expect(extOf("/a.b/c/file.ts")).toBe(".ts");
  });
});

describe("basenameOf", () => {
  it("正斜杠与反斜杠都能取文件名", () => {
    expect(basenameOf("/a/b/c.ts")).toBe("c.ts");
    expect(basenameOf("C:\\a\\b\\c.ts")).toBe("c.ts");
  });
  it("无目录返回原文", () => {
    expect(basenameOf("c.ts")).toBe("c.ts");
  });
});

describe("collectDroppedPaths", () => {
  it("空/无 paths 返回空数组", () => {
    expect(collectDroppedPaths(undefined)).toEqual([]);
    expect(collectDroppedPaths(null)).toEqual([]);
    expect(collectDroppedPaths([])).toEqual([]);
  });

  it("去重并保持顺序", () => {
    expect(
      collectDroppedPaths(["/a.ts", "/b.ts", "/a.ts", "/c.ts"]),
    ).toEqual(["/a.ts", "/b.ts", "/c.ts"]);
  });

  it("过滤目录(以分隔符结尾)", () => {
    expect(
      collectDroppedPaths(["/dir/", "/dir\\", "/keep.ts"]),
    ).toEqual(["/keep.ts"]);
  });

  it("忽略空白路径", () => {
    expect(collectDroppedPaths(["", "   ", "/x.ts"])).toEqual(["/x.ts"]);
  });

  it("无白名单时不按后缀过滤", () => {
    expect(collectDroppedPaths(["/a.ts", "/b.exe", "/c"])).toEqual([
      "/a.ts",
      "/b.exe",
      "/c",
    ]);
  });

  it("白名单非空时只保留命中后缀", () => {
    const got = collectDroppedPaths(["/a.ts", "/b.exe", "/c.md"], CODE_DOC_EXTS);
    expect(got).toEqual(["/a.ts", "/c.md"]);
  });

  it("白名单大小写不敏感匹配", () => {
    const got = collectDroppedPaths(["/A.TS", "/B.Md"], [".ts", ".md"]);
    expect(got).toEqual(["/A.TS", "/B.Md"]);
  });
});

describe("mergeAttachments", () => {
  it("已有在前,新增在后", () => {
    expect(mergeAttachments(["/a.ts"], ["/b.ts", "/c.ts"])).toEqual([
      "/a.ts",
      "/b.ts",
      "/c.ts",
    ]);
  });

  it("去重(传入与已有重复的不重复加入)", () => {
    expect(mergeAttachments(["/a.ts", "/b.ts"], ["/b.ts", "/c.ts"])).toEqual([
      "/a.ts",
      "/b.ts",
      "/c.ts",
    ]);
  });

  it("incoming 自身重复也去重", () => {
    expect(mergeAttachments([], ["/x.ts", "/x.ts"])).toEqual(["/x.ts"]);
  });

  it("空入参保持不变", () => {
    expect(mergeAttachments(["/a.ts"], [])).toEqual(["/a.ts"]);
    expect(mergeAttachments([], ["/b.ts"])).toEqual(["/b.ts"]);
  });
});

describe("isDragHovering / isDragDrop", () => {
  const enter: DragDropEvent = { type: "enter", paths: [], position: { x: 0, y: 0 } };
  const over: DragDropEvent = { type: "over", position: { x: 0, y: 0 } };
  const drop: DragDropEvent = { type: "drop", paths: ["/a.ts"], position: { x: 0, y: 0 } };
  const leave: DragDropEvent = { type: "leave" };

  it("enter/over 为 hover", () => {
    expect(isDragHovering(enter)).toBe(true);
    expect(isDragHovering(over)).toBe(true);
  });
  it("drop/leave 非 hover", () => {
    expect(isDragHovering(drop)).toBe(false);
    expect(isDragHovering(leave)).toBe(false);
  });
  it("仅 drop 为 drop", () => {
    expect(isDragDrop(drop)).toBe(true);
    expect(isDragDrop(enter)).toBe(false);
    expect(isDragDrop(over)).toBe(false);
    expect(isDragDrop(leave)).toBe(false);
  });
});
