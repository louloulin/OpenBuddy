import { describe, it, expect } from "vitest";
import {
  computeUnifiedDiff,
  summarizeDiff,
  hunksToUnifiedLines,
} from "../files/unified-diff";

describe("computeUnifiedDiff", () => {
  it("空 diff(无变化)", () => {
    const lines = computeUnifiedDiff("hello\nworld", "hello\nworld");
    expect(lines.every((l) => l.kind === "context")).toBe(true);
    expect(lines.length).toBe(2);
  });

  it("简单添加一行", () => {
    const lines = computeUnifiedDiff("a\nb", "a\nb\nc");
    const summary = summarizeDiff(lines);
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(0);
    const added = lines.find((l) => l.kind === "add");
    expect(added?.text).toBe("c");
  });

  it("简单删除一行", () => {
    const lines = computeUnifiedDiff("a\nb\nc", "a\nc");
    const summary = summarizeDiff(lines);
    expect(summary.removed).toBe(1);
    const del = lines.find((l) => l.kind === "del");
    expect(del?.text).toBe("b");
  });

  it("替换一行", () => {
    const lines = computeUnifiedDiff("a\nb\nc", "a\nx\nc");
    const summary = summarizeDiff(lines);
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(1);
    expect(lines.find((l) => l.kind === "del")?.text).toBe("b");
    expect(lines.find((l) => l.kind === "add")?.text).toBe("x");
  });

  it("多行替换", () => {
    const lines = computeUnifiedDiff("a\nb\nc\nd\ne", "a\nx\ny\nz\ne");
    const summary = summarizeDiff(lines);
    expect(summary.removed).toBe(3); // b,c,d removed
    expect(summary.added).toBe(3); // x,y,z added
  });

  it("空旧文本 → 全部添加", () => {
    const lines = computeUnifiedDiff("", "a\nb\nc");
    const summary = summarizeDiff(lines);
    expect(summary.added).toBe(3);
    expect(summary.removed).toBe(0);
  });

  it("空新文本 → 全部删除", () => {
    const lines = computeUnifiedDiff("a\nb\nc", "");
    const summary = summarizeDiff(lines);
    expect(summary.removed).toBe(3);
    expect(summary.added).toBe(0);
  });

  it("上下文行数限制(默认 3)", () => {
    // 大文件,改动在中间,上下文只显示 3 行
    const oldLines = Array.from({ length: 20 }, (_, i) => `line${i}`);
    const newLines = [...oldLines];
    newLines[10] = "CHANGED";
    const lines = computeUnifiedDiff(oldLines.join("\n"), newLines.join("\n"), 3);
    // 上下文: line7..line9 (3 lines) + line11..line13 (3 lines)
    const contextLines = lines.filter((l) => l.kind === "context");
    expect(contextLines.length).toBeLessThanOrEqual(7); // 3 before + 1 separator + 3 after
    expect(lines.some((l) => l.text === "CHANGED")).toBe(true);
  });

  it("行号正确", () => {
    const lines = computeUnifiedDiff("a\nb\nc", "a\nx\nc");
    const del = lines.find((l) => l.kind === "del");
    const add = lines.find((l) => l.kind === "add");
    expect(del?.oldLine).toBe(2);
    expect(add?.newLine).toBe(2);
  });

  it("完全空文本", () => {
    const lines = computeUnifiedDiff("", "");
    expect(lines.length).toBe(0);
  });
});

describe("hunksToUnifiedLines", () => {
  it("转换 hunks 为 unified lines", () => {
    const hunks = [
      {
        old: { start: 1, lines: ["old1", "old2"] },
        new: { start: 1, lines: ["new1", "new2", "new3"] },
      },
    ];
    const lines = hunksToUnifiedLines(hunks);
    expect(lines.filter((l) => l.kind === "del").length).toBe(2);
    expect(lines.filter((l) => l.kind === "add").length).toBe(3);
    expect(lines.find((l) => l.kind === "del")?.oldLine).toBe(1);
    expect(lines.find((l) => l.kind === "add")?.newLine).toBe(1);
  });

  it("空 hunks", () => {
    expect(hunksToUnifiedLines([])).toEqual([]);
  });
});

describe("summarizeDiff", () => {
  it("正确统计", () => {
    const lines = [
      { kind: "context" as const, text: "a" },
      { kind: "del" as const, text: "b" },
      { kind: "add" as const, text: "x" },
      { kind: "context" as const, text: "c" },
    ];
    const s = summarizeDiff(lines);
    expect(s.added).toBe(1);
    expect(s.removed).toBe(1);
    expect(s.context).toBe(2);
  });
});
