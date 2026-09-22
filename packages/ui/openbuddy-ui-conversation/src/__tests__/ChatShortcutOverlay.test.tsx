/**
 * ChatShortcutOverlay.test.tsx
 *
 * Phase B.6 测试:验证快捷键发现面板的默认集合与触发器。
 * 真正的全局事件桥接通过 ui-shell 的 useShortcut 验证;本测试只覆盖组件本身的数据形状。
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_SHORTCUTS,
} from "../chatview/ChatShortcutOverlay";

describe("ChatShortcutOverlay (Phase B.6)", () => {
  it("ships a default set of chat shortcuts", () => {
    expect(CHAT_SHORTCUTS.length).toBeGreaterThan(0);
  });

  it("includes the find shortcut", () => {
    const find = CHAT_SHORTCUTS.find((s) => s.id === "chat-find");
    expect(find?.keys).toMatch(/⌘ F/);
    expect(find?.label).toMatch(/查找/);
  });

  it("includes the help shortcut (this panel)", () => {
    const help = CHAT_SHORTCUTS.find((s) => s.id === "chat-shortcuts");
    expect(help?.keys).toBe("?");
    expect(help?.category).toBe("帮助");
  });

  it("groups shortcuts by category", () => {
    const categories = new Set(CHAT_SHORTCUTS.map((s) => s.category));
    expect(categories.has("对话")).toBe(true);
    expect(categories.has("编辑")).toBe(true);
    expect(categories.has("工具")).toBe(true);
    expect(categories.has("帮助")).toBe(true);
  });
});
