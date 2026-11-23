import { describe, expect, it } from "vitest";
import { suggestFollowUps } from "../follow-up-suggestions";

describe("suggestFollowUps", () => {
  it("没有回答时不建议", () => {
    expect(suggestFollowUps({ answer: "   " })).toEqual([]);
  });

  it("有产物时优先建议解释与优化", () => {
    const items = suggestFollowUps({ answer: "已完成", artifactCount: 2 }, 3);
    expect(items.map((x) => x.id)).toEqual(["explain-artifacts", "optimize-artifacts", "go-deeper"]);
  });

  it("代码回答给出解释与测试", () => {
    const items = suggestFollowUps({ answer: "```ts\nconst a = 1;\n```" }, 3);
    expect(items.map((x) => x.id)).toContain("explain-code");
    expect(items.map((x) => x.id)).toContain("add-tests");
  });

  it("表格与列表走不同建议", () => {
    expect(suggestFollowUps({ answer: "| a | b |\n| - | - |\n| 1 | 2 |" })[0].id).toBe("summarize-table");
    expect(suggestFollowUps({ answer: "- 第一项\n- 第二项" })[0].id).toBe("pick-first");
  });

  it("命令行工具建议再验证一次", () => {
    const items = suggestFollowUps({ answer: "已改好", toolKinds: ["bash"] }, 3);
    expect(items.map((x) => x.id)).toContain("verify");
  });

  it("限制数量且不重复", () => {
    const items = suggestFollowUps({ answer: "```js\n1\n```\nhttps://example.com", artifactCount: 1, toolKinds: ["bash"] }, 3);
    expect(items).toHaveLength(3);
    expect(new Set(items.map((x) => x.id)).size).toBe(3);
  });
});
