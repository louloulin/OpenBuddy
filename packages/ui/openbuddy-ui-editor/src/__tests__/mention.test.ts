/** mention 纯逻辑单测 —— @ 触发探测与候选过滤。 */
import { describe, expect, it } from "vitest";
import { detectMentionTrigger, filterMentionItems, mentionToMarkdown } from "../lib/mention";

describe("detectMentionTrigger", () => {
  it("行首 @ 触发", () => {
    expect(detectMentionTrigger("@")).toEqual({ from: 0, to: 1, query: "" });
  });

  it("空白后的 @ 触发", () => {
    expect(detectMentionTrigger("看 @src/ma")).toEqual({ from: 2, to: 9, query: "src/ma" });
  });

  it("括号后触发", () => {
    expect(detectMentionTrigger("( @a")).toEqual({ from: 2, to: 4, query: "a" });
  });

  it("邮箱里的 @ 不触发", () => {
    expect(detectMentionTrigger("mailto:a@b")).toBeNull();
  });

  it("query 中出现空白即结束触发", () => {
    expect(detectMentionTrigger("@a b")).toBeNull();
  });

  it("支持自定义触发字符", () => {
    expect(detectMentionTrigger("hi :", ":")).toEqual({ from: 3, to: 4, query: "" });
  });
});

describe("filterMentionItems", () => {
  const items = [
    { id: "1", label: "src/app.ts", detail: "文件", kind: "file" as const },
    { id: "2", label: "src/main.ts", detail: "文件", kind: "file" as const },
    { id: "3", label: "研究专家", detail: "agent", kind: "agent" as const, keywords: ["research"] },
  ];

  it("空 query 返回前 limit 条", () => {
    expect(filterMentionItems(items, "", 2)).toHaveLength(2);
  });

  it("标签前缀匹配优先", () => {
    expect(filterMentionItems(items, "src/app")[0]?.id).toBe("1");
  });

  it("keywords 可命中", () => {
    expect(filterMentionItems(items, "research")[0]?.id).toBe("3");
  });

  it("detail 兜底匹配", () => {
    expect(filterMentionItems(items, "agent").map((i) => i.id)).toContain("3");
  });

  it("无匹配返回空", () => {
    expect(filterMentionItems(items, "zzz")).toEqual([]);
  });
});

describe("mentionToMarkdown", () => {
  it("还原为 @label", () => {
    expect(mentionToMarkdown({ label: "src/app.ts" })).toBe("@src/app.ts");
  });
});
