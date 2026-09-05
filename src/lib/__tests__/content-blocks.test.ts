import { describe, it, expect } from "vitest";
import {
  blocks,
  appendBlock,
  removeBlock,
  updateTextBlock,
  moveBlock,
  isSubmittable,
  assemblePrompt,
  blockLabel,
  type ContentBlock,
} from "../markdown/content-blocks";
import type { AgentEntry } from "@openbuddy/shared-types";

const expert: AgentEntry = {
  name: "代码审查专家",
  path: "/a/x.md",
  scope: "local",
  description: "严格审查代码质量",
  raw: "---\nname: 代码审查专家\n---\n正文",
};

describe("blocks 工厂", () => {
  it("各类型块带稳定 id", () => {
    expect(blocks.text("hi").kind).toBe("text");
    expect(blocks.skill("coder").kind).toBe("skill");
    expect(blocks.expert(expert).kind).toBe("expert");
    expect(blocks.file("/a/b.ts").kind).toBe("file");
    expect(typeof blocks.text().id).toBe("string");
  });
});

describe("appendBlock / removeBlock", () => {
  it("追加到末尾", () => {
    const a = blocks.text("a");
    const b = blocks.text("b");
    expect(appendBlock([a], b)).toHaveLength(2);
  });
  it("删除指定 id", () => {
    const a = blocks.text("a");
    const b = blocks.text("b");
    const next = removeBlock([a, b], a.id);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(b.id);
  });
  it("删除不存在的 id 无副作用", () => {
    const a = blocks.text("a");
    expect(removeBlock([a], "nope")).toHaveLength(1);
  });
});

describe("updateTextBlock", () => {
  it("更新文本块", () => {
    const a = blocks.text("old");
    const next = updateTextBlock([a], a.id, "new");
    expect((next[0] as { text: string }).text).toBe("new");
  });
  it("非文本块不被改", () => {
    const s = blocks.skill("x");
    const next = updateTextBlock([s], s.id, "ignored");
    expect(next[0]).toBe(s);
  });
});

describe("moveBlock", () => {
  it("移动 + clamp", () => {
    const a = blocks.text("a");
    const b = blocks.text("b");
    const c = blocks.text("c");
    const next = moveBlock([a, b, c], 0, 2);
    expect(next.map((x) => (x as { text: string }).text)).toEqual(["b", "c", "a"]);
  });
  it("相同位置无副作用(引用相等)", () => {
    const a = blocks.text("a");
    const list = [a];
    expect(moveBlock(list, 0, 0)).toBe(list);
  });
  it("非法 from 无副作用", () => {
    const a = blocks.text("a");
    expect(moveBlock([a], 5, 0)).toEqual([a]);
  });
});

describe("isSubmittable", () => {
  it("空列表 false", () => {
    expect(isSubmittable([])).toBe(false);
  });
  it("仅空白文本 false", () => {
    expect(isSubmittable([blocks.text("   ")])).toBe(false);
  });
  it("非空文本 true", () => {
    expect(isSubmittable([blocks.text("hi")])).toBe(true);
  });
  it("仅 skill/expert/file 块也 true", () => {
    expect(isSubmittable([blocks.skill("x")])).toBe(true);
    expect(isSubmittable([blocks.expert(expert)])).toBe(true);
    expect(isSubmittable([blocks.file("/a.ts")])).toBe(true);
  });
});

describe("assemblePrompt", () => {
  it("纯文本块拼接", () => {
    expect(assemblePrompt([blocks.text("你好"), blocks.text("世界")])).toBe("你好\n\n世界");
  });
  it("expert 块作为角色前缀", () => {
    const out = assemblePrompt([blocks.expert(expert), blocks.text("查一下")]);
    expect(out).toContain("【角色 — 代码审查专家】");
    expect(out).toContain("严格审查代码质量");
    expect(out).toContain("查一下");
  });
  it("skill 块展开为 skill://", () => {
    expect(assemblePrompt([blocks.skill("coder")])).toContain("skill://coder");
  });
  it("file 块聚合成清单后置", () => {
    const out = assemblePrompt([
      blocks.text("看文件"),
      blocks.file("/a.ts"),
      blocks.file("/b.ts"),
    ]);
    expect(out).toContain("看文件");
    expect(out).toContain("相关文件:");
    expect(out).toContain("- /a.ts");
    expect(out).toContain("- /b.ts");
    // 文件清单在最后。
    expect(out.lastIndexOf("看文件") < out.indexOf("相关文件")).toBe(true);
  });
  it("空白文本块被跳过", () => {
    expect(assemblePrompt([blocks.text("  "), blocks.text("ok")])).toBe("ok");
  });
  it("空列表返回空串", () => {
    expect(assemblePrompt([])).toBe("");
  });
});

describe("blockLabel", () => {
  it("text 截断 30 字", () => {
    expect(blockLabel(blocks.text("短文本"))).toBe("短文本");
    const long = blocks.text("a".repeat(50));
    expect(blockLabel(long).length).toBe(30);
  });
  it("skill/expert 带 @", () => {
    expect(blockLabel(blocks.skill("coder"))).toBe("@coder");
    expect(blockLabel(blocks.expert(expert))).toBe("@代码审查专家");
  });
  it("file 带 basename + 📎", () => {
    expect(blockLabel(blocks.file("/a/b/c.ts"))).toBe("📎 c.ts");
    expect(blockLabel(blocks.file("C:\\x\\y.md"))).toBe("📎 y.md");
  });
  it("空文本显示占位", () => {
    expect(blockLabel(blocks.text("   "))).toBe("(空文本)");
  });
});

// 确保 ContentBlock 类型可被外部引用(类型导出冒烟)。
const _typeCheck: ContentBlock = blocks.text("x");
void _typeCheck;
