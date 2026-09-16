/**
 * editor-contributions —— 三个编辑器扩展点(`editor.toolbar` /
 * `editor.slash-commands` / `editor.mention-sources`)的纯逻辑单测。
 *
 * 重点不是"happy path 能跑",而是**坏插件不能拖垮编辑器**:
 * 缺 run / id 撞名 / 抛异常 / 返回脏数据,都必须被收敛成可预期行为。
 */
import "@testing-library/jest-dom/vitest";
import "../test-shims/prosemirror-jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "../extensions";
import { applySlashCommand } from "../extensions/apply-slash-command";
import {
  DEFAULT_SLASH_COMMANDS,
  mergeSlashCommandContributions,
} from "../lib/slash-command";
import { gatherMentionItems } from "../lib/mention";
import {
  mergeToolbarActions,
  runToolbarAction,
  toolbarActionActive,
  toolbarActionDisabled,
  type EditorToolbarAction,
} from "../lib/toolbar-actions";

const editors: Editor[] = [];

function makeEditor(content = "<p>/ta</p>") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: buildEditorExtensions(), content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

const okAction = (id: string, extra: Partial<EditorToolbarAction> = {}): EditorToolbarAction => ({
  id,
  label: `按钮 ${id}`,
  run: () => {},
  ...extra,
});

