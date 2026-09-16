import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShortcutHint, detectShortcutPlatform, formatShortcut } from "../ShortcutHint";

describe("formatShortcut (纯函数)", () => {
  it("把 mod 映射成 mac 的 ⌘ 与其它平台的 Ctrl", () => {
    expect(formatShortcut("mod+shift+p", "mac")).toEqual(["⌘", "⇧", "P"]);
    expect(formatShortcut("mod+shift+p", "other")).toEqual(["Ctrl", "Shift", "P"]);
  });

  it("支持 ctrl / alt / 单字母与已知功能键", () => {
    expect(formatShortcut("ctrl+alt+delete", "other")).toEqual(["Ctrl", "Alt", "Del"]);
    expect(formatShortcut("ctrl+alt+delete", "mac")).toEqual(["⌃", "⌥", "⌦"]);
    expect(formatShortcut("f5", "other")).toEqual(["F5"]);
    expect(formatShortcut("escape", "other")).toEqual(["Esc"]);
    expect(formatShortcut("?", "other")).toEqual(["?"]);
  });

  it("忽略空白段并把裸键大写", () => {
    expect(formatShortcut(" mod + k ", "other")).toEqual(["Ctrl", "K"]);
    expect(formatShortcut("", "other")).toEqual([]);
  });

  it("对象形式在 mac 上优先用 mac 键位", () => {
    const chord = { keys: ["ctrl", "k"], mac: ["cmd", "k"] };
    expect(formatShortcut(chord, "mac")).toEqual(["⌘", "K"]);
    expect(formatShortcut(chord, "other")).toEqual(["Ctrl", "K"]);
  });

  it("对象形式没有 mac 键位时回落通用键位", () => {
    expect(formatShortcut({ keys: ["shift", "enter"] }, "mac")).toEqual(["⇧", "↵"]);
  });

  it("保留未知键位原文,不产生空 glyph", () => {
    expect(formatShortcut("hyper+X", "other")).toEqual(["hyper", "X"]);
  });

  it("detectShortcutPlatform 在 jsdom 下回落到 other", () => {
    expect(detectShortcutPlatform()).toBe("other");
  });
});

describe("ShortcutHint", () => {
  it("按平台渲染逐键 <kbd>", () => {
    render(<ShortcutHint chord="mod+shift+e" platform="mac" />);
    const hint = screen.getByLabelText("快捷键 ⌘ ⇧ E");
    expect(hint).toBeInTheDocument();
    expect(hint.querySelectorAll("kbd")).toHaveLength(3);
    expect(hint.getAttribute("data-shortcut")).toBe("⌘+⇧+E");
  });

  it("非 mac 平台渲染文字键名", () => {
    render(<ShortcutHint chord="mod+shift+e" platform="other" />);
    expect(screen.getByText("Ctrl")).toBeInTheDocument();
    expect(screen.getByText("Shift")).toBeInTheDocument();
    expect(screen.getByText("E")).toBeInTheDocument();
  });

  it("plain 模式不渲染 <kbd>", () => {
    const { container } = render(<ShortcutHint chord="?" platform="other" plain />);
    expect(container.querySelectorAll("kbd")).toHaveLength(0);
    expect(container.textContent).toBe("?");
  });

  it("空和弦渲染 null", () => {
    const { container } = render(<ShortcutHint chord="" />);
    expect(container.textContent).toBe("");
  });
});
