/**
 * plugin-commands.test.ts — ⌘K 命令面板的规则层。
 *
 * 这些规则原本散落在组件里没法测(「以 / 开头」的解析、前缀匹配、args 切分)。
 * 抽成纯函数后,`plugin.command` 槽位从「注册了没人用」变成可验证的能力。
 */
import { describe, expect, it, vi } from "vitest";
import {
  filterPluginCommands,
  parseSlashQuery,
  pluginCommandLabel,
  runPluginCommand,
  type PluginCommandPayload,
} from "../plugin-commands";

const greet: PluginCommandPayload = {
  id: "greet",
  label: "/greet — 输出问候",
  onExecute: vi.fn(),
};
const tidy: PluginCommandPayload = { id: "tidy-workspace", label: "整理工作区" };

describe("pluginCommandLabel", () => {
  it("优先用 label", () => {
    expect(pluginCommandLabel(greet)).toBe("/greet — 输出问候");
  });

  it("label 缺失 / 空白时退化成 /id", () => {
    expect(pluginCommandLabel({ id: "no-label" })).toBe("/no-label");
    expect(pluginCommandLabel({ id: "blank", label: "   " })).toBe("/blank");
  });
});

describe("parseSlashQuery", () => {
  it("非 / 开头不是命令调用", () => {
    expect(parseSlashQuery("greet")).toBeNull();
    expect(parseSlashQuery("")).toBeNull();
  });

  it("只有命令名时 args 为空串", () => {
    expect(parseSlashQuery("/greet")).toEqual({ commandId: "greet", args: "" });
  });

  it("切分命令与参数,压缩多余空白", () => {
    expect(parseSlashQuery("/greet  Alice")).toEqual({ commandId: "greet", args: "Alice" });
    expect(parseSlashQuery("/greet Alice Bob")).toEqual({ commandId: "greet", args: "Alice Bob" });
  });

  it("前导空白不影响识别", () => {
    expect(parseSlashQuery("   /greet Alice")).toEqual({ commandId: "greet", args: "Alice" });
  });
});

describe("filterPluginCommands", () => {
  const all = [greet, tidy];

  it("空查询列出全部命令(打开面板就能看到插件贡献)", () => {
    expect(filterPluginCommands(all, "")).toHaveLength(2);
  });

  it("`/` 前缀按 id 前缀匹配", () => {
    expect(filterPluginCommands(all, "/gr").map((c) => c.id)).toEqual(["greet"]);
    expect(filterPluginCommands(all, "/").map((c) => c.id)).toEqual(["greet", "tidy-workspace"]);
    // 前缀不是子串:`tidy` 不该被 `/idy` 命中
    expect(filterPluginCommands(all, "/idy")).toHaveLength(0);
  });

  it("普通查询匹配 id 或 label(中文描述也能搜到)", () => {
    expect(filterPluginCommands(all, "工作区").map((c) => c.id)).toEqual(["tidy-workspace"]);
    expect(filterPluginCommands(all, "GREET").map((c) => c.id)).toEqual(["greet"]);
  });

  it("过滤掉没有 id 的脏数据而不是抛错", () => {
    const dirty = [greet, { id: "" }, null as unknown as PluginCommandPayload];
    expect(filterPluginCommands(dirty, "").map((c) => c.id)).toEqual(["greet"]);
  });
});

describe("runPluginCommand", () => {
  it("把 args 原样交给插件回调", () => {
    const onExecute = vi.fn();
    runPluginCommand({ id: "greet", onExecute }, "Alice");
    expect(onExecute).toHaveBeenCalledWith({ args: "Alice" });
  });

  it("插件抛错被吞掉,并透传给 onError(一个坏插件不该拖垮 ⌘K)", () => {
    const boom = new Error("boom");
    const onExecute = vi.fn(() => {
      throw boom;
    });
    const onError = vi.fn();
    expect(() => runPluginCommand({ id: "bad", onExecute }, "", onError)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("没有 onExecute 时是 no-op", () => {
    expect(() => runPluginCommand({ id: "noop" })).not.toThrow();
  });
});
