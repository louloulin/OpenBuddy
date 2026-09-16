/**
 * slash-command 纯逻辑单测 —— 触发探测、过滤排序、分组、键盘导航。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLASH_COMMANDS,
  detectSlashTrigger,
  filterSlashCommands,
  groupSlashCommands,
  moveSlashSelection,
} from "../lib/slash-command";

describe("detectSlashTrigger", () => {
  it("行首的 / 触发,query 为空", () => {
    expect(detectSlashTrigger("/")).toEqual({ from: 0, to: 1, query: "" });
  });

  it("空白之后的 / 触发", () => {
    expect(detectSlashTrigger("正文 /tab")).toEqual({ from: 3, to: 7, query: "tab" });
  });

  it("单词内部的 / 不触发(如 URL)", () => {
    expect(detectSlashTrigger("https://a")).toBeNull();
  });

  it("query 中出现空白即结束触发", () => {
    expect(detectSlashTrigger("/tab le")).toBeNull();
  });

  it("query 里的 / 保留(PI 命令名自带斜杠)", () => {
    expect(detectSlashTrigger("/mcp/reload")).toEqual({ from: 0, to: 11, query: "mcp/reload" });
  });

  it("中间有空白视为普通文本", () => {
    expect(detectSlashTrigger("/a b/c")).toBeNull();
  });

  it("无 / 时返回 null", () => {
    expect(detectSlashTrigger("正文")).toBeNull();
  });
});

describe("filterSlashCommands", () => {
  it("空 query 返回全部并保持顺序", () => {
    expect(filterSlashCommands(DEFAULT_SLASH_COMMANDS, "")).toEqual([...DEFAULT_SLASH_COMMANDS]);
  });

  it("id 完全匹配排第一", () => {
    const result = filterSlashCommands(DEFAULT_SLASH_COMMANDS, "h1");
    expect(result[0]?.id).toBe("h1");
  });

  it("别名可命中(拼音 / 英文)", () => {
    expect(filterSlashCommands(DEFAULT_SLASH_COMMANDS, "biaoti")[0]?.id).toBe("h1");
    expect(filterSlashCommands(DEFAULT_SLASH_COMMANDS, "todo")[0]?.id).toBe("task");
  });

  it("中文标题包含匹配", () => {
    expect(filterSlashCommands(DEFAULT_SLASH_COMMANDS, "表格")[0]?.id).toBe("table");
  });

  it("无匹配返回空数组", () => {
    expect(filterSlashCommands(DEFAULT_SLASH_COMMANDS, "zzzz")).toEqual([]);
  });

  it("大小写不敏感", () => {
    expect(filterSlashCommands(DEFAULT_SLASH_COMMANDS, "H2")[0]?.id).toBe("h2");
  });
});

describe("groupSlashCommands", () => {
  it("按 group 聚合且保持组内顺序", () => {
    const groups = groupSlashCommands(DEFAULT_SLASH_COMMANDS);
    expect(groups.map((g) => g.group)).toEqual(["基础块", "技术块", "媒体"]);
    expect(groups[0].commands[0].id).toBe("h1");
  });

  it("空输入返回空数组", () => {
    expect(groupSlashCommands([])).toEqual([]);
  });
});

describe("moveSlashSelection", () => {
  it("向下移动", () => {
    expect(moveSlashSelection(0, 1, 3)).toBe(1);
  });

  it("到底部环形回到顶部", () => {
    expect(moveSlashSelection(2, 1, 3)).toBe(0);
  });

  it("从顶部向上回到末尾", () => {
    expect(moveSlashSelection(0, -1, 3)).toBe(2);
  });

  it("空列表恒为 0", () => {
    expect(moveSlashSelection(5, 1, 0)).toBe(0);
  });
});

describe("DEFAULT_SLASH_COMMANDS 不变量", () => {
  it("id 唯一", () => {
    const ids = DEFAULT_SLASH_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每条都有标题、分组与图标", () => {
    for (const command of DEFAULT_SLASH_COMMANDS) {
      expect(command.title.length).toBeGreaterThan(0);
      expect(command.group.length).toBeGreaterThan(0);
      expect(command.icon.length).toBeGreaterThan(0);
    }
  });
});