describe("mergeToolbarActions", () => {
  it("空输入返回空数组", () => {
    expect(mergeToolbarActions(undefined)).toEqual([]);
    expect(mergeToolbarActions([])).toEqual([]);
  });

  it("丢弃缺 run / 缺 id / 缺 label 的脏数据", () => {
    const merged = mergeToolbarActions([
      okAction("good"),
      { id: "no-run", label: "x" } as unknown as EditorToolbarAction,
      { label: "no-id", run: () => {} } as unknown as EditorToolbarAction,
      { id: "no-label", run: () => {} } as unknown as EditorToolbarAction,
      null,
      undefined,
    ]);
    expect(merged.map((action) => action.id)).toEqual(["good"]);
  });

  it("同 id 只保留第一个", () => {
    const merged = mergeToolbarActions([okAction("dup", { label: "甲" }), okAction("dup", { label: "乙" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe("甲");
  });

  it("hidden 对插件按钮同样生效", () => {
    const merged = mergeToolbarActions([okAction("a"), okAction("b")], ["a"]);
    expect(merged.map((action) => action.id)).toEqual(["b"]);
  });

  it("按 order 升序,未指定 order 的保持注册顺序", () => {
    const merged = mergeToolbarActions([
      okAction("x", { order: 10 }),
      okAction("y"),
      okAction("z", { order: -5 }),
      okAction("w"),
    ]);
    expect(merged.map((action) => action.id)).toEqual(["z", "y", "w", "x"]);
  });

  it("run 抛错被吞掉,不影响编辑器", () => {
    const editor = makeEditor();
    const boom = okAction("boom", {
      run: () => {
        throw new Error("plugin exploded");
      },
    });
    expect(runToolbarAction(boom, editor)).toBe(false);
    expect(() => runToolbarAction(okAction("fine"), editor)).not.toThrow();
    expect(runToolbarAction(okAction("fine"), editor)).toBe(true);
  });

  it("isActive / isDisabled 抛错时退化为未激活 / 可用", () => {
    const editor = makeEditor();
    const action = okAction("bad-state", {
      isActive: () => {
        throw new Error("nope");
      },
      isDisabled: () => {
        throw new Error("nope");
      },
    });
    expect(toolbarActionActive(action, editor)).toBe(false);
    expect(toolbarActionDisabled(action, editor)).toBe(false);
    expect(toolbarActionActive(okAction("plain"), editor)).toBe(false);
    expect(toolbarActionDisabled(okAction("plain"), editor)).toBe(false);
  });
});

describe("mergeSlashCommandContributions", () => {
  const contribution = {
    id: "callout",
    title: "提示块",
    run: () => {},
  };

  it("内置命令不受影响(无贡献时原样返回一份拷贝)", () => {
    const merged = mergeSlashCommandContributions(DEFAULT_SLASH_COMMANDS, undefined);
    expect(merged.map((c) => c.id)).toEqual(DEFAULT_SLASH_COMMANDS.map((c) => c.id));
    expect(merged).not.toBe(DEFAULT_SLASH_COMMANDS);
  });

  it("插件命令补齐 kind / icon / group 默认值", () => {
    const [command] = mergeSlashCommandContributions([], [contribution]);
    expect(command).toMatchObject({ id: "callout", kind: "insert", icon: "◆", group: "插件" });
  });

  it("与内置 id 撞名时保留内置语义", () => {
    const merged = mergeSlashCommandContributions(DEFAULT_SLASH_COMMANDS, [
      { id: "table", title: "假表格", run: () => {} },
    ]);
    const tables = merged.filter((command) => command.id === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0].title).toBe("表格");
    expect(tables[0].run).toBeUndefined();
  });

  it("丢弃没有 run 的贡献", () => {
    const merged = mergeSlashCommandContributions([], [
      { id: "no-run", title: "点不动" } as never,
    ]);
    expect(merged).toHaveLength(0);
  });
});

describe("applySlashCommand 与插件命令", () => {
  it("插件命令先删掉 `/xxx` 再把控制权交给插件", () => {
    const editor = makeEditor("<p>/callout 正文</p>");
    const run = vi.fn(({ editor: target }) => {
      target.chain().insertContent("callout-content").run();
    });
    const command = { ...DEFAULT_SLASH_COMMANDS[0], id: "callout", title: "提示块", run };

    // `/callout` 占 1..9,光标在 9。
    const handled = applySlashCommand(editor, command, { from: 1, to: 9 });

    expect(handled).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(editor.getText()).not.toContain("/callout");
    expect(editor.getText()).toContain("callout-content");
    expect(editor.getText()).toContain("正文");
  });

  it("插件 run 抛错时仍然吞掉 `/xxx`,不把异常抛给菜单", () => {
    const editor = makeEditor("<p>/boom</p>");
    const command = {
      ...DEFAULT_SLASH_COMMANDS[0],
      id: "boom",
      run: () => {
        throw new Error("bad plugin");
      },
    };
    expect(() => applySlashCommand(editor, command, { from: 1, to: 6 })).not.toThrow();
    expect(editor.getText()).not.toContain("/boom");
  });

  it("既不是内置 id 也没有 run → no-op(返回 false,文档不变)", () => {
    const editor = makeEditor("<p>/unknown</p>");
    const command = { ...DEFAULT_SLASH_COMMANDS[0], id: "unknown", title: "未知" };
    expect(applySlashCommand(editor, command, { from: 1, to: 9 })).toBe(false);
    expect(editor.getText()).toContain("/unknown");
  });
});

describe("gatherMentionItems", () => {
  const files = [
    { id: "/a/readme.md", label: "readme.md", kind: "file" as const },
    { id: "/a/index.ts", label: "index.ts", kind: "file" as const },
  ];

  it("无来源返回空数组", async () => {
    expect(await gatherMentionItems(undefined, "")).toEqual([]);
    expect(await gatherMentionItems([], "a")).toEqual([]);
  });

  it("静态 items 按 query 过滤", async () => {
    const items = await gatherMentionItems([{ id: "files", items: files }], "readme");
    expect(items.map((item) => item.id)).toEqual(["/a/readme.md"]);
  });

  it("动态 getItems 优先于静态 items", async () => {
    const getItems = vi.fn(async () => files);
    const items = await gatherMentionItems([{ id: "files", items: [], getItems }], "x");
    expect(getItems).toHaveBeenCalledWith("x");
    expect(items).toHaveLength(2);
  });

  it("多个来源按顺序拼接并按 id 去重", async () => {
    const items = await gatherMentionItems(
      [
        { id: "recent", items: [files[0]] },
        { id: "workspace", items: files },
      ],
      "",
    );
    expect(items.map((item) => item.id)).toEqual(["/a/readme.md", "/a/index.ts"]);
  });

  it("单个来源抛错不影响其它来源", async () => {
    const items = await gatherMentionItems(
      [
        {
          id: "broken",
          getItems: () => {
            throw new Error("source down");
          },
        },
        { id: "files", items: files },
      ],
      "",
    );
    expect(items).toHaveLength(2);
  });

  it("丢弃脏条目并遵守 limit", async () => {
    const items = await gatherMentionItems(
      [
        {
          id: "dirty",
          items: [null as never, { id: "no-label" } as never, ...files],
        },
      ],
      "",
      1,
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("/a/readme.md");
  });
});
