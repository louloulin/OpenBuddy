import { describe, expect, it } from "vitest";
import { splitMarkdownBlocks } from "../markdown-blocks";

describe("splitMarkdownBlocks", () => {
  it("splits paragraphs, headings and fences at safe blank lines", () => {
    const text = "## 标题\n\n第一段\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n最后一段";
    expect(splitMarkdownBlocks(text)).toEqual(["## 标题", "第一段", "```ts\nconst a = 1;\n\nconst b = 2;\n```", "最后一段"]);
  });
  it("keeps lists, indented continuations and tables together", () => {
    const text = "1. 一\n\n2. 二\n\n   续行\n\n| a | b |\n| - | - |\n\n段落";
    expect(splitMarkdownBlocks(text)).toEqual(["1. 一\n\n2. 二\n\n   续行\n\n| a | b |\n| - | - |", "段落"]);
  });
  it("does not split an unterminated fence while it streams", () => {
    expect(splitMarkdownBlocks("前言\n\n```py\nprint(1)\n\nprint(2)")).toEqual(["前言", "```py\nprint(1)\n\nprint(2)"]);
  });
  it("keeps documents with reference definitions or footnotes whole", () => {
    const text = "见 [文档][d]\n\n下一段\n\n[d]: https://example.com";
    expect(splitMarkdownBlocks(text)).toEqual([text]);
  });
  it("is stable for the finished prefix as text is appended", () => {
    const a = splitMarkdownBlocks("段一\n\n段二");
    const b = splitMarkdownBlocks("段一\n\n段二继续\n\n段三");
    expect(b[0]).toBe(a[0]);
  });
});
